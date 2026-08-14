import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getActiveConfig } from './apiConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '..', 'prompts', 'generate.txt'),
  'utf-8'
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 读取当前启用的 API 方案；无 DB 配置时回退环境变量。model 可被单次请求覆盖。
function resolveConfig(model) {
  const cfg = getActiveConfig();
  return {
    baseUrl: cfg.base_url || 'https://api.openai.com/v1',
    apiKey: cfg.api_key || '',
    model: model || cfg.model || 'gpt-4o-mini',
    mock: cfg.is_mock === 1 || process.env.MOCK_LLM === '1' || process.env.MOCK_LLM === 'true',
  };
}

// 生成回答时让 API 在同一调用里顺带产出元数据：
// 回答正文结束后另起一行输出 `@@META@@` + 单行 JSON {"summary":...,"tags":[...]}。
// 流式场景下只在哨兵前把正文推给 UI，避免把元数据闪现给用户。
const SENTINEL = '@@META@@';

function parseGenerated(raw) {
  const idx = raw.indexOf(SENTINEL);
  if (idx < 0) return { answer: raw.trim(), summary: '', tags: [] };
  const answer = raw.slice(0, idx).trim();
  const metaRaw = raw.slice(idx + SENTINEL.length);
  try {
    const json = JSON.parse(metaRaw.replace(/^[\s\S]*?\{/, '{').replace(/\}[\s\S]*$/, '}'));
    return {
      answer,
      summary: String(json.summary || '').slice(0, 200),
      tags: Array.isArray(json.tags) ? json.tags.slice(0, 5).map(String) : [],
    };
  } catch {
    return { answer, summary: '', tags: [] };
  }
}

function kindLabel(kind) {
  return kind === 'image' ? '图片' : kind === 'code' ? '代码' : kind === 'file' ? '文件' : '文本';
}

// 节点资源的纳入：按 resourceMode（none/desc/raw）渲染该节点附带资源的内容块。
function nodeResourceMessages(node) {
  const out = [];
  if (node.resourceMode === 'none' || !node.resources?.length) return out;
  for (const r of node.resources) {
    if (node.resourceMode === 'raw') {
      if (r.kind === 'image' && r.content) {
        out.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: r.content } }] });
      } else if (r.content) {
        out.push({ role: 'user', content: `【节点 ${node.id} 附带的${kindLabel(r.kind)}】\n${r.content}` });
      }
    } else if (node.resourceMode === 'desc') {
      const d = r.description || (r.kind === 'image' ? '（图片，无描述）' : '');
      if (d) out.push({ role: 'user', content: `【节点 ${node.id} 附带的${kindLabel(r.kind)}（描述）】\n${d}` });
    }
  }
  return out;
}

// 当前轮资源的纳入：按 resourcePlan[resId]（omit/desc/raw）渲染；缺失时按种类给默认
// （图片 omit 省 token，文本/代码 raw——原文即用户主要输入）。
function currentResourceParts(resources, resourcePlan) {
  const parts = [];
  for (const r of resources || []) {
    const mode = resourcePlan?.[r.id] || (r.kind === 'image' ? 'omit' : 'raw');
    if (mode === 'omit') continue;
    if (mode === 'raw') {
      if (r.kind === 'image' && r.content) {
        parts.push({ type: 'image_url', image_url: { url: r.content } });
      } else if (r.content) {
        parts.push({ type: 'text', text: `【用户附带的${kindLabel(r.kind)}】\n${r.content}` });
      }
    } else if (mode === 'desc') {
      const d = r.description || (r.kind === 'image' ? '（图片，无描述）' : '');
      if (d) parts.push({ type: 'text', text: `【用户附带的${kindLabel(r.kind)}（描述）】\n${d}` });
    }
  }
  return parts;
}

