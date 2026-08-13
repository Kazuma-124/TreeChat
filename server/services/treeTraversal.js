import db from '../db.js';

// 从 nodeId 沿 parent_id 向上回溯，返回 根 → ... → node 的链（含 node）。
// 用于构建"祖先路径"直接上下文。
export function getAncestorChain(nodeId) {
  const chain = [];
  let cur = nodeId ? db.prepare('SELECT * FROM context_elements WHERE id = ?').get(nodeId) : null;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent_id
      ? db.prepare('SELECT * FROM context_elements WHERE id = ?').get(cur.parent_id)
      : null;
  }
  return chain;
}
