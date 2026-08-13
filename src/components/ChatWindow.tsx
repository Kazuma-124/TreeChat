import { useCallback, useEffect, useRef, useState } from 'react';
import { ContextElement, api, sendMessageStream, DEFAULT_MODEL } from '../api';
import ModelSelector from './ModelSelector';
import TreeView from './TreeView';
import ConversationCard from './ConversationCard';
import ApiSettings from './ApiSettings';

const ROOT = 'ROOT';
const key = (id: string | null) => id ?? ROOT;

export type StreamSend = (opts: {
  parentId: string | null;
  userMessage: string;
  isVolatile?: boolean;
  contextElementIds?: string[];
}) => Promise<string | null>;

// 层级分页式节点展示视图：
//  - currentParentId 决定「当前页」展示哪一层（parent_id 相同的兄弟节点）。
//  - 上一层（up-bar）：currentParentId 的兄弟节点，单行简介；含「返回上一层」按钮。
//  - 当前层：ConversationCard 完整展示，可滚动。
//  - 下一层（down-bar）：当前层各节点的子节点，单行简介，点击进入。
//  - 树视图仅作快速跳转：点击节点跳转到该节点的展示页。
export default function ChatWindow({
  nodes,
  treeId,
  focusId,
  onChanged,
  loading,
}: {
  nodes: ContextElement[];
  treeId: string;
  focusId?: string | null;
  onChanged: () => void;
  loading: boolean;
}) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [currentParentId, setCurrentParentId] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [showTree, setShowTree] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const [nextOpen, setNextOpen] = useState(true);
  const [localNodes, setLocalNodes] = useState<ContextElement[]>(nodes);
  const downLevelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalNodes(nodes);
  }, [nodes]);

  // 聚焦跳转：外部（搜索 / 创建节点）指定 focusId 时，导航到该节点所在页并高亮。
  useEffect(() => {
    if (!focusId) return;
    const n = localNodes.find((x) => x.id === focusId);
    if (n) {
      setCurrentParentId(n.parent_id);
      setFocus(n.id);
      const t = setTimeout(() => setFocus(null), 2500);
      return () => clearTimeout(t);
    }
  }, [focusId, localNodes]);

  const byParent = (pid: string | null) =>
    localNodes
      .filter((n) => key(n.parent_id) === key(pid))
      .sort((a, b) => a.sibling_index - b.sibling_index || a.created_at - b.created_at);

  const currentParentNode = currentParentId ? localNodes.find((n) => n.id === currentParentId) ?? null : null;
  const currentChildren = byParent(currentParentId);
  // 上一层：currentParentId 的兄弟节点（顶层时为空）。
  const upParentKey = currentParentNode ? currentParentNode.parent_id : null;
  const upLevel = currentParentId ? byParent(upParentKey) : [];
  // 下一层：当前层各节点的子节点。
  const downChildren = localNodes.filter((n) =>
    currentChildren.some((c) => key(c.id) === key(n.parent_id))
  );

  // 下一层侧栏：焦点所在分组滚动进可视区（竖向）
  useEffect(() => {
    const c = downLevelRef.current;
    if (!c) return;
    const fid =
      focus && currentChildren.some((n) => n.id === focus)
        ? focus
        : localNodes.find((n) => n.id === focus)?.parent_id ?? null;
    if (!fid) return;
    const el = c.querySelector<HTMLElement>(`[data-parent="${fid}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [focus, currentChildren, downChildren]);

  // 面包屑：从根到 currentParentId 的祖先链。
  const path: ContextElement[] = [];
  let cur = currentParentNode;
  while (cur) {
    path.unshift(cur);
    cur = cur.parent_id ? localNodes.find((n) => n.id === cur!.parent_id) ?? null : null;
  }

  const streamSend = useCallback<StreamSend>(
    async ({ parentId, userMessage, isVolatile, contextElementIds }) => {
      const tempId = crypto.randomUUID();
      const parent = localNodes.find((n) => n.id === parentId);
      const depth = parent ? parent.depth + 1 : 0;
      const temp: ContextElement = {
        id: tempId,
        tree_id: treeId,
        parent_id: parentId,
        sibling_index: 0,
        depth,
        user_message: userMessage,
        ai_message: '',
        model: model || DEFAULT_MODEL,
        model_config: null,
        status: 'streaming',
        summary: null,
        tags: null,
        token_count: 0,
        context_element_ids: contextElementIds ? JSON.stringify(contextElementIds) : null,
        context_trace: null,
        embedding: null,
        is_volatile: isVolatile ? 1 : 0,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      setLocalNodes((prev) => [...prev, temp]);
      setSending(true);
      try {
        let newId: string | null = tempId;
        await sendMessageStream({
          treeId,
          parentId,
          userMessage,
          model,
          isVolatile,
          contextElementIds,
          onStart: (info) => {
            newId = info.id;
          },
          onToken: (delta) =>
            setLocalNodes((prev) =>
              prev.map((n) => (n.id === tempId ? { ...n, ai_message: (n.ai_message || '') + delta } : n))
            ),
          onError: (msg) =>
            setLocalNodes((prev) =>
              prev.map((n) =>
                n.id === tempId ? { ...n, status: 'error', ai_message: msg || n.ai_message || '出错了' } : n
              )
            ),
        });
        onChanged();
        return newId;
      } catch (e) {
        setLocalNodes((prev) =>
          prev.map((n) =>
            n.id === tempId ? { ...n, status: 'error', ai_message: (e as Error)?.message || n.ai_message || '出错了' } : n
          )
        );
        return null;
      } finally {
        setSending(false);
      }
    },
    [treeId, localNodes, model, onChanged]
  );

  const sendCurrent = () => {
    if (!input.trim()) return;
    const text = input;
    setInput('');
    streamSend({ parentId: currentParentId, userMessage: text }).then((newId) => {
      if (newId) setFocus(newId);
    });
  };

  const handleFocus = (id: string, parentId?: string | null) => {
    // 优先用调用方已知的直接父节点，避免新节点尚未载入 localNodes 时无法定位页面
    if (parentId !== undefined) setCurrentParentId(parentId);
    else {
      const n = localNodes.find((x) => x.id === id);
      if (n) setCurrentParentId(n.parent_id);
    }
    setFocus(id);
  };

  const handleDelete = useCallback(
    async (id: string) => {
      const mode = window.confirm('确定丢弃该节点？\n[确定] = 丢弃（含子树）\n[取消] = 合并到父节点')
        ? 'discard'
        : 'merge';
      const target = localNodes.find((n) => n.id === id);
      await api.deleteNode(id, mode);
      if (currentParentId === id && target) setCurrentParentId(target.parent_id);
      onChanged();
    },
    [currentParentId, localNodes, onChanged]
  );

  const jumpToNode = (id: string) => {
    handleFocus(id);
    setShowTree(false);
  };

  const brief = (n: ContextElement) =>
    (n.summary || n.ai_message || '').slice(0, 42) || '（空回答）';

  return (
    <div className="chat">
      <div className="chat-toolbar">
        <div className="crumbs">
          <button className="crumb root" onClick={() => { setCurrentParentId(null); setFocus(null); }}>
            🏠 根
          </button>
          {path.map((p) => (
            <span key={p.id} className="crumb-sep">›</span>
          ))}
          {path.map((p) => (
            <button
              key={p.id}
              className="crumb"
              onClick={() => { setCurrentParentId(p.id); setFocus(null); }}
            >
              {p.user_message.slice(0, 16)}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <button className="api-config-btn" onClick={() => setShowApi(true)} title="API 配置方案">
            ⚙ API
          </button>
          <button className={`tree-jump${showTree ? ' active' : ''}`} onClick={() => setShowTree((v) => !v)}>
            🌳 树视图
          </button>
          <ModelSelector value={model} onChange={setModel} />
        </div>
      </div>

      {showTree ? (
        <div className="chat-list tree-jump-view">
          <TreeView
            nodes={localNodes}
            onSelectNode={jumpToNode}
            currentParentId={currentParentId}
            focusId={focus}
          />
        </div>
      ) : (
        <div className="chat-body">
          <div className="chat-main">
            {/* 上一层 */}
            {currentParentId !== null && (
              <div className="level-bar up">
                <button className="nav-btn" onClick={() => setCurrentParentId(upParentKey)}>
                  ↑ 返回上一层
                </button>
                <div className="level-briefs">
                  {upLevel.map((n) => (
                    <button
                      key={n.id}
                      className={`brief${n.id === currentParentId ? ' here' : ''}`}
                      onClick={() => { setCurrentParentId(n.id); setFocus(null); }}
                      title={n.user_message}
                    >
                      🙋 {n.user_message.slice(0, 24)}
                      <span className="brief-a"> · {brief(n).slice(0, 18)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 当前层 */}
            <div className="chat-list current-level">
              {currentChildren.length === 0 ? (
                <div className="hint">
                  {currentParentId === null ? '从下面的输入框开始第一个问题' : '这一层还没有对话，发送一条试试'}
                </div>
              ) : (
                currentChildren.map((n) => (
                  <ConversationCard
                    key={n.id}
                    node={n}
                    allNodes={localNodes}
                    treeId={treeId}
                    focused={focus === n.id}
                    onChanged={onChanged}
                    onStreamSend={streamSend}
                    onDelete={handleDelete}
                    onFocus={handleFocus}
                  />
                ))
              )}
            </div>
          </div>

          {/* 下一层：右侧栏，按当前窗口节点分组（组头=当前窗口节点，下方=各自子节点） */}
          {nextOpen && downChildren.length > 0 && (
            <aside className="next-sidebar" ref={downLevelRef}>
              <div className="next-sidebar-head">
                <span className="level-label">↓ 下一层</span>
                <button className="sidebar-collapse" onClick={() => setNextOpen(false)} title="收起侧栏">⟨</button>
              </div>
              <div className="next-groups">
                {currentChildren.map((p) => {
                  const kids = byParent(p.id);
                  return (
                    <div className="down-group" key={p.id} data-parent={p.id}>
                      <button
                        className={`down-parent${focus === p.id ? ' active' : ''}`}
                        onClick={() => setFocus(p.id)}
                        title={p.user_message}
                      >
                        🙋 {p.user_message.slice(0, 20)}
                      </button>
                      <div className="down-kids">
                        {kids.length === 0 ? (
                          <span className="down-empty">（无）</span>
                        ) : (
                          kids.map((k) => (
                            <button
                              key={k.id}
                              className="brief"
                              onClick={() => jumpToNode(k.id)}
                              title={k.user_message}
                            >
                              🙋 {k.user_message.slice(0, 20)}
                              <span className="brief-a"> · {brief(k).slice(0, 16)}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>
          )}
        </div>
      )}
      {!showTree && !nextOpen && downChildren.length > 0 && (
        <button className="next-reopen" onClick={() => setNextOpen(true)} title="展开下一层侧栏">↓ 下一层</button>
      )}

      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            currentParentId === null
              ? '输入根问题…（Enter 换行，点击发送）'
              : `在「${(currentParentNode?.user_message ?? '').slice(0, 16)}」下发送子问题…`
          }
        />
        <button onClick={sendCurrent} disabled={sending || loading}>
          {sending ? '生成中…' : '发送'}
        </button>
      </div>

      {showApi && <ApiSettings onClose={() => setShowApi(false)} />}
    </div>
  );
}
