import { getActiveConfig, getConfig } from './apiConfig.js';

// 把任意值安全地当作数组返回（兼容已解析数组与 JSON 字符串）。
function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

// 视觉/模块模型 = 主模型配置的一部分：主配置声明「搭配哪些模块模型、干什么、是否启用」。
// 这里按 role 从当前启用主配置的 paired_models 中解析出实际可用的模块模型配置。
// 返回 { baseUrl, apiKey, model, mock } 或 null（未配置 / 未启用 / 找不到）。
export function resolvePairedConfig(role) {
  const cfg = getActiveConfig();
  const paired = asArray(cfg.paired_models);
  const entry = paired.find((p) => p && p.role === role && p.enabled);
  if (!entry || !entry.config_id) return null;
  let vc;
  try {
    vc = getConfig(entry.config_id);
  } catch {
    return null;
  }
  if (!vc) return null;
  return {
    baseUrl: vc.base_url || 'https://api.openai.com/v1',
    apiKey: vc.api_key || '',
    model: vc.model || 'gpt-4o-mini',
    mock: vc.is_mock === 1 || process.env.MOCK_LLM === '1' || process.env.MOCK_LLM === 'true',
  };
}
