import { useEffect, useState } from 'react';
import { api, ApiConfig, ApiConfigInput, DEFAULT_MODEL, PairedModel } from '../api';

// API 方案管理弹窗：列出已保存方案，可新增 / 编辑 / 删除 / 启用。
// 列表中 api_key 已脱敏；编辑时通过 GET /:id 取回完整 key 回填。
export default function ApiSettings({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<ApiConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ApiConfigInput>({
    name: '',
    base_url: '',
    api_key: '',
    model: DEFAULT_MODEL,
    is_mock: false,
  });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setList(await api.listConfigs());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditingId(null);
    setForm({ name: '', base_url: '', api_key: '', model: DEFAULT_MODEL, is_mock: false, paired_models: [] });
    setFormOpen(true);
  };

  const openEdit = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const c = await api.getConfig(id); // 含完整 api_key
      setEditingId(id);
      setForm({
        name: c.name,
        base_url: c.base_url,
        api_key: c.api_key,
        model: c.model,
        is_mock: c.is_mock === 1,
        paired_models: Array.isArray(c.paired_models) ? c.paired_models : [],
      });
      setFormOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 在「搭配模型」列表中勾选/改角色 -> 写入 form.paired_models
  const setPaired = (configId: string, patch: Partial<PairedModel>) => {
    setForm((f) => {
      const arr: PairedModel[] = Array.isArray(f.paired_models) ? f.paired_models : [];
      const idx = arr.findIndex((p) => p.config_id === configId);
      let next: PairedModel[];
      if (idx >= 0) {
        next = arr.map((p, i) => (i === idx ? { ...p, ...patch } : p));
      } else {
        next = [...arr, { config_id: configId, role: 'vision', enabled: true, ...patch }];
      }
      return { ...f, paired_models: next };
    });
  };

  const save = async () => {
    if (!form.name.trim() || !form.base_url.trim() || !form.api_key.trim()) {
      setError('名称、基地址、密钥均为必填');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (editingId) await api.updateConfig(editingId, form);
      else await api.createConfig(form);
      setFormOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('确定删除该 API 方案？')) return;
    setError('');
    try {
      await api.deleteConfig(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const activate = async (id: string) => {
    setError('');
    try {
      await api.activateConfig(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>API 配置方案</h3>
          <button className="modal-close" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
        {error && <div className="modal-err">{error}</div>}

        {!formOpen ? (
          <div className="cfg-list">
            {loading ? (
              <div className="hint">加载中…</div>
            ) : list.length === 0 ? (
              <div className="hint">还没有保存的方案，点「新增方案」添加。</div>
            ) : (
              list.map((c) => (
                <div className="cfg-row" key={c.id}>
                  <div className="cfg-info">
                    <div className="cfg-name">
                      {c.name}
                      {c.is_active === 1 && <span className="tag active">启用中</span>}
                      {c.is_mock === 1 && <span className="tag mock">MOCK</span>}
                      {Array.isArray(c.paired_models) && c.paired_models.length > 0 && (
                        <span className="tag paired">搭配 {c.paired_models.length}</span>
                      )}
                    </div>
                    <div className="cfg-meta">
                      {c.base_url} · {c.model}
                    </div>
                  </div>
                  <div className="cfg-actions">
                    {c.is_active !== 1 && (
                      <button onClick={() => activate(c.id)}>启用</button>
                    )}
                    <button onClick={() => openEdit(c.id)} disabled={busy}>
                      编辑
                    </button>
                    <button className="del" onClick={() => remove(c.id)} disabled={busy}>
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
            <button className="cfg-add" onClick={openNew}>
              ＋ 新增方案
            </button>
          </div>
        ) : (
          <div className="cfg-form">
            <label>
              名称
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：DeepSeek 主号"
              />
            </label>
            <label>
              基地址
              <input
                value={form.base_url}
                onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label>
              API Key
              <input
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                placeholder="sk-..."
                type="password"
                autoComplete="off"
                name="api-key-not-saved"
              />
            </label>
            <label>
              模型
              <input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="如 gpt-4o-mini / deepseek-chat（按你的接口填写）"
              />
            </label>
            <label className="cfg-mock">
              <input
                type="checkbox"
                checked={!!form.is_mock}
                onChange={(e) => setForm({ ...form, is_mock: e.target.checked })}
              />
              模拟模式（不调用真实 API）
            </label>
            <div className="cfg-paired">
              <div className="cfg-paired-h">搭配模型（视觉/模块，可选）</div>
              {(() => {
                const candidates = list.filter((c) => c.id !== editingId);
                if (!candidates.length) {
                  return (
                    <div className="hint">
                      暂无其它方案可作为搭配模型。请先「新增方案」创建一个视觉模型方案，再回来勾选启用。
                    </div>
                  );
                }
                const arr: PairedModel[] = Array.isArray(form.paired_models) ? form.paired_models : [];
                return candidates.map((c) => {
                  const entry = arr.find((p) => p.config_id === c.id);
                  const enabled = !!entry?.enabled;
                  const role = entry?.role || 'vision';
                  return (
                    <div className="cfg-paired-row" key={c.id}>
                      <label className="cfg-paired-enable">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => setPaired(c.id, { enabled: e.target.checked })}
                        />
                        {c.name}
                      </label>
                      <select
                        value={role}
                        disabled={!enabled}
                        onChange={(e) => setPaired(c.id, { role: e.target.value })}
                      >
                        <option value="vision">视觉</option>
                        <option value="ocr">OCR</option>
                      </select>
                    </div>
                  );
                });
              })()}
            </div>
            <div className="cfg-form-actions">
              <button className="primary" onClick={save} disabled={busy}>
                {busy ? '保存中…' : '保存'}
              </button>
              <button className="ghost" onClick={() => setFormOpen(false)} disabled={busy}>
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
