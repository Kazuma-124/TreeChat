import { Router } from 'express';
import { randomUUID } from 'crypto';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { hashPassword, verifyPassword, signToken } from '../services/auth.js';

const router = Router();

// 登录/注册防爆破：每 15 分钟每 IP 最多 20 次
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '尝试过于频繁，请稍后再试' },
});

// 注册：账号 + 密码 + 邀请码。
// 例外：当系统无任何用户时（首次部署），为引导管理员，免邀请码且自动成为管理员。
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, password, inviteCode } = req.body || {};
    const u = String(username || '').trim();
    const p = String(password || '');
    if (u.length < 3) return res.status(400).json({ error: '用户名至少 3 个字符' });
    if (p.length < 6) return res.status(400).json({ error: '密码至少 6 个字符' });

    if (db.prepare('SELECT id FROM users WHERE username = ?').get(u)) {
      return res.status(409).json({ error: '用户名已存在' });
    }

    const isBootstrap = db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;
    let codeRow = null;
    if (!isBootstrap) {
      if (!inviteCode) return res.status(400).json({ error: '需要邀请码' });
      codeRow = db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(String(inviteCode));
      if (!codeRow) return res.status(400).json({ error: '邀请码无效' });
      if (codeRow.used_by) return res.status(400).json({ error: '邀请码已被使用' });
      if (codeRow.expires_at && codeRow.expires_at < Date.now()) {
        return res.status(400).json({ error: '邀请码已过期' });
      }
    }

    const id = randomUUID();
    const now = Date.now();
    const hash = await hashPassword(p);

    // 事务内原子占用邀请码（防并发重复注册），仅当 used_by 仍为空时才标记
    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?,?,?,?,?)'
      ).run(id, u, hash, isBootstrap ? 1 : 0, now);
      if (codeRow) {
        const r = db
          .prepare('UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL')
          .run(id, now, codeRow.code);
        if (r.changes === 0) throw new Error('邀请码已被使用');
      }
    });
    tx();

    const created = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(id);
    res.status(201).json({
      token: signToken(created),
      user: { id: created.id, username: created.username, is_admin: !!created.is_admin },
    });
  } catch (e) {
    if (e.message === '邀请码已被使用') return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: '注册失败' });
  }
});

// 登录
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const u = String(username || '').trim();
    const p = String(password || '');
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(u);
    if (!row) return res.status(401).json({ error: '用户名或密码错误' });
    if (!(await verifyPassword(p, row.password_hash))) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    res.json({
      token: signToken(row),
      user: { id: row.id, username: row.username, is_admin: !!row.is_admin },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
