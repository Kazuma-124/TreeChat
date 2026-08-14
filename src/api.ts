export interface ContextElement {
  id: string;
  tree_id: string;
  parent_id: string | null;
  sibling_index: number;
  depth: number;
  user_message: string;
  ai_message: string | null;
  model: string | null;
  model_config: string | null;
  status: string;
  summary: string | null;
  tags: string | null;
  token_count: number;
  context_element_ids: string | null;
  context_trace: string | null;
  embedding: string | null;
  is_volatile: number;
  created_at: number;
  updated_at: number;
  resources?: Resource[];
  has_resource?: number;
}

export interface Resource {
  id: string;
  kind: 'image' | 'text' | 'code' | 'file';
  mime?: string;
  filename?: string;
  content?: string; // base64（image）或原文（text/code）
  description?: string; // 模型生成的资源简介
  tags?: string[];
}

export interface PairedModel {
  config_id: string;
  role: string; // 例如 'vision' | 'ocr' ...
  enabled: boolean;
}

export interface Tree {
  id: string;
  title: string;
  root_node_id: string | null;
  created_at: number;
  updated_at: number;
}

// API 方案配置（列表中的 api_key 已脱敏）
export interface ApiConfig {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  is_mock: number;
  is_active: number;
  paired_models?: PairedModel[];
  created_at: number;
  updated_at: number;
}

export type ApiConfigInput = {
  name: string;
  base_url: string;
  api_key: string;
  model?: string;
  is_mock?: boolean;
  paired_models?: PairedModel[];
};

// ---- 登录态（JWT）本地存储 ----
export interface SessionUser {
  id: string;
  username: string;
  is_admin: boolean;
}
const TOKEN_KEY = 'treechat_token';
const USER_KEY = 'treechat_user';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setSession(token: string, user: SessionUser) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}
export function getSession(): { token: string; user: SessionUser } | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const raw = localStorage.getItem(USER_KEY);
    if (!token || !raw) return null;
    return { token, user: JSON.parse(raw) as SessionUser };
  } catch {
    return null;
  }
}
export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}
export function isLoggedIn(): boolean {
  return !!getToken();
}

// 401（未登录/登录过期）→ 清登录态并广播，由 AuthGate 弹回登录页
export function notifyUnauthorized() {
  clearSession();
  window.dispatchEvent(new Event('treechat:unauthorized'));
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(path, { ...init, headers });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    if (r.status === 401) notifyUnauthorized();
    throw new Error((body as { error?: string })?.error || r.statusText);
  }
  return r.json();
}

export const MODELS = ['deepseek-chat', 'deepseek-reasoner', 'gpt-4o-mini', 'gpt-4o', 'claude-3-5-sonnet'];
export const DEFAULT_MODEL = 'deepseek-chat';

// 跨树搜索命中项
export interface SearchHit {
  id: string;
  tree_id: string;
  tree_title: string;
  user_message: string;
  ai_message: string | null;
  summary: string | null;
  depth: number;
  tags: string | null;
}

// SSE 流式发送：通过回调推送 start / token / done / error
export function sendMessageStream(opts: {
  treeId: string;
  parentId: string | null;
  userMessage: string;
  model?: string;
  isVolatile?: boolean;
  contextElementIds?: string[];
  resources?: Resource[];
  onStart?: (info: { id: string }) => void;
  onToken?: (delta: string) => void;
  onDone?: (node: ContextElement) => void;
  onError?: (msg: string) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      treeId: opts.treeId,
      parentId: opts.parentId,
      userMessage: opts.userMessage,
      model: opts.model,
      isVolatile: opts.isVolatile,
      resources: opts.resources,
    });
    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch('/api/chat/stream', { method: 'POST', headers, body })
      .then(async (resp) => {
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          if (resp.status === 401) notifyUnauthorized();
          opts.onError?.(err.error || resp.statusText);
          reject(new Error(err.error || resp.statusText));
          return;
        }
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let curEvent = '';
        let curData = '';
        const flush = () => {
          if (curEvent && curData) {
            try {
              const payload = JSON.parse(curData);
              if (curEvent === 'start') opts.onStart?.(payload);
              else if (curEvent === 'token') opts.onToken?.(payload.delta || '');
              else if (curEvent === 'done') opts.onDone?.(payload);
              else if (curEvent === 'error') opts.onError?.(payload.message || 'error');
            } catch {
              /* ignore */
            }
          }
          curEvent = '';
          curData = '';
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (line === '') {
              flush();
            } else if (line.startsWith('event:')) {
              curEvent = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              curData += line.slice(5).trim();
            }
          }
        }
        flush();
        resolve();
      })
      .catch((e) => {
        opts.onError?.(e.message);
        reject(e);
      });
  });
}

export function downloadText(filename: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  // 认证
  login: (username: string, password: string) =>
    req<{ token: string; user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  register: (username: string, password: string, inviteCode?: string) =>
    req<{ token: string; user: SessionUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, inviteCode }),
    }),

  listTrees: () => req<Tree[]>('/api/trees'),
  createTree: (title?: string) =>
    req<Tree>('/api/trees', { method: 'POST', body: JSON.stringify({ title }) }),
  getTree: (id: string) =>
    req<Tree & { nodes: ContextElement[] }>(`/api/trees/${id}`),
  deleteTree: (id: string) =>
    req<{ ok: boolean; id: string }>(`/api/trees/${id}`, { method: 'DELETE' }),
  renameTree: (id: string, title: string) =>
    req<Tree>(`/api/trees/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  sendMessage: (body: {
    treeId: string;
    parentId: string | null;
    userMessage: string;
    isVolatile?: boolean;
    contextElementIds?: string[];
    resources?: Resource[];
  }) => req<ContextElement>('/api/chat/send', { method: 'POST', body: JSON.stringify(body) }),
  deleteNode: (id: string, mode: 'merge' | 'discard') =>
    req<{ ok: boolean }>(`/api/chat/${id}?mode=${mode}`, { method: 'DELETE' }),
  updateTags: (id: string, tags: string[]) =>
    req<{ ok: boolean }>(`/api/chat/${id}`, { method: 'PATCH', body: JSON.stringify({ tags }) }),
  search: (q: string) => req<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  // API 方案配置
  listConfigs: () => req<ApiConfig[]>('/api/configs'),
  getConfig: (id: string) => req<ApiConfig>(`/api/configs/${id}`),
  createConfig: (body: ApiConfigInput) =>
    req<ApiConfig>('/api/configs', { method: 'POST', body: JSON.stringify(body) }),
  updateConfig: (id: string, body: ApiConfigInput) =>
    req<ApiConfig>(`/api/configs/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteConfig: (id: string) =>
    req<{ ok: boolean }>(`/api/configs/${id}`, { method: 'DELETE' }),
  activateConfig: (id: string) =>
    req<ApiConfig>(`/api/configs/${id}/activate`, { method: 'POST' }),
  exportTree: async (id: string, format: 'json' | 'md') => {
    const r = await fetch(`/api/trees/${id}/export?format=${format}`);
    return r.text();
  },
  importTree: (payload: { tree: unknown; nodes: ContextElement[] }) =>
    req<Tree>('/api/trees/import', { method: 'POST', body: JSON.stringify(payload) }),
};
