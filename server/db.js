import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'treechat.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS conversation_trees (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  root_node_id  TEXT,
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
  is_volatile         INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ce_tree   ON context_elements(tree_id);
CREATE INDEX IF NOT EXISTS idx_ce_parent ON context_elements(parent_id);
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

export default db;
