import { Router } from 'express';
import db from '../db.js';

const router = Router();

// 跨树全文搜索上下文元素（CE）：匹配提问 / 回答 / 摘要 / 标签 / 资源描述(文件名、标签)
// 资源里的 base64 原文(content)不参与匹配，避免误命中与性能浪费。
// 返回 { id, tree_id, tree_title, user_message, ai_message, summary, depth, tags }

// 从 resources JSON 中抽取「可搜索文本」（描述/文件名/标签），不含 base64 原文
function resourceSearchText(resourcesJson) {
  if (!resourcesJson) return '';
  let arr;
  try {
    arr = JSON.parse(resourcesJson);
  } catch {
    return '';
  }
  if (!Array.isArray(arr)) return '';
  const parts = [];
  for (const r of arr) {
    if (r?.description) parts.push(r.description);
    if (r?.filename) parts.push(r.filename);
    if (Array.isArray(r?.tags)) parts.push(r.tags.join(' '));
  }
  return parts.join(' ').toLowerCase();
}

const SELECT_COLS = `ce.id, ce.tree_id, t.title AS tree_title, ce.user_message,
                     ce.ai_message, ce.summary, ce.depth, ce.tags`;

router.get('/', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const needle = q.toLowerCase();

  // 1) 文本列匹配（SQL LIKE，沿用原逻辑）
  const textRows = db
    .prepare(
      `SELECT ${SELECT_COLS}
       FROM context_elements ce
       JOIN conversation_trees t ON t.id = ce.tree_id
       WHERE ce.user_message LIKE ?
          OR ce.ai_message LIKE ?
          OR ce.summary LIKE ?
          OR ce.tags LIKE ?
       ORDER BY ce.updated_at DESC`
    )
    .all(like, like, like, like);

  // 2) 资源描述匹配：先用 LIKE 收窄候选（含 base64 噪声），再在 JS 层仅比对描述/文件名/标签
  const resCandidates = db
    .prepare(
      `SELECT ${SELECT_COLS}
       FROM context_elements ce
       JOIN conversation_trees t ON t.id = ce.tree_id
       WHERE ce.resources LIKE ?
       ORDER BY ce.updated_at DESC`
    )
    .all(like);

  const seen = new Set();
  const out = [];
  for (const row of textRows) {
    seen.add(row.id);
    out.push(row);
  }
  for (const row of resCandidates) {
    if (seen.has(row.id)) continue;
    if (resourceSearchText(row.resources).includes(needle)) {
      seen.add(row.id);
      out.push(row);
    }
  }

  out.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  res.json(out.slice(0, 50));
});

export default router;
