import { Fragment } from 'react';
import { ContextElement } from '../api';

// 轻量树视图：按 parent_id 递归构建真正的树结构（而非仅按 depth 缩进），
// 这样子节点一定会挂在它真实的父节点之下。点击任意节点 → onSelectNode(id)，由 ChatWindow 跳转。
// currentParentId：当前对话窗口的父节点（即“正在查看其下的子节点层”），用 📍 标记“当前所在位置”。
// focusId：当前聚焦高亮的节点。
const ROOT = 'ROOT';
const keyOf = (id: string | null) => (id == null ? ROOT : id);

export default function TreeView({
  nodes,
  onSelectNode,
  currentParentId,
  focusId,
}: {
  nodes: ContextElement[];
  onSelectNode?: (id: string) => void;
  currentParentId?: string | null;
  focusId?: string | null;
}) {
  const childrenOf = (pid: string | null) =>
    nodes
      .filter((n) => keyOf(n.parent_id) === keyOf(pid))
      .sort((a, b) => a.sibling_index - b.sibling_index || a.created_at - b.created_at);

  const renderNode = (n: ContextElement, depth: number) => {
    const kids = childrenOf(n.id);
    const isHere = n.id === currentParentId;
    const isWindow = windowIds.has(n.id);
    const isFocus = n.id === focusId;
    const cls = [
      'tv-node',
      isHere ? 'tv-here' : '',
      isWindow ? 'tv-window' : '',
      isFocus ? 'tv-focus' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <Fragment key={n.id}>
        <div
          className={cls}
          style={{ marginLeft: depth * 22 }}
          onClick={() => onSelectNode?.(n.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onSelectNode?.(n.id);
          }}
        >
          <div className="tv-q">🙋 {n.user_message}</div>
          {n.summary ? (
            <div className="tv-a">🤖 {n.summary}</div>
          ) : n.ai_message ? (
            <div className="tv-a">
              🤖 {n.ai_message.slice(0, 40)}
              {n.ai_message.length > 40 ? '…' : ''}
            </div>
          ) : null}
          {isHere && <span className="tag here">📍 当前层</span>}
          {isFocus && !isHere && <span className="tag focus">聚焦</span>}
          {n.status === 'error' && <span className="tag error">出错</span>}
          {n.is_volatile ? <span className="tag volatile">探索</span> : null}
        </div>
        {kids.map((k) => renderNode(k, depth + 1))}
      </Fragment>
    );
  };

  const roots = childrenOf(null);
  // 当前对话窗口正在展示的节点 = currentParentId 的子节点（顶层时即根节点），在树里一并高亮，帮助判断所处位置。
  const windowIds = new Set(
    nodes.filter((n) => keyOf(n.parent_id) === keyOf(currentParentId ?? null)).map((n) => n.id)
  );
  return (
    <div className="tree-view">
      {roots.length === 0 && <div className="hint">还没有节点</div>}
      {roots.map((r) => renderNode(r, 0))}
    </div>
  );
}
