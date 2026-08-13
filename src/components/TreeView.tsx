import { ContextElement } from '../api';

// 轻量树视图：聚焦节点之间的结构，每个节点只展示简介（问题 + 摘要），不展开完整回答。
// 作为快速跳转导航：点击任意节点 → onSelectNode(id)，由 ChatWindow 跳转到该节点的展示页。
export default function TreeView({
  nodes,
  onSelectNode,
}: {
  nodes: ContextElement[];
  onSelectNode?: (id: string) => void;
}) {
  const sorted = [...nodes].sort((a, b) => a.created_at - b.created_at);
  return (
    <div className="tree-view">
      {sorted.length === 0 && <div className="hint">还没有节点</div>}
      {sorted.map((n) => (
        <div
          key={n.id}
          className="tv-node"
          style={{ marginLeft: (n.depth || 0) * 22 }}
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
          {n.status === 'error' && <span className="tag error">出错</span>}
          {n.is_volatile ? <span className="tag volatile">探索</span> : null}
        </div>
      ))}
    </div>
  );
}
