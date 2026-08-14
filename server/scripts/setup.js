#!/usr/bin/env node
// 创建管理员账号（在服务器本地运行，绕过邀请码）。
// 用法：node server/scripts/setup.js <用户名> <密码>
import db from '../db.js';
import { hashPassword } from '../services/auth.js';
import { randomUUID } from 'crypto';

const [, , username, password] = process.argv;
if (!username || !password) {
  console.error('用法: node server/scripts/setup.js <用户名> <密码>');
  process.exit(1);
}
if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
  console.error('用户名已存在');
  process.exit(1);
}
const hash = await hashPassword(password);
db.prepare(
  'INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?,?,?,1,?)'
).run(randomUUID(), username, hash, Date.now());
console.log('管理员账号已创建:', username);
