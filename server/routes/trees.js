import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db.js';

const router = Router();

// 列出所有对话树
router.get('/', (_req, res) => {
  const trees = db
    .prepare('SELECT * FROM conversation_trees ORDER BY updated_at DESC')
    .all();
  res.json(trees);
});

// 创建新对话树
router.post('/', (req, res) => {
  const id = randomUUID();
  const now = Date.now();
  const title = req.body?.title || '新对话树';
  db.prepare(
    'INSERT INTO conversation_trees (id, title, root_node_id, created_at, updated_at) VALUES (?,?,NULL,?,?)'
  ).run(id, title, now, now);
  const tree = db.prepare('SELECT * FROM conversation_trees WHERE id = ?').get(id);
  res.status(201).json(tree);
});

// 获取单棵树 + 其全部节点（前端据此构建树结构）
router.get('/:id', (req, res) => {
  const tree = db.prepare('SELECT * FROM conversation_trees WHERE id = ?').get(req.params.id);
  if (!tree) return res.status(404).json({ error: 'tree not found' });
  const nodes = db
    .prepare('SELECT * FROM context_elements WHERE tree_id = ? ORDER BY created_at ASC')
    .all(tree.id);
  res.json({ ...tree, nodes });
});

// 删除整棵对话树：事务内级联删除其全部节点（含 tags/summary/embedding/context_trace 等元数据列）与该树记录
router.delete('/:id', (req, res) => {
  try {
    const tree = db.prepare('SELECT * FROM conversation_trees WHERE id = ?').get(req.params.id);
    if (!tree) return res.status(404).json({ error: 'tree not found' });
    const delNodes = db.prepare('DELETE FROM context_elements WHERE tree_id = ?');
    const delTree = db.prepare('DELETE FROM conversation_trees WHERE id = ?');
    const tx = db.transaction(() => {
      delNodes.run(tree.id);
      delTree.run(tree.id);
    });
    tx();
    res.json({ ok: true, id: tree.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// 重命名对话树
router.patch('/:id', (req, res) => {
  try {
    const tree = db.prepare('SELECT * FROM conversation_trees WHERE id = ?').get(req.params.id);
    if (!tree) return res.status(404).json({ error: 'tree not found' });
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) return res.status(400).json({ error: 'title required' });
    db.prepare('UPDATE conversation_trees SET title = ?, updated_at = ? WHERE id = ?').run(
      title,
      Date.now(),
      tree.id
    );
    const updated = db.prepare('SELECT * FROM conversation_trees WHERE id = ?').get(tree.id);
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// 导出：?format=json（默认）| md
router.get('/:id/export', (req, res) => {
  const tree = db.prepare('SELECT * FROM conversation_trees WHERE id = ?').get(req.params.id);
  if (!tree) return res.status(404).json({ error: 'tree not found' });
  const nodes = db
    .prepare('SELECT * FROM context_elements WHERE tree_id = ? ORDER BY created_at ASC')
    .all(tree.id);

  const baseName = (tree.title || 'tree').replace(/[^\w.-]/g, '_') || 'tree';

  if (req.query.format === 'md') {
    const md = toMarkdown(tree, nodes);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    // RFC 5987: raw UTF-8 title may contain chars invalid for header values; encode it.
    const utf8Name = encodeURIComponent(`${tree.title || 'tree'}.md`);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${baseName}.md"; filename*=UTF-8''${utf8Name}`
    );
    return res.send(md);
  }

  res.setHeader('Content-Disposition', `attachment; filename="${baseName}.json"`);
  res.json({ tree, nodes });
});

// 导入：接收导出格式的 { tree, nodes }，重建为新树（重新生成 id 并映射 parent_id）
router.post('/import', (req, res) => {
  const { tree, nodes } = req.body || {};
  if (!Array.isArray(nodes) || !nodes.length) {
    return res.status(400).json({ error: 'invalid import payload' });
  }
  const newTreeId = randomUUID();
  const now = Date.now();
  const title = tree?.title || '导入的对话树';

  const idMap = {};
  for (const n of nodes) idMap[n.id] = randomUUID();

  db.prepare(
    'INSERT INTO conversation_trees (id, title, root_node_id, created_at, updated_at) VALUES (?,?,?,?,?)'
  ).run(newTreeId, title, idMap[nodes[0].id] || null, now, now);

  const insert = db.prepare(
    `INSERT INTO context_elements
      (id, tree_id, parent_id, sibling_index, depth, user_message, ai_message, model,
       model_config, status, summary, tags, token_count, context_element_ids, embedding, is_volatile, created_at, updated_at)
     VALUES (@id,@tree_id,@parent_id,@sibling_index,@depth,@user_message,@ai_message,@model,@model_config,'completed',@summary,@tags,@token_count,@context_element_ids,@embedding,@is_volatile,@created_at,@updated_at)`
  );
  const importNow = Date.now();
  for (const n of nodes) {
    insert.run({
      id: idMap[n.id],
      tree_id: newTreeId,
      parent_id: n.parent_id ? idMap[n.parent_id] ?? null : null,
      sibling_index: n.sibling_index || 0,
      depth: n.depth || 0,
      user_message: n.user_message || '',
      ai_message: n.ai_message ?? null,
      model: n.model ?? null,
      model_config: n.model_config ?? '{}',
      summary: n.summary ?? null,
      tags: n.tags ?? null,
      token_count: n.token_count || 0,
      context_element_ids: n.context_element_ids ?? null,
      embedding: n.embedding ?? null,
      is_volatile: n.is_volatile ? 1 : 0,
      created_at: importNow,
      updated_at: importNow,
    });
  }

  const created = db.prepare('SELECT * FROM conversation_trees WHERE id = ?').get(newTreeId);
  res.status(201).json(created);
});

function toMarkdown(tree, nodes) {
  const lines = [`# ${tree.title || '对话树'}`, ''];
  for (const n of nodes) {
    const indent = '  '.repeat(n.depth || 0);
    lines.push(`${indent}> **Q:** ${n.user_message || ''}`);
    if (n.ai_message) lines.push(`${indent}> **A:** ${n.ai_message}`);
    if (n.summary) lines.push(`${indent}> *摘要: ${n.summary}*`);
    lines.push('');
  }
  return lines.join('\n');
}

export default router;
// test
// t
