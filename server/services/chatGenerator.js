import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '..', 'prompts', 'generate.txt'),
  'utf-8'
);

const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const API_KEY = process.env.OPENAI_API_KEY || '';
const MOCK = process.env.MOCK_LLM === '1' || process.env.MOCK_LLM === 'true';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// 非流式：直接返回完整回答
export async function generateAnswer({ contextGroups, userMessage, model, systemPrompt }) {
  if (MOCK) return mockAnswer({ ...contextGroups, userMessage, model });
  const messages = buildMessages({ contextGroups, userMessage, systemPrompt });
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model, messages, temperature: 0.7 }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM API ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.choices[0].message.content;
}

// 流式：每个 token 块通过 onToken 回调吐出，最终返回完整回答。
export async function generateAnswerStream({ contextGroups, userMessage, model, systemPrompt, onToken }) {
  const full = mockAnswer({ ...contextGroups, userMessage, model });
  if (MOCK) {
    // 把假回答切成小块逐次推送，模拟流式
    for (let i = 0; i < full.length; i += 12) {
      await sleep(12);
      onToken(full.slice(i, i + 12));
    }
    return full;
  }

  const messages = buildMessages({ contextGroups, userMessage, systemPrompt });
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model, messages, temperature: 0.7, stream: true }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM API ${resp.status}: ${text}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
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
        if (delta) {
          answer += delta;
          onToken(delta);
        }
      } catch {
        /* 忽略非 JSON 行 */
      }
    }
  }
  return answer;
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
