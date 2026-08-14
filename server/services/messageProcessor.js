import { randomUUID } from 'crypto';
import db from '../db.js';
import { getAncestorChain } from './treeTraversal.js';
import { retrieveContext } from './contextRetriever.js';
import { buildContext } from './contextBuilder.js';
import { generateAnswer, generateAnswerStream, generateResourceMetas } from './chatGenerator.js';

// 发送消息的统一核心：建节点(pending) → 检索 → 组装 → 生成(可流式) → 元数据 → 落库。
// onStart: 节点建好后回调 {id}（流式场景用于前端占位）
// onToken: 每个 token 块回调（流式场景）
// 返回最终完整节点对象。
export async function processMessage({ treeId, parentId, userMessage, model, isVolatile, contextElementIds, resources, onStart, onToken }) {
  const tree = db.prepare('SELECT * FROM conversation_trees WHERE id = ?').get(treeId);
  if (!tree) throw new Error('tree not found');
  if (!userMessage) throw new Error('userMessage required');

  let depth = 0;
  let siblingIndex = 0;
  let parent = null;
  if (parentId) {
    parent = db.prepare('SELECT * FROM context_elements WHERE id = ?').get(parentId);
    if (!parent) throw new Error('parentId not found');
    depth = parent.depth + 1;
    siblingIndex = db.prepare('SELECT COUNT(*) AS c FROM context_elements WHERE parent_id = ?').get(parentId).c;
  }

  const id = randomUUID();
  const now = Date.now();
  const usedModel = model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const treeNodes = db.prepare('SELECT * FROM context_elements WHERE tree_id = ?').all(treeId);

  // 直接上下文 = 父节点的直接路径（context_trace.direct，已递归含更上层路径节点）+ 父节点自身。
  // 仅含路径节点，不含父节点用过的跨分支节点；全部本地从 DB 获得，不调 API。
  // 父节点无 trace 时回退到 getAncestorChain 重新走路径。
  let ancestorChain = [];
  if (parent) {
    let parentDirect = [];
    try {
      const tr = parent.context_trace ? JSON.parse(parent.context_trace) : null;
      if (tr && Array.isArray(tr.direct)) parentDirect = tr.direct;
    } catch { /* ignore */ }
    if (!parentDirect.length) {
      parentDirect = getAncestorChain(parent.id).map((n) => n.id);
    }
    const directIds = Array.from(new Set([...parentDirect, parent.id]));
    ancestorChain = directIds
      .map((cid) => treeNodes.find((n) => n.id === cid))
      .filter(Boolean)
      .sort((a, b) => a.created_at - b.created_at);
  }
  const ancestorIds = ancestorChain.map((n) => n.id);

  // 先落库 pending，并通知前端（流式场景）；resources 一并写入，has_resource 标记是否有资源
  db.prepare(
    `INSERT INTO context_elements
      (id, tree_id, parent_id, sibling_index, depth, user_message, ai_message,
       model, model_config, status, resources, has_resource, is_volatile, created_at, updated_at)
     VALUES (?,?,?,?,?,?,NULL,?,?, 'pending', ?, ?, ?, ?, ?)`
  ).run(
    id, treeId, parentId ?? null, siblingIndex, depth, userMessage, usedModel, '{}',
    isVolatile ? 1 : 0, JSON.stringify(resources || []), (resources && resources.length) ? 1 : 0, now, now
  );
  if (onStart) onStart({ id, treeId, parentId, userMessage });

  // 组装上下文（直接 / 跨分支）
  const ancestorSet = new Set(ancestorIds);
  let direct, cross, retrieval;

  if (Array.isArray(contextElementIds) && contextElementIds.length) {
    // 手动指定上下文：绕过 LLM 检索，完全按用户选择组装（命中且在祖先链内归入 direct，其余 cross）
    const chosen = contextElementIds
      .map((cid) => treeNodes.find((n) => n.id === cid))
      .filter(Boolean);
    direct = chosen
      .filter((n) => ancestorSet.has(n.id))
      .map((n) => ({ id: n.id, userMessage: n.user_message, aiMessage: n.ai_message || '', degraded: false }));
    cross = chosen
      .filter((n) => !ancestorSet.has(n.id))
      .map((n) => ({ id: n.id, userMessage: n.user_message, aiMessage: n.ai_message || '', degraded: false }));
    retrieval = { selectedIds: cross.map((n) => n.id), reasoning: '手动指定' };
  } else {
    // 阶段一：跨分支检索（best-effort）。
    // 本地先剔除祖先路径上的元数据，再发送索引副本给 API（API 不再负责排除祖先）。
    const metadataIndex = treeNodes.filter((n) => !ancestorSet.has(n.id)).map(toMetaEntry);
    let ret = { selectedIds: [], reasoning: '' };
    try {
      ret = await retrieveContext({ userMessage, ancestorIds, metadataIndex });
    } catch (e) {
      console.error('retrieveContext failed, fallback to ancestors only:', e.message);
    }
    const crossNodes = ret.selectedIds
      .map((cid) => treeNodes.find((n) => n.id === cid))
      .filter(Boolean)
      .filter((n) => !ancestorSet.has(n.id)); // 本地与直接上下文合并时去重
    const built = buildContext({ ancestorChain, crossNodes, budget: 6000 });
    direct = built.direct;
    cross = built.cross;
    retrieval = ret;
  }

  // 阶段二：生成（流式或非流式）。元数据（summary/tags）在同一调用里由 API 顺带产出。
  let result = { answer: '', summary: '', tags: [] };
  try {
    if (onToken) {
      result = await generateAnswerStream({
        contextGroups: { direct, cross },
        userMessage,
        model: usedModel,
        resources,
        onToken,
      });
    } else {
      result = await generateAnswer({ contextGroups: { direct, cross }, userMessage, model: usedModel, resources });
    }
  } catch (e) {
    db.prepare("UPDATE context_elements SET status = 'error', updated_at = ? WHERE id = ?").run(now, id);
    throw e;
  }
  const answer = result.answer;
  const meta = { summary: result.summary, tags: result.tags };

  // 为每份资源生成「简介 + 标签」（Phase 4 会迁移到模块模型；此处先用主模型）
  let metas = [];
  try {
    metas = await generateResourceMetas(resources || [], usedModel);
  } catch (e) {
    console.error('generateResourceMetas failed:', e.message);
  }
  const enriched = (resources || []).map((r, i) => ({
    ...r,
    description: metas[i]?.description || '',
    tags: metas[i]?.tags || [],
  }));
  const resourceTags = enriched.flatMap((r) => r.tags || []);
  const summaryWithRes = [
    meta.summary,
    enriched.length ? '［资源］' + enriched.map((r) => r.description).filter(Boolean).join('； ') : '',
  ]
    .filter(Boolean)
    .join('\n');
  const allTags = Array.from(new Set([...(meta.tags || []), ...resourceTags])).slice(0, 8);

  const directIds = direct.map((n) => n.id);
  const crossIds = cross.map((n) => n.id);
  const trace = JSON.stringify({ direct: directIds, cross: crossIds, reasoning: retrieval.reasoning });

  db.prepare(
    `UPDATE context_elements
     SET ai_message = ?, status = 'completed', summary = ?, tags = ?,
         context_element_ids = ?, context_trace = ?, token_count = ?, resources = ?, has_resource = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    answer, summaryWithRes, JSON.stringify(allTags),
    JSON.stringify([...directIds, ...crossIds]), trace, Math.ceil(answer.length / 4),
    JSON.stringify(enriched), enriched.length ? 1 : 0, now, id
  );

  db.prepare('UPDATE conversation_trees SET updated_at = ? WHERE id = ?').run(now, treeId);
  if (!parentId) {
    db.prepare('UPDATE conversation_trees SET title = ?, root_node_id = ? WHERE id = ?')
      .run(userMessage.slice(0, 60), id, treeId);
  }

  return db.prepare('SELECT * FROM context_elements WHERE id = ?').get(id);
}

function toMetaEntry(ce) {
  let tags = [];
  try {
    tags = ce.tags ? JSON.parse(ce.tags) : [];
  } catch {
    tags = [];
  }
  return {
    id: ce.id,
    parent_id: ce.parent_id,
    depth: ce.depth,
    summary: ce.summary || '',
    tags,
    is_volatile: !!ce.is_volatile,
  };
}
