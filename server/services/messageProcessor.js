import { randomUUID } from 'crypto';
import db from '../db.js';
import { getAncestorChain } from './treeTraversal.js';
import { retrieveContext } from './contextRetriever.js';
import { generateMetadata } from './metadataGenerator.js';
import { buildContext } from './contextBuilder.js';
import { generateAnswer, generateAnswerStream } from './chatGenerator.js';

// 发送消息的统一核心：建节点(pending) → 检索 → 组装 → 生成(可流式) → 元数据 → 落库。
// onStart: 节点建好后回调 {id}（流式场景用于前端占位）
// onToken: 每个 token 块回调（流式场景）
// 返回最终完整节点对象。
export async function processMessage({ treeId, parentId, userMessage, model, isVolatile, contextElementIds, onStart, onToken }) {
  const tree = db.prepare('SELECT * FROM conversation_trees WHERE id = ?').get(treeId);
  if (!tree) throw new Error('tree not found');
  if (!userMessage) throw new Error('userMessage required');

  let depth = 0;
  let siblingIndex = 0;
  if (parentId) {
    const parent = db.prepare('SELECT * FROM context_elements WHERE id = ?').get(parentId);
    if (!parent) throw new Error('parentId not found');
    depth = parent.depth + 1;
    siblingIndex = db.prepare('SELECT COUNT(*) AS c FROM context_elements WHERE parent_id = ?').get(parentId).c;
  }

  const id = randomUUID();
  const now = Date.now();
  const usedModel = model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const ancestorChain = parentId ? getAncestorChain(parentId) : [];
  const ancestorIds = ancestorChain.map((n) => n.id);

  // 先落库 pending，并通知前端（流式场景）
  db.prepare(
    `INSERT INTO context_elements
      (id, tree_id, parent_id, sibling_index, depth, user_message, ai_message,
       model, model_config, status, is_volatile, created_at, updated_at)
     VALUES (?,?,?,?,?,?,NULL,?,?, 'pending', ?, ?, ?)`
  ).run(id, treeId, parentId ?? null, siblingIndex, depth, userMessage, usedModel, '{}', isVolatile ? 1 : 0, now, now);
  if (onStart) onStart({ id, treeId, parentId, userMessage });

  // 组装上下文（直接 / 跨分支）
  const treeNodes = db.prepare('SELECT * FROM context_elements WHERE tree_id = ?').all(treeId);
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
    // 阶段一：跨分支检索（best-effort）
    const metadataIndex = treeNodes.map(toMetaEntry);
    let ret = { selectedIds: [], reasoning: '' };
    try {
      ret = await retrieveContext({ userMessage, ancestorIds, metadataIndex });
    } catch (e) {
      console.error('retrieveContext failed, fallback to ancestors only:', e.message);
    }
    const crossNodes = ret.selectedIds
      .map((cid) => treeNodes.find((n) => n.id === cid))
      .filter(Boolean);
    const built = buildContext({ ancestorChain, crossNodes, budget: 6000 });
    direct = built.direct;
    cross = built.cross;
    retrieval = ret;
  }

  // 阶段二：生成（流式或非流式）
  let answer = '';
  try {
    if (onToken) {
      answer = await generateAnswerStream({
        contextGroups: { direct, cross },
        userMessage,
        model: usedModel,
        onToken,
      });
    } else {
      answer = await generateAnswer({ contextGroups: { direct, cross }, userMessage, model: usedModel });
    }
  } catch (e) {
    db.prepare("UPDATE context_elements SET status = 'error', updated_at = ? WHERE id = ?").run(now, id);
    throw e;
  }

  // 元数据（best-effort）
  let meta = { summary: '', tags: [] };
  try {
    meta = await generateMetadata({ userMessage, aiMessage: answer });
  } catch (e) {
    console.error('generateMetadata failed:', e.message);
  }

  const directIds = direct.map((n) => n.id);
  const crossIds = cross.map((n) => n.id);
  const trace = JSON.stringify({ direct: directIds, cross: crossIds, reasoning: retrieval.reasoning });

  db.prepare(
    `UPDATE context_elements
     SET ai_message = ?, status = 'completed', summary = ?, tags = ?,
         context_element_ids = ?, context_trace = ?, token_count = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    answer, meta.summary, JSON.stringify(meta.tags),
    JSON.stringify([...directIds, ...crossIds]), trace, Math.ceil(answer.length / 4), now, id
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
