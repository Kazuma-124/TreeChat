import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// 可经环境变量覆盖 DB 路径（部署时挂载独立数据卷 / 测试时隔离用）；默认 data/treechat.db
const DB_PATH = process.env.TREECHAT_DB_PATH || path.join(dataDir, 'treechat.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invite_codes (
  code        TEXT PRIMARY KEY,
  created_by  TEXT,
  used_by     TEXT,
  used_at     INTEGER,
  expires_at  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_trees (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  root_node_id  TEXT,
  user_id       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS context_elements (
  id                  TEXT PRIMARY KEY,
  tree_id             TEXT NOT NULL,
  parent_id           TEXT,
  sibling_index       INTEGER NOT NULL DEFAULT 0,
  depth               INTEGER NOT NULL DEFAULT 0,
  user_message        TEXT NOT NULL,
  ai_message          TEXT,
  model               TEXT,
  model_config        TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  summary             TEXT,
  tags                TEXT,
  token_count         INTEGER NOT NULL DEFAULT 0,
  context_element_ids TEXT,
  embedding           TEXT,
  resources           TEXT,
  is_volatile         INTEGER NOT NULL DEFAULT 0,
  has_resource        INTEGER NOT NULL DEFAULT 0,
  user_id             TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_configs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  api_key     TEXT NOT NULL,
  model       TEXT NOT NULL,
  is_mock     INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 0,
  paired_models TEXT,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ce_tree   ON context_elements(tree_id);
CREATE INDEX IF NOT EXISTS idx_ce_parent ON context_elements(parent_id);
CREATE INDEX IF NOT EXISTS idx_tree_user ON conversation_trees(user_id);
CREATE INDEX IF NOT EXISTS idx_ce_user   ON context_elements(user_id);
CREATE INDEX IF NOT EXISTS idx_cfg_user  ON api_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_cfg_active ON api_configs(user_id, is_active);
`);

// 开发期表已存在时，CREATE TABLE 不会自动加列，这里做轻量迁移
function addColumnIfNotExists(table, column, ddl) {
  const cols = db.pragma(`table_info(${table})`).map((c) => c.name);
  if (!cols.includes(column)) db.exec(ddl);
}
addColumnIfNotExists(
  'context_elements',
  'context_trace',
  'ALTER TABLE context_elements ADD COLUMN context_trace TEXT'
);
addColumnIfNotExists(
  'context_elements',
  'resources',
  'ALTER TABLE context_elements ADD COLUMN resources TEXT'
);
addColumnIfNotExists(
  'context_elements',
  'has_resource',
  'ALTER TABLE context_elements ADD COLUMN has_resource INTEGER NOT NULL DEFAULT 0'
);
addColumnIfNotExists(
  'api_configs',
  'paired_models',
  'ALTER TABLE api_configs ADD COLUMN paired_models TEXT'
);
addColumnIfNotExists(
  'conversation_trees',
  'user_id',
  "ALTER TABLE conversation_trees ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"
);
addColumnIfNotExists(
  'context_elements',
  'user_id',
  "ALTER TABLE context_elements ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"
);
addColumnIfNotExists(
  'api_configs',
  'user_id',
  "ALTER TABLE api_configs ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"
);

// 旧数据无主（user_id 为空）按需求直接清空，避免无归属数据泄露 / 越权访问
db.exec(`
  DELETE FROM context_elements WHERE user_id IS NULL OR user_id = '';
  DELETE FROM conversation_trees WHERE user_id IS NULL OR user_id = '';
  DELETE FROM api_configs WHERE user_id IS NULL OR user_id = '';
`);

export default db;
