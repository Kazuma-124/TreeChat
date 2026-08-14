import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { ContextElement, Resource, api } from '../api';
import CodeBlock from './CodeBlock';
import SubQuestion from './SubQuestion';
import ContextSourcePanel from './ContextSourcePanel';
import CopyButton from './CopyButton';

export type StreamSend = (opts: {
  parentId: string | null;
  userMessage: string;
  isVolatile?: boolean;
  contextElementIds?: string[];
  resources?: Resource[];
}) => Promise<string | null>;

// 单个节点的完整展示卡片（节点展示视图的基本单元）。
// 聚焦时滚动到可视区域并高亮；子提问 / 重生成完成后跳转到新节点。
export default function ConversationCard({
  node,
  allNodes,
  treeId,
  focused,
  onChanged,
  onStreamSend,
  onDelete,
  onFocus,
}: {
  node: ContextElement;
  allNodes: ContextElement[];
  treeId: string;
  focused: boolean;
  onChanged: () => void;
  onStreamSend: StreamSend;
  onDelete: (id: string, mode: 'merge' | 'discard') => void;
  onFocus: (id: string, parentId?: string | null) => void;
}) {
  const qRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  // resources 在接口里可能是 JSON 字符串（旧数据/异常路径），统一成数组再渲染，避免对字符串调 .map 崩溃
  const resList: Resource[] = Array.isArray(node.resources)
    ? node.resources
    : typeof node.resources === 'string'
    ? parseResourceList(node.resources)
    : [];
  useEffect(() => {
    // 聚焦时跳转到「提问位置」（提问与回答的交界处），而非整张卡片
    if (focused && qRef.current) {
      qRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focused]);

  // 子提问：乐观跳转——提交即先跳到新子节点所在的下一层（直接携带 parentId），
  // 不等流式返回，避免请求失败或新节点尚未载入 localNodes 时跳转失效；返回后再高亮新节点。
  const handleSub = async (opts: { parentId: string; userMessage: string; isVolatile?: boolean; resources?: Resource[] }) => {
    onFocus('', opts.parentId);
    const newId = await onStreamSend(opts);
    if (newId) onFocus(newId, opts.parentId);
  };

  return (
    <div className={`conv-card depth-${node.depth}${focused ? ' focused' : ''}`}>
      <div ref={qRef} className="msg user">
        <div className="msg-body">🙋 {node.user_message}</div>
        {resList.length > 0 ? (
          <div className="card-resources">
            {resList.map((r) => (
              <span className="card-resource" key={r.id} title={r.description || r.content}>
                {r.kind === 'image' && r.content ? (
                  <img src={r.content} className="card-resource-thumb" alt="资源" />
                ) : (
                  <span className="card-resource-name">
                    {r.kind === 'image' ? '图片' : r.filename || (r.kind === 'code' ? '代码' : '文本')}
                    {r.content ? ` · ${(r.content || '').slice(0, 30).replace(/\n/g, ' ')}` : ''}
                  </span>
                )}
                {r.description ? <em className="card-resource-desc">（{r.description}）</em> : null}
              </span>
            ))}
          </div>
        ) : null}
        <div className="msg-actions">
          <CopyButton text={node.user_message} />
          {node.status === 'completed' && !confirming ? (
            <button className="del-btn" title="删除该节点" onClick={() => setConfirming(true)}>
              ✕
            </button>
          ) : null}
          {confirming ? (
            <span className="del-confirm">
              <button
                className="del-opt"
                title="删除本节点及其所有子节点（分支）"
                onClick={() => {
                  setConfirming(false);
                  onDelete(node.id, 'discard');
                }}
              >
                删除分支
              </button>
              <button
                className="del-opt"
                title="仅删除本节点，其子节点上移到上一层"
                onClick={() => {
                  setConfirming(false);
                  onDelete(node.id, 'merge');
                }}
              >
                仅删本节点
              </button>
              <button className="del-opt cancel" onClick={() => setConfirming(false)}>
                取消
              </button>
            </span>
          ) : null}
        </div>
      </div>

      {node.status === 'completed' && node.ai_message && (
        <div className="msg ai">
          <div className="msg-body markdown">
            🤖 <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{ pre: CodeBlock }}
            >
              {node.ai_message}
            </ReactMarkdown>
          </div>
          <div className="msg-actions">
            <CopyButton text={node.ai_message} />
            {node.is_volatile ? <span className="tag volatile">探索</span> : null}
          </div>
        </div>
      )}

      {node.status === 'completed' && <TagEditor node={node} onChanged={onChanged} />}
      {node.status === 'streaming' && (
        <div className="msg ai pending">
          <span className="msg-body markdown">生成中…<ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{ pre: CodeBlock }}
          >
            {node.ai_message || ''}
          </ReactMarkdown></span>
        </div>
      )}
      {node.status === 'pending' && <div className="msg ai pending">生成中…</div>}
      {node.status === 'error' && (
        <div className="msg ai error">⚠️ 出错了：{node.ai_message || '未知错误'}</div>
      )}

      {node.context_trace || node.context_element_ids ? (
        <ContextSourcePanel
          node={node}
          trace={parseTrace(node.context_trace)}
          ids={parseIds(node.context_element_ids)}
          allNodes={allNodes}
          onStreamSend={onStreamSend}
          onFocus={onFocus}
        />
      ) : null}

      {node.ai_message && node.status === 'completed' && (
        <SubQuestion parentId={node.id} treeId={treeId} onChanged={onChanged} onStreamSend={handleSub} />
      )}
    </div>
  );
}

function TagEditor({ node, onChanged }: { node: ContextElement; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const tags = parseTags(node.tags);

  const start = () => {
    setText(tags.join(', '));
    setEditing(true);
  };
  const save = async () => {
    const next = text
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      await api.updateTags(node.id, next);
      onChanged();
    } finally {
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="tag-edit">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="逗号分隔的标签" autoFocus />
        <button onClick={save}>保存</button>
        <button className="ghost" onClick={() => setEditing(false)}>取消</button>
      </div>
    );
  }

  return (
    <div className="tags">
      {tags.length ? tags.map((t) => <span key={t} className="tag">{t}</span>) : null}
      <button className="tag-edit-btn" title="编辑标签" onClick={start}>✏️</button>
    </div>
  );
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseTrace(raw: string | null): { direct?: string[]; cross?: string[]; reasoning?: string } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// resources 可能是 JSON 字符串（接口偶发返回原始文本），安全解析成数组，解析失败返回空数组
function parseResourceList(raw: string | null): Resource[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
