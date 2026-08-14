import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getActiveConfig } from './apiConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RETRIEVE_PROMPT = fs.readFileSync(
  path.join(__dirname, '..', 'prompts', 'retrieve.txt'),
  'utf-8'
);

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

function resMetaToText(m) {
  if (!m.hasResource || !m.resourceDescs?.length) return '无资源';
  return '资源:' + m.resourceDescs.map((d) => `[${d.kind}]${d.description || ''}`).join('; ');
}

// 阶段一：跨分支检索 + 上下文编排。
// 输入：
//   - userMessage：用户手写提问（资源已拆分为单独结构，不在此列）
//   - ancestorMeta：祖先路径元数据（直接上下文，可决定其资源是否纳入）
//   - metadataIndex：全树元数据索引（已剔除祖先路径），作为跨分支候选
//   - resources：当前轮已附带的资源（含模型生成的 description）
// 输出结构化计划：
//   { context_intent, selectedIds, nodePlan, resourcePlan, reasoning }
export async function retrieveContext({ userMessage, ancestorMeta = [], metadataIndex = [], resources = [] }) {
  const cfg = getActiveConfig();
  const mock = cfg.is_mock === 1 || process.env.MOCK_LLM === '1' || process.env.MOCK_LLM === 'true';
  if (mock) {
    return defaultPlan(resources, ancestorMeta);
  }

  // 元数据过大时预筛，控制发给 LLM 的 token（祖先恒保留在 ancestorMeta 中单独呈现）
  const ancestorIds = ancestorMeta.map((a) => a.id);
  const index = prefilterCandidates(userMessage, metadataIndex, { ancestorIds });

  const ancestorTable = ancestorMeta.length
    ? ancestorMeta
        .map(
          (m) =>
            `| ${m.id} | 深度${m.depth} | 标签:[${m.tags.join(',')}] | 摘要:${m.summary || ''} | ${resMetaToText(m)} |`
        )
        .join('\n')
    : '（无，根问题）';

  const crossTable = index.length
    ? index
        .map(
          (m) =>
            `| ${m.id} | 深度${m.depth} | 标签:[${m.tags.join(',')}] | 摘要:${m.summary || ''} | ${resMetaToText(m)} |`
        )
        .join('\n')
    : '（无候选）';

  const resList = resources.length
    ? resources
        .map((r) => `- [${r.id}] ${r.kind}${r.filename ? ' ' + r.filename : ''}: ${r.description || '(描述待生成)'}`)
        .join('\n')
    : '（无）';

  const content =
    `【祖先路径（直接上下文；请在 node_plan 中为其给出层级，可决定资源是否纳入）】\n` +
    `| id | 深度 | 标签 | 摘要 | 资源 |\n${ancestorTable}\n\n` +
    `【候选跨分支节点（从中选相关者，输出 selected_ids + node_plan）】\n` +
    `| id | 深度 | 标签 | 摘要 | 资源 |\n${crossTable}\n\n` +
    `【当前轮附带资源（决定 current_resource_plan）】\n${resList}\n\n` +
    `【用户手写提问】${userMessage}`;

  const resp = await fetch(`${cfg.base_url || 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.api_key || ''}`,
    },
    body: JSON.stringify({
      model: cfg.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: RETRIEVE_PROMPT },
        { role: 'user', content },
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
  return parseRetrieval(raw, resources, ancestorMeta);
}

// 祖先排除已移到本地（发送前删去路径元数据），这里不再过滤，仅解析结构化计划。
function parseRetrieval(raw, resources = [], ancestorMeta = []) {
  try {
    const json = JSON.parse(raw.replace(/^[\s\S]*?\{/, '{').replace(/\}[\s\S]*$/, '}'));
    const intent = ['none', 'light', 'normal', 'full'].includes(json.context_intent)
      ? json.context_intent
      : 'normal';
    const selectedIds = Array.isArray(json.selected_ids) ? json.selected_ids.map(String) : [];
    const nodePlan =
      json.node_plan && typeof json.node_plan === 'object' ? json.node_plan : {};
    const resourcePlan =
      json.current_resource_plan && typeof json.current_resource_plan === 'object'
        ? json.current_resource_plan
        : {};
    return {
      context_intent: intent,
      selectedIds,
      nodePlan,
      resourcePlan,
      reasoning: String(json.reasoning || ''),
    };
  } catch {
    return defaultPlan(resources, ancestorMeta);
  }
}

// 解析失败 / MOCK 时的安全默认计划：
// - 跨分支不选（selectedIds 空）
// - 祖先默认 question（不纳资源）
// - 当前资源按种类给默认：图片 omit（重，默认不纳），文本/代码 raw（原文即用户主要输入）
function defaultPlan(resources = [], _ancestorMeta = []) {
  const resourcePlan = {};
  for (const r of resources || []) {
    resourcePlan[r.id] = r.kind === 'image' ? 'omit' : 'raw';
  }
  return {
    context_intent: 'normal',
    selectedIds: [],
    nodePlan: {},
    resourcePlan,
    reasoning: '默认计划（解析失败或 MOCK）',
  };
}
