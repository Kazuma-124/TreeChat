import { useState } from 'react';
import { ContextElement, Resource } from '../api';

interface Trace {
  direct?: string[];
  cross?: string[];
  reasoning?: string;
  // Phase 3+ 结构化编排计划
  intent?: string;
  nodePlan?: Record<string, string>;
  resourcePlan?: Record<string, string>;
}

const NODE_TIER: Record<string, string> = {
  none: '不带',
  question: '仅提问',
  'question+desc': '提问+描述',
  'question+resource': '提问+原文',
};
const RES_TIER: Record<string, string> = {
  omit: '不带',
  desc: '描述',
  raw: '原文',
};

// 三段式上下文透明度面板 + Phase 4 手动调整：勾选/追加上下文节点后「用所选上下文重生成」。
// 同时展示阶段一的结构化编排计划（intent / node_plan / resource_plan / reasoning）。
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

  const tierOf = (id: string) => trace?.nodePlan?.[id];

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
          {list.map((n) => {
            const tier = tierOf(n.id);
            return (
              <li key={n.id} className="ctx-row">
                <label className="ctx-check">
                  <input type="checkbox" checked={checked.has(n.id)} onChange={() => toggle(n.id)} />
                  · {n.user_message.slice(0, 40)}
                </label>
                {tier && NODE_TIER[tier] ? (
                  <span className="ctx-tier" title="该节点纳入层级">{NODE_TIER[tier]}</span>
                ) : null}
              </li>
            );
          })}
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

  // 当前节点附带资源及其纳入方式
  const nodeResources: Resource[] = Array.isArray(node.resources) ? node.resources : [];
  const intentLabel =
    trace?.intent === 'none'
      ? '不需要上下文'
      : trace?.intent === 'light'
      ? '轻量'
      : trace?.intent === 'full'
      ? '完整'
      : trace?.intent === 'normal'
      ? '常规'
      : '';

  return (
    <div className="ctx-panel">
      <div className="ctx-title">📋 本次回答的上下文来源</div>

      {intentLabel ? (
        <div className="ctx-section">
          <div className="ctx-h">🎯 编排判断</div>
          <div className="ctx-intent">context_intent：<b>{trace?.intent}</b>（{intentLabel}）</div>
        </div>
      ) : null}

      {rows(direct, '✅ 直接上下文（父节点上下文 + 父节点，自动继承）')}
      {rows(cross, '🔍 跨分支召回')}
      {rows(extra, '➕ 追加节点')}

      {nodeResources.length ? (
        <div className="ctx-section">
          <div className="ctx-h">📎 当前资源纳入方式</div>
          <ul>
            {nodeResources.map((r) => {
              const tier = trace?.resourcePlan?.[r.id] || (r.kind === 'image' ? 'omit' : 'raw');
              return (
                <li key={r.id} className="ctx-row">
                  <span className="ctx-res">
                    {r.kind === 'image' ? '图片' : r.filename || (r.kind === 'code' ? '代码' : '文本')}
                  </span>
                  <span className="ctx-tier" title="该资源纳入方式">{RES_TIER[tier] || tier}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

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
