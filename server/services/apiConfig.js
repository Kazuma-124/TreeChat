import db from '../db.js';
import { randomUUID } from 'crypto';
import { encrypt, decrypt, isEncrypted } from './crypto.js';

// API 方案配置：完全由用户在 UI 中保存并启用（base_url / api_key / model / mock）。
// 所有方案按 user_id 隔离——不同用户互不可见、互不串用对方的 key / 配额。
// 不再依赖任何静态环境变量；未配置且未开 MOCK 时由调用方提示用户去 UI 配置。

function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '****';
  return k.slice(0, 4) + '****' + k.slice(-4);
}

function parseJSON(s, fallback) {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

export function listConfigs(userId) {
  const rows = db
    .prepare(
      'SELECT id, name, base_url, api_key, model, is_mock, is_active, paired_models, created_at, updated_at FROM api_configs WHERE user_id = ? ORDER BY is_active DESC, updated_at DESC'
    )
    .all(userId);
  return rows.map((r) => ({ ...r, api_key: maskKey(decrypt(r.api_key)), paired_models: parseJSON(r.paired_models, []) }));
}

export function getConfig(userId, id) {
  const row = db.prepare('SELECT * FROM api_configs WHERE id = ? AND user_id = ?').get(id, userId) || null;
  if (row) {
    const dk = decrypt(row.api_key);
    // 解密失败（主密钥已变更）：返回空串，强制用户在编辑表单重新填入，避免把密文二次加密。
    row.api_key = isEncrypted(dk) ? '' : dk;
    row.paired_models = parseJSON(row.paired_models, []);
  }
  return row;
}

export function getActiveConfig(userId) {
  const row = db.prepare('SELECT * FROM api_configs WHERE user_id = ? AND is_active = 1 LIMIT 1').get(userId);
  if (row) {
    const dk = decrypt(row.api_key);
    if (isEncrypted(dk)) {
      // 主密钥不匹配导致无法解密：抛出清晰可执行的错误，而非把密文当作 Key 发给 LLM（会误报 401）。
      throw new Error(
        `API Key 解密失败：主密钥已变更，密文无法还原。请在「⚙ API」中删除并重新添加方案「${row.name}」`
      );
    }
    row.api_key = dk;
  }
  // 未配置任何方案时返回 null，由 chatGenerator 等调用方决定走 MOCK 还是提示用户配置。
  return row || null;
}

export function createConfig(userId, { name, base_url, api_key, model, is_mock, paired_models }) {
  const id = randomUUID();
  const now = Date.now();
  const exists = db.prepare('SELECT COUNT(*) AS c FROM api_configs WHERE user_id = ?').get(userId).c;
  const is_active = exists === 0 ? 1 : 0; // 首个配置自动启用
  db.prepare(
    `INSERT INTO api_configs (id, name, base_url, api_key, model, is_mock, is_active, paired_models, user_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, name, base_url, encrypt(api_key), model, is_mock ? 1 : 0, is_active, JSON.stringify(paired_models || []), userId, now, now);
  return getConfig(userId, id);
}

export function updateConfig(userId, id, fields) {
  const cur = getConfig(userId, id);
  if (!cur) return null;
  const name = fields.name ?? cur.name;
  const base_url = fields.base_url ?? cur.base_url;
  // 编辑表单回填的是已解密明文，这里一律重新加密后写回。
  const api_key = fields.api_key != null ? encrypt(fields.api_key) : cur.api_key;
  const model = fields.model ?? cur.model;
  const is_mock = fields.is_mock !== undefined ? (fields.is_mock ? 1 : 0) : cur.is_mock;
  const paired_models = fields.paired_models != null ? JSON.stringify(fields.paired_models) : cur.paired_models;
  db.prepare(
    'UPDATE api_configs SET name=?, base_url=?, api_key=?, model=?, is_mock=?, paired_models=?, updated_at=? WHERE id=? AND user_id=?'
  ).run(name, base_url, api_key, model, is_mock, paired_models, Date.now(), id, userId);
  return getConfig(userId, id);
}

// 启动迁移：将历史明文 api_key 重新加密（已加密的跳过）。
export function migratePlaintextKeys() {
  const rows = db.prepare('SELECT id, api_key FROM api_configs').all();
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (r.api_key && !isEncrypted(r.api_key)) {
        db.prepare('UPDATE api_configs SET api_key=? WHERE id=?').run(encrypt(r.api_key), r.id);
      }
    }
  });
  tx();
}

export function deleteConfig(userId, id) {
  db.prepare('DELETE FROM api_configs WHERE id = ? AND user_id = ?').run(id, userId);
  const still = db.prepare('SELECT COUNT(*) AS c FROM api_configs WHERE user_id = ? AND is_active = 1').get(userId).c;
  if (still === 0) {
    const next = db.prepare('SELECT id FROM api_configs WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1').get(userId);
    if (next) setActive(userId, next.id);
  }
}

export function setActive(userId, id) {
  db.prepare('UPDATE api_configs SET is_active = 0 WHERE user_id = ?').run(userId);
  db.prepare('UPDATE api_configs SET is_active = 1, updated_at = ? WHERE id = ? AND user_id = ?').run(Date.now(), id, userId);
}
