import db from '../db.js';
import { randomUUID } from 'crypto';
import { encrypt, decrypt, isEncrypted } from './crypto.js';

// API 方案配置：用户可在 UI 中保存多套（base_url / api_key / model / mock）。
// 无 DB 配置时回退到环境变量，保证旧部署与 MOCK 模式仍可工作。

function envFallback() {
  return {
    id: 'env',
    name: '环境变量（默认）',
    base_url: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    api_key: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    is_mock: process.env.MOCK_LLM === '1' || process.env.MOCK_LLM === 'true' ? 1 : 0,
    is_active: 0,
    created_at: 0,
    updated_at: 0,
  };
}

function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '****';
  return k.slice(0, 4) + '****' + k.slice(-4);
}

export function listConfigs() {
  const rows = db
    .prepare(
      'SELECT id, name, base_url, api_key, model, is_mock, is_active, created_at, updated_at FROM api_configs ORDER BY is_active DESC, updated_at DESC'
    )
    .all();
  return rows.map((r) => ({ ...r, api_key: maskKey(decrypt(r.api_key)) }));
}

export function getConfig(id) {
  const row = db.prepare('SELECT * FROM api_configs WHERE id = ?').get(id) || null;
  if (row) row.api_key = decrypt(row.api_key);
  return row;
}

export function getActiveConfig() {
  const row = db.prepare('SELECT * FROM api_configs WHERE is_active = 1 LIMIT 1').get();
  if (row) row.api_key = decrypt(row.api_key);
  return row || envFallback();
}

export function createConfig({ name, base_url, api_key, model, is_mock }) {
  const id = randomUUID();
  const now = Date.now();
  const exists = db.prepare('SELECT COUNT(*) AS c FROM api_configs').get().c;
  const is_active = exists === 0 ? 1 : 0; // 首个配置自动启用
  db.prepare(
    `INSERT INTO api_configs (id, name, base_url, api_key, model, is_mock, is_active, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, name, base_url, encrypt(api_key), model, is_mock ? 1 : 0, is_active, now, now);
  return getConfig(id);
}

export function updateConfig(id, fields) {
  const cur = getConfig(id);
  if (!cur) return null;
  const name = fields.name ?? cur.name;
  const base_url = fields.base_url ?? cur.base_url;
  // 编辑表单回填的是已解密明文，这里一律重新加密后写回。
  const api_key = fields.api_key != null ? encrypt(fields.api_key) : cur.api_key;
  const model = fields.model ?? cur.model;
  const is_mock = fields.is_mock !== undefined ? (fields.is_mock ? 1 : 0) : cur.is_mock;
  db.prepare(
    'UPDATE api_configs SET name=?, base_url=?, api_key=?, model=?, is_mock=?, updated_at=? WHERE id=?'
  ).run(name, base_url, api_key, model, is_mock, Date.now(), id);
  return getConfig(id);
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

export function deleteConfig(id) {
  db.prepare('DELETE FROM api_configs WHERE id = ?').run(id);
  const still = db.prepare('SELECT COUNT(*) AS c FROM api_configs WHERE is_active = 1').get().c;
  if (still === 0) {
    const next = db.prepare('SELECT id FROM api_configs ORDER BY updated_at DESC LIMIT 1').get();
    if (next) setActive(next.id);
  }
}

export function setActive(id) {
  db.prepare('UPDATE api_configs SET is_active = 0').run();
  db.prepare('UPDATE api_configs SET is_active = 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
}
