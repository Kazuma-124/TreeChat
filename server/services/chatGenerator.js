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

function buildMessages({ contextGroups, userMessage, systemPrompt = SYSTEM_PROMPT }) {
  const direct = contextGroups.direct || [];
  const cross = contextGroups.cross || [];
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const ce of direct) {
    messages.push({ role: 'user', content: ce.userMessage });
    if (ce.aiMessage) messages.push({ role: 'assistant', content: ce.aiMessage });
  }
  if (cross.length) {
    messages.push({
      role: 'user',
      content: '【以下为其他分支的相关上下文，仅供参考，未必与当前问题直接相关】',
    });
    for (const ce of cross) {
      messages.push({ role: 'user', content: ce.userMessage });
      if (ce.aiMessage) messages.push({ role: 'assistant', content: ce.aiMessage });
    }
  }
  messages.push({ role: 'user', content: userMessage });
  return messages;
}

// 非流式：返回 { answer, summary, tags }
export async function generateAnswer({ contextGroups, userMessage, model, systemPrompt }) {
  const cfg = resolveConfig(model);
  if (cfg.mock) return mockResult({ ...contextGroups, userMessage, model: cfg.model });
  const messages = buildMessages({ contextGroups, userMessage, systemPrompt });
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
export async function generateAnswerStream({ contextGroups, userMessage, model, systemPrompt, onToken }) {
  const cfg = resolveConfig(model);
  if (cfg.mock) {
    const full = mockAnswer({ ...contextGroups, userMessage, model: cfg.model });
    for (let i = 0; i < full.length; i += 12) {
      await sleep(12);
      onToken(full.slice(i, i + 12));
    }
    return mockResult({ ...contextGroups, userMessage, model: cfg.model });
  }

  const messages = buildMessages({ contextGroups, userMessage, systemPrompt });
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

function mockAnswer({ direct, cross, userMessage, model }) {
  const dCount = (direct || []).length;
  const cCount = (cross || []).length;
  const dLines = (direct || []).map((n, i) => `  ${i + 1}. ${n.userMessage.slice(0, 30)}`).join('\n');
  const cLines = (cross || []).map((n, i) => `  ${i + 1}. ${n.userMessage.slice(0, 30)}`).join('\n');
  return (
    `[MOCK 模式] 模型=${model}\n\n` +
    `你问：「${userMessage.slice(0, 80)}」\n` +
    (dCount ? `\n【直接上下文·祖先路径 ${dCount} 条】\n${dLines}\n` : '\n（无祖先上下文，这是根问题）\n') +
    (cCount ? `\n【跨分支召回 ${cCount} 条】\n${cLines}\n` : '\n（无跨分支召回）\n') +
    '\n这是离线假回答，用于验证流程。配置真实 OPENAI_BASE_URL + OPENAI_API_KEY 后即为真实回答。'
  );
}

// MOCK 模式：顺便给一份假元数据，保证下游解析路径与真实调用一致。
function mockResult({ userMessage }) {
  const full = mockAnswer({ ...arguments[0] });
  const summary = full.replace(/\n+/g, ' ').slice(0, 80);
  const tags = Array.from(
    new Set(userMessage.split(/[\s，。？！、：,.:!?]+/).filter((w) => w.length >= 2))
  ).slice(0, 5);
  return { answer: full, summary, tags };
}
