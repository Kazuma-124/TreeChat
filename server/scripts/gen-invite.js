#!/usr/bin/env node
// 生成邀请码（在服务器本地运行，无需登录）。
// 用法：node server/scripts/gen-invite.js [数量] [有效期天数]
//   node server/scripts/gen-invite.js 10 30
import db from '../db.js';
import { generateInviteCode } from '../services/auth.js';

const count = Math.max(1, parseInt(process.argv[2] || '5', 10));
const days = parseInt(process.argv[3] || '30', 10);
const now = Date.now();
const expiresAt = now + days * 24 * 60 * 60 * 1000;

const tx = db.transaction(() => {
  for (let i = 0; i < count; i++) {
    db.prepare('INSERT INTO invite_codes (code, created_at, expires_at) VALUES (?,?,?)').run(
      generateInviteCode(16),
      now,
      expiresAt
    );
  }
});
tx();

const fresh = db
  .prepare('SELECT code FROM invite_codes WHERE used_by IS NULL ORDER BY created_at DESC LIMIT ?')
  .all(count);
console.log(`已生成 ${count} 个邀请码（${days} 天内有效，过期后自动失效）：`);
for (const r of fresh) console.log('  ' + r.code);