function buildMessages({ contextGroups, userMessage, systemPrompt = SYSTEM_PROMPT, resources, resourcePlan }) {
  const direct = contextGroups.direct || [];
  const cross = contextGroups.cross || [];
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const ce of direct) {
    messages.push({ role: 'user', content: ce.userMessage });
    if (ce.aiMessage) messages.push({ role: 'assistant', content: ce.aiMessage });
    messages.push(...nodeResourceMessages(ce));
  }
  if (cross.length) {
    messages.push({
      role: 'user',
      content: '【以下为其他分支的相关上下文，仅供参考，未必与当前问题直接相关】',
    });
    for (const ce of cross) {
      messages.push({ role: 'user', content: ce.userMessage });
      if (ce.aiMessage) messages.push({ role: 'assistant', content: ce.aiMessage });
      messages.push(...nodeResourceMessages(ce));
    }
  }
  // 当前轮资源：图片走多模态 image_url，文本/代码作为附加文本块；无资源时仍是纯文本
  const resParts = currentResourceParts(resources, resourcePlan);
  if (resParts.length) {
    messages.push({ role: 'user', content: [{ type: 'text', text: userMessage }, ...resParts] });
  } else {
    messages.push({ role: 'user', content: userMessage });
  }
  return messages;
}

// 非流式：返回 { answer, summary, tags }
export async function generateAnswer({ contextGroups, userMessage, model, systemPrompt, resources, resourcePlan }) {
  const cfg = resolveConfig(model);
  if (cfg.mock) return mockResult({ ...contextGroups, userMessage, model: cfg.model, resources, resourcePlan });
  const messages = buildMessages({ contextGroups, userMessage, systemPrompt, resources, resourcePlan });
  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.7 }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM API ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return parseGenerated(data.choices[0].message.content);
}

// 流式：每个 token 块通过 onToken 回调吐出（仅正文），最终返回 { answer, summary, tags }。
export async function generateAnswerStream({ contextGroups, userMessage, model, systemPrompt, resources, resourcePlan, onToken }) {
  const cfg = resolveConfig(model);
  if (cfg.mock) {
    const full = mockAnswer({ ...contextGroups, userMessage, model: cfg.model, resources, resourcePlan });
    for (let i = 0; i < full.length; i += 12) {
      await sleep(12);
      onToken(full.slice(i, i + 12));
    }
    return mockResult({ ...contextGroups, userMessage, model: cfg.model, resources, resourcePlan });
  }

  const messages = buildMessages({ contextGroups, userMessage, systemPrompt, resources, resourcePlan });
  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.7, stream: true }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM API ${resp.status}: ${text}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let emitted = 0;
  let metaStarted = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (!delta) continue;
        full += delta;
        if (!metaStarted) {
          const idx = full.indexOf(SENTINEL);
          if (idx >= 0) {
            metaStarted = true;
            const disp = full.slice(0, idx);
            if (disp.length > emitted) {
              onToken(disp.slice(emitted));
              emitted = disp.length;
            }
          } else {
            // 哨兵可能在分片中跨块，先扣留末尾若干字符，避免把 @@META@@ 闪现给用户
            const safeEnd = Math.max(emitted, full.length - (SENTINEL.length - 1));
            if (safeEnd > emitted) {
              onToken(full.slice(emitted, safeEnd));
              emitted = safeEnd;
            }
          }
        }
      } catch {
        /* 忽略非 JSON 行 */
      }
    }
  }
  // 模型未输出哨兵（退化）时，把缓冲扣留的末尾字符补发给 UI
  if (!metaStarted && emitted < full.length) {
    onToken(full.slice(emitted));
  }
  return parseGenerated(full);
}

