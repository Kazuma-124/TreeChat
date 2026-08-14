import { Router } from 'express';
import db from '../db.js';
import { processMessage } from '../services/messageProcessor.js';

const router = Router();

// 非流式发送（保留兼容 / 测试用）
router.post('/send', async (req, res) => {
  try {
    const { treeId, parentId, userMessage, model, isVolatile, contextElementIds, resources } = req.body;
    const node = await processMessage({ treeId, parentId, userMessage, model, isVolatile, contextElementIds, resources });
    res.json(node);
  } catch (e) {
    console.error(e);
    const status = /not found/.test(e.message) ? 404 : /required|parentId/.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

// SSE 流式发送：返回 text/event-stream，事件 start / token / done / error
router.post('/stream', async (req, res) => {
  try {
    const { treeId, parentId, userMessage, model, isVolatile, contextElementIds, resources } = req.body;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const node = await processMessage({
      treeId,
      parentId,
      userMessage,
      model,
      isVolatile,
      contextElementIds,
      resources,
      onStart: (info) => send('start', info),
      onToken: (delta) => send('token', { delta }),
    });
    send('done', node);
    res.end();
  } catch (e) {
    console.error(e);
    // 若已写入头部，用 SSE 事件报错；否则普通 JSON
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
      res.end();
    } else {
      const status = /not found/.test(e.message) ? 404 : 400;
      res.status(status).json({ error: e.message });
    }
  }
});

// 手动编辑节点标签（Phase 4）
router.patch('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const tags = req.body?.tags;
    if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });
    const node = db.prepare('SELECT * FROM context_elements WHERE id = ?').get(id);
    if (!node) return res.status(404).json({ error: 'node not found' });
    db.prepare('UPDATE context_elements SET tags = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(tags),
      Date.now(),
      id
    );
    res.json({ ok: true, id, tags });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// 删除节点：mode=merge 把子节点提升为兄弟（合并到父路径），mode=discard 直接删除（含子树）
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const mode = req.query.mode === 'merge' ? 'merge' : 'discard';
    const node = db.prepare('SELECT * FROM context_elements WHERE id = ?').get(id);
    if (!node) return res.status(404).json({ error: 'node not found' });

    const children = db.prepare('SELECT * FROM context_elements WHERE parent_id = ?').all(id);
    const tree = db.prepare('SELECT * FROM conversation_trees WHERE id = ?').get(node.tree_id);
    const isRoot = !!tree && tree.root_node_id === id;

    const del = db.transaction(() => {
      if (mode === 'merge' && children.length) {
        // 子节点提升为被删节点的兄弟（沿用其 parent_id / depth；sibling 排在已有兄弟之后）。
        // 用 IS ? 以正确统计 parent_id 为 NULL 的顶层节点（= NULL 在 SQL 中不命中，必须用 IS）。
        const baseSibling = db
          .prepare('SELECT COUNT(*) AS c FROM context_elements WHERE parent_id IS ?')
          .get(node.parent_id ?? null).c;
        children.forEach((c, i) => {
          db.prepare(
            'UPDATE context_elements SET parent_id = ?, sibling_index = ?, depth = ? WHERE id = ?'
          ).run(node.parent_id ?? null, baseSibling + i, node.depth || 0, c.id);
        });
        // 提升完子节点后，再删除本节点自身（此时它已无子节点）
        db.prepare('DELETE FROM context_elements WHERE id = ?').run(id);
      } else {
        // discard：递归删除子树
        const stack = [id];
        while (stack.length) {
          const cur = stack.pop();
          const kids = db.prepare('SELECT id FROM context_elements WHERE parent_id = ?').all(cur);
          for (const k of kids) stack.push(k.id);
          db.prepare('DELETE FROM context_elements WHERE id = ?').run(cur);
        }
      }

      // 被删节点恰为树的根时，重选 root_node_id，避免指向已不存在的节点
      if (isRoot) {
        if (mode === 'merge' && children.length) {
          const nr = children[0];
          db.prepare('UPDATE conversation_trees SET root_node_id = ?, title = ? WHERE id = ?')
            .run(nr.id, (nr.user_message || '').slice(0, 60), tree.id);
        } else {
          const another = db
            .prepare('SELECT * FROM context_elements WHERE tree_id = ? AND parent_id IS NULL LIMIT 1')
            .get(tree.id);
          db.prepare('UPDATE conversation_trees SET root_node_id = ?, title = ? WHERE id = ?')
            .run(
              another ? another.id : null,
              another ? (another.user_message || '').slice(0, 60) : tree.title,
              tree.id
            );
        }
      }

      db.prepare('UPDATE conversation_trees SET updated_at = ? WHERE id = ?').run(Date.now(), node.tree_id);
    });
    del();

    res.json({ ok: true, mode, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
