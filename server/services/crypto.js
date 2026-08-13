import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// API Key 静态加密（AES-256-GCM）。
// - 写入 DB 前 encrypt()，读取/调用前 decrypt()。
// - 密文带 `enc:v1:` 前缀，便于与历史明文区分、做迁移。
// - 主密钥优先级：环境变量 TREECHAT_MASTER_KEY > server/.masterkey（自动生成，gitignore）> 兜底常量。
//   主密钥本身永入 DB，因此拿到数据库文件也无法还原明文 Key。

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.masterkey');

function normalizeKey(raw) {
  // AES-256 需要 32 字节，从任意长度的原始串确定性派生。
  return createHash('sha256').update(String(raw), 'utf8').digest();
}

let cachedKey = null;
function getMasterKey() {
  if (cachedKey) return cachedKey;
  const envKey = process.env.TREECHAT_MASTER_KEY;
  if (envKey && envKey.length) {
    cachedKey = normalizeKey(envKey);
    return cachedKey;
  }
  try {
    if (existsSync(KEY_PATH)) {
      const raw = readFileSync(KEY_PATH, 'utf8').trim();
      if (raw) {
        cachedKey = normalizeKey(raw);
        return cachedKey;
      }
    }
    // 首次运行且无 env 配置：自动生成密钥文件（权限 0600）。
    const generated = randomBytes(32).toString('hex');
    writeFileSync(KEY_PATH, generated, { mode: 0o600 });
    cachedKey = normalizeKey(generated);
    return cachedKey;
  } catch {
    // 极端情况（无文件系统写权限）：退回固定兜底串，仅避免崩溃，安全性弱。
    cachedKey = normalizeKey('treechat-default-master-key');
    return cachedKey;
  }
}

export function encrypt(plain) {
  if (plain == null || plain === '') return plain;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getMasterKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decrypt(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value; // 明文 / 旧数据原样返回
  try {
    const [ivHex, tagHex, ctHex] = value.slice(PREFIX.length).split(':');
    if (!ivHex || !tagHex || !ctHex) return value;
    const decipher = createDecipheriv(ALGO, getMasterKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    // 主密钥不匹配或数据损坏：返回原文，避免整体崩溃（调用方会因 Key 非法而报 API 错误）。
    return value;
  }
}

export function isEncrypted(v) {
  return typeof v === 'string' && v.startsWith(PREFIX);
}
