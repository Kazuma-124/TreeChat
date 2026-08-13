import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const META_PROMPT = fs.readFileSync(
  path.join(__dirname, '..', 'prompts', 'metadata.txt'),
  'utf-8'
);

const MOCK = process.env.MOCK_LLM === '1' || process.env.MOCK_LLM === 'true';

// 节点完成后生成摘要 + 标签，写入 context_elements.summary / tags。
// 返回 { summary, tags }
export async function generateMetadata({ userMessage, aiMessage }) {
  if (MOCK) return mockMeta({ userMessage, aiMessage });

  const resp = await fetch(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY || ''}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: META_PROMPT },
        { role: 'user', content: `用户问题：${userMessage}\n\nAI 回答：${aiMessage}` },
      ],
      temperature: 0.2,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`metadata API ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  const raw = data.choices[0].message.content;
  return parseMeta(raw);
}

function parseMeta(raw) {
  try {
    const json = JSON.parse(raw.replace(/^[\s\S]*?\{/, '{').replace(/\}[\s\S]*$/, '}'));
    return {
      summary: String(json.summary || '').slice(0, 200),
      tags: Array.isArray(json.tags) ? json.tags.slice(0, 5).map(String) : [],
    };
  } catch {
    return { summary: raw.slice(0, 200), tags: [] };
  }
}

function mockMeta({ userMessage, aiMessage }) {
  const summary = (aiMessage || '').replace(/\n+/g, ' ').slice(0, 80);
  const tags = Array.from(new Set(userMessage.split(/[\s，。？！、：,.:!?]+/).filter((w) => w.length >= 2))).slice(0, 5);
  return { summary, tags };
}
