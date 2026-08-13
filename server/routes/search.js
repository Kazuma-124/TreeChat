import { Router } from 'express';
import db from '../db.js';

const router = Router();

// 跨树全文搜索上下文元素（CE）：匹配提问 / 回答 / 摘要 / 标签
// 返回 { id, tree_id, tree_title, user_message, ai_message, summary, depth, tags }
router.get('/', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT ce.id, ce.tree_id, t.title AS tree_title, ce.user_message,
              ce.ai_message, ce.summary, ce.depth, ce.tags
       FROM context_elements ce
       JOIN conversation_trees t ON t.id = ce.tree_id
       WHERE ce.user_message LIKE ?
          OR ce.ai_message LIKE ?
          OR ce.summary LIKE ?
          OR ce.tags LIKE ?
       ORDER BY ce.updated_at DESC
       LIMIT 50`
    )
    .all(like, like, like, like);
  res.json(rows);
});

export default router;
