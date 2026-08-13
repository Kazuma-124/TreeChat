import { useState } from 'react';
import { ContextElement } from '../api';

interface Trace {
  direct?: string[];
  cross?: string[];
  reasoning?: string;
}

// 三段式上下文透明度面板 + Phase 4 手动调整：勾选/追加上下文节点后「用所选上下文重生成」。
export default function ContextSourcePanel({
  node,
  trace,
  ids,
  allNodes,
  onStreamSend,
  onFocus,
}: {
  node: ContextElement;
  trace: Trace | null;
  ids: string[];
  allNodes: ContextElement[];
  onStreamSend: (opts: { parentId: string | null; userMessage: string; contextElementIds?: string[] }) => Promise<string | null>;
  onFocus: (id: string, parentId?: string | null) => void;
}) {
  const resolve = (list: string[] = []) =>
    list.map((id) => allNodes.find((n) => n.id === id)).filter(Boolean) as ContextElement[];

  // 有 trace 时直接采用其字段：根节点 direct 本就为空（无祖先），不可回退到 ids，
  // 否则会与 cross 显示成同一批节点（ids = direct∪cross）。仅 trace 缺失时回退到 ids。
  const directIds = trace ? (trace.direct || []) : ids;
  const crossIds = trace ? (trace.cross || []) : [];
  const base = Array.from(new Set([...directIds, ...crossIds]));

  const [checked, setChecked] = useState<Set<string>>(() => new Set(base));
  const [regenerating, setRegenerating] = useState(false);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addNode = (id: string) => {
    if (id) setChecked((prev) => new Set(prev).add(id));
  };

  // 已选但不在 direct/cross 中的（用户从下拉追加的）
  const extraIds = Array.from(checked).filter((id) => !base.includes(id));

  const direct = resolve(directIds);
  const cross = resolve(crossIds);
  const extra = resolve(extraIds);

  const rows = (list: ContextElement[], label: string) =>
    list.length ? (
      <div className="ctx-section">
        <div className="ctx-h">{label} · {list.length}</div>
        <ul>
          {list.map((n) => (
            <li key={n.id} className="ctx-row">
              <label className="ctx-check">
                <input type="checkbox" checked={checked.has(n.id)} onChange={() => toggle(n.id)} />
                · {n.user_message.slice(0, 40)}
              </label>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const newId = await onStreamSend({
        parentId: node.parent_id,
        userMessage: node.user_message,
        contextElementIds: Array.from(checked),
      });
      if (newId) onFocus(newId, node.parent_id);
    } finally {
      setRegenerating(false);
    }
  };

  if (!direct.length && !cross.length && !extra.length) return null;

  const candidates = allNodes
    .filter((n) => n.id !== node.id && !checked.has(n.id))
    .slice(0, 100);

  return (
    <div className="ctx-panel">
      <div className="ctx-title">📋 本次回答的上下文来源</div>

      {rows(direct, '✅ 直接上下文（祖先路径，自动包含）')}
      {rows(cross, '🔍 跨分支召回')}
      {rows(extra, '➕ 追加节点')}

      {trace?.reasoning && trace.reasoning !== '手动指定' ? (
        <div className="ctx-section">
          <div className="ctx-h">🧠 选择理由</div>
          <div className="ctx-reasoning">{trace.reasoning}</div>
        </div>
      ) : null}

      <div className="ctx-adjust">
        <select
          className="ctx-add"
          value=""
          onChange={(e) => {
            addNode(e.target.value);
            e.target.value = '';
          }}
        >
          <option value="">＋ 追加其它节点…</option>
          {candidates.map((n) => (
            <option key={n.id} value={n.id}>
              {n.user_message.slice(0, 36)}
            </option>
          ))}
        </select>
        <button className="ctx-regenerate" onClick={regenerate} disabled={regenerating || checked.size === 0}>
          {regenerating ? '生成中…' : '🔄 用所选上下文重生成'}
        </button>
      </div>
    </div>
  );
}
