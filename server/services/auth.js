import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_PATH = path.resolve(__dirname, '..', '.masterkey');

// JWT 密钥与 API Key 加密主密钥同源：环境变量 TREECHAT_MASTER_KEY > server/.masterkey
function jwtSecret() {
  const env = process.env.TREECHAT_MASTER_KEY;
  if (env && env.length) return env;
  try {
    if (existsSync(KEY_PATH)) {
      const raw = readFileSync(KEY_PATH, 'utf8').trim();
      if (raw) return raw;
    }
  } catch {
    /* 忽略 */
  }
  return 'treechat-default-jwt-secret';
}

const TOKEN_TTL = process.env.JWT_TTL || '7d';

// 密码哈希（bcrypt，纯 JS 实现，免原生编译）
export function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// 签发 / 验证 JWT（payload 含 sub=userId、username、isAdmin）
export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, isAdmin: !!user.is_admin },
    jwtSecret(),
    { expiresIn: TOKEN_TTL }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, jwtSecret());
}

// 生成加密随机的邀请码（默认 16 字节 = 32 位 hex，不可枚举）
export function generateInviteCode(bytes = 16) {
  return randomBytes(bytes).toString('hex');
}