function mockAnswer({ direct, cross, userMessage, model, resources, resourcePlan }) {
  const dCount = (direct || []).length;
  const cCount = (cross || []).length;
  const rCount = (resources || []).length;
  const planCounts = (resources || []).reduce(
    (acc, r) => {
      const m = resourcePlan?.[r.id] || (r.kind === 'image' ? 'omit' : 'raw');
      acc[m] = (acc[m] || 0) + 1;
      return acc;
    },
    {}
  );
  const planText = Object.keys(planCounts).length
    ? `（纳入方式：raw ${planCounts.raw || 0} / desc ${planCounts.desc || 0} / omit ${planCounts.omit || 0}）`
    : '';
  const dLines = (direct || []).map((n, i) => `  ${i + 1}. ${n.userMessage.slice(0, 30)}`).join('\n');
  const cLines = (cross || []).map((n, i) => `  ${i + 1}. ${n.userMessage.slice(0, 30)}`).join('\n');
  return (
    `[MOCK 模式] 模型=${model}\n\n` +
    `你问：「${userMessage.slice(0, 80)}」\n` +
    (rCount ? `\n【附带资源 ${rCount} 份（图片/文本/代码），此处仅占位，真实调用按编排计划纳入】${planText}\n` : '') +
    (dCount ? `\n【直接上下文·祖先路径 ${dCount} 条】\n${dLines}\n` : '\n（无祖先上下文，这是根问题）\n') +
    (cCount ? `\n【跨分支召回 ${cCount} 条】\n${cLines}\n` : '\n（无跨分支召回）\n') +
    '\n这是离线假回答，用于验证流程。配置真实 OPENAI_BASE_URL + OPENAI_API_KEY 后即为真实回答。'
  );
}

// MOCK 模式：顺便给一份假元数据，保证下游解析路径与真实调用一致。
function mockResult({ userMessage, resources, resourcePlan }) {
  const full = mockAnswer({ ...arguments[0], resources, resourcePlan });
  const summary = full.replace(/\n+/g, ' ').slice(0, 80);
  const tags = Array.from(
    new Set(userMessage.split(/[\s，。？！、：,.:!?]+/).filter((w) => w.length >= 2))
  ).slice(0, 5);
  return { answer: full, summary, tags };
}

const META_PROMPT =
  '以下是用户附带的多份素材。请严格按 JSON 数组返回，每个元素对应一份素材：\n' +
  '[{"description":"用中文一句话简述这份素材的内容","tags":["最多3个中文关键词"]}]\n' +
  '数组长度需与素材数量一致，不要输出多余内容。';

// 用指定配置对一批素材生成「简介 + 标签」，返回与输入顺序对齐的数组。
async function runMetas(cfg, items) {
  if (cfg.mock) return items.map(() => ({ description: '［示例资源描述］', tags: ['资源'] }));

  const parts = [{ type: 'text', text: META_PROMPT }];
  for (const r of items) {
    if (r.kind === 'image' && r.content) {
      parts.push({ type: 'image_url', image_url: { url: r.content } });
    } else if (r.content) {
      parts.push({ type: 'text', text: `【${kindLabel(r.kind)}】\n${String(r.content).slice(0, 3000)}` });
    }
  }

  try {
    const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: parts }],
        temperature: 0.3,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`LLM API ${resp.status}: ${text}`);
    }
    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content || '[]';
    const arr = JSON.parse(raw.replace(/^[\s\S]*?\[/, '[').replace(/\][\s\S]*$/, ']'));
    if (!Array.isArray(arr)) throw new Error('not array');
    return items.map((_, i) => {
      const it = arr[i] || {};
      return {
        description: String(it.description || ''),
        tags: Array.isArray(it.tags) ? it.tags.slice(0, 5).map(String) : [],
      };
    });
  } catch (e) {
    console.error('generateResourceMetas failed:', e.message);
    return items.map(() => ({ description: '', tags: [] }));
  }
}

// 为一份或多份资源生成「简介 + 标签」。
// 图片走视觉/模块模型（若主配置声明并启用了 role=vision 的搭配模型，否则回退主模型）；
// 文本/代码走主模型。返回与输入顺序对齐的数组，失败项返回空，不阻断主流程。
export async function generateResourceMetas(resources, model, visionConfig) {
  const list = resources || [];
  if (!list.length) return [];

  const mainCfg = resolveConfig(model);
  const visCfg = visionConfig || mainCfg;

  const images = list.filter((r) => r.kind === 'image');
  const others = list.filter((r) => r.kind !== 'image');

  const [imgOut, otherOut] = await Promise.all([
    images.length ? runMetas(visCfg, images) : Promise.resolve([]),
    others.length ? runMetas(mainCfg, others) : Promise.resolve([]),
  ]);

  // 按原始顺序归并结果
  const out = [];
  let ii = 0;
  let oi = 0;
  for (const r of list) {
    out.push(r.kind === 'image' ? imgOut[ii++] : otherOut[oi++]);
  }
  return out;
}
