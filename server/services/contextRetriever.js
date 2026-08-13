import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RETRIEVE_PROMPT = fs.readFileSync(
  path.join(__dirname, '..', 'prompts', 'retrieve.txt'),
  'utf-8'
);

const MOCK = process.env.MOCK_LLM === '1' || process.env.MOCK_LLM === 'true';

function tokenize(s) {
  return (s || '')
    .toLowerCase()
    .split(/[\s,，。、？?！!；;:：""''()（）\[\]【】]+/)
    .filter(Boolean);
}

// 方案C 预筛（离线可测，解决「元数据过大」）：在发给 LLM 前压缩候选集。
// - 祖先链恒保留
// - 候选按下述规则打分：与提问共享 tag(+2) / 摘要含提问词(+1)
// - 优先保留命中项，按 keepRatio 比例补回未命中项以保持召回广度
export function prefilterCandidates(
  userMessage,
  metadataIndex,
  { ancestorIds = [], keepRatio = 0.6 } = {}
) {
  const qWords = new Set(tokenize(userMessage));
  const ancestors = new Set(ancestorIds);
  const candidates = metadataIndex.filter((m) => !ancestors.has(m.id));

  const scored = candidates.map((m) => {
    const tags = (m.tags || []).map((t) => String(t).toLowerCase());
    let score = 0;
    for (const tag of tags) if (qWords.has(tag)) score += 2;
    const summary = (m.summary || '').toLowerCase();
    for (const w of qWords) if (w.length >= 2 && summary.includes(w)) score += 1;
    return { m, score };
  });

  const matched = scored.filter((x) => x.score > 0).map((x) => x.m);
  const rest = scored.filter((x) => x.score === 0).map((x) => x.m);
  const cap = Math.max(matched.length, Math.ceil(metadataIndex.length * keepRatio));
  const kept = [...matched, ...rest].slice(0, cap);
  const anc = metadataIndex.filter((m) => ancestors.has(m.id));
  return [...anc, ...kept];
}

// 阶段一：跨分支上下文检索。
// 输入：用户新提问 + 祖先路径 id 列表 + 全树元数据索引（不含完整内容）
// 输出：{ selectedIds: string[], reasoning: string }
export async function retrieveContext({ userMessage, ancestorIds, metadataIndex }) {
  if (MOCK) {
    return { selectedIds: [], reasoning: 'MOCK：未执行跨分支检索' };
  }

  // 元数据过大时预筛，控制发给 LLM 的 token
  const index = prefilterCandidates(userMessage, metadataIndex, { ancestorIds });

  const table = index
    .map(
      (m) =>
        `| ${m.id} | 深度${m.depth} | 标签:[${m.tags.join(',')}] | 摘要:${m.summary || ''} |`
    )
    .join('\n');

  const resp = await fetch(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY || ''}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: RETRIEVE_PROMPT },
        {
          role: 'user',
          content:
            `【祖先路径 id】${ancestorIds.join(', ') || '（无，根问题）'}\n\n` +
            `【全树元数据索引】\n| id | 深度 | 标签 | 摘要 |\n${table}\n\n` +
            `【用户新提问】${userMessage}`,
        },
      ],
      temperature: 0.2,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`retrieve API ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  const raw = data.choices[0].message.content;
  return parseRetrieval(raw, ancestorIds);
}

function parseRetrieval(raw, ancestorIds) {
  try {
    const json = JSON.parse(raw.replace(/^[\s\S]*?\{/, '{').replace(/\}[\s\S]*$/, '}'));
    const ids = Array.isArray(json.selected_ids) ? json.selected_ids.map(String) : [];
    const filtered = ids.filter((id) => !ancestorIds.includes(id));
    return { selectedIds: filtered, reasoning: String(json.reasoning || '') };
  } catch {
    return { selectedIds: [], reasoning: '' };
  }
}
