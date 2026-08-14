import { useEffect, useState } from 'react';
import { Tree, api, downloadText, SearchHit, getSession, notifyUnauthorized } from '../api';

export default function TreeSidebar({
  trees,
  currentId,
  onSelect,
  onCreate,
  onImported,
  onSearchSelect,
  onDeleteTree,
  onRenameTree,
}: {
  trees: Tree[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImported: (id: string) => void;
  onSearchSelect: (treeId: string, nodeId: string) => void;
  onDeleteTree: (id: string) => void;
  onRenameTree: (id: string) => void;
}) {
  const exportJson = async (id: string) => {
    const text = await api.exportTree(id, 'json');
    downloadText(`${id}.json`, text);
  };
  const exportMd = async (id: string) => {
    const text = await api.exportTree(id, 'md');
    downloadText(`${id}.md`, text, 'text/markdown');
  };
  const importFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        const t = await api.importTree(payload);
        onImported(t.id);
      } catch (e) {
        alert('导入失败：' + (e as Error).message);
      }
    };
    input.click();
  };

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const me = getSession()?.user ?? null;
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setHits(await api.search(term));
      } catch {
        setHits([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const logout = () => {
    if (window.confirm('确定退出登录？')) notifyUnauthorized();
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>对话树</span>
        <div className="sidebar-actions">
          <button onClick={importFile} title="导入 JSON">📥</button>
          <button onClick={onCreate} title="新建对话树">+</button>
        </div>
      </div>

      <div className="sidebar-user">
        <span className="user-name" title={me?.username}>{me?.username ?? '未登录'}{me?.is_admin ? '（管理员）' : ''}</span>
        <button className="user-logout" onClick={logout} title="退出登录">退出</button>
      </div>

      <div className="search-box">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 跨树搜索…" />
        {hits.length ? (
          <ul className="search-results">
            {hits.map((h) => (
              <li key={h.id} onClick={() => onSearchSelect(h.tree_id, h.id)}>
                <span className="sr-tree">{h.tree_title}</span>
                <span className="sr-q">{h.user_message.slice(0, 30)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <ul>
        {trees.map((t) => (
          <li
            key={t.id}
            className={t.id === currentId ? 'active' : ''}
            onClick={() => onSelect(t.id)}
          >
            <span className="tree-title">{t.title}</span>
            <span className="tree-export" onClick={(e) => e.stopPropagation()}>
              <button title="导出 JSON" onClick={() => exportJson(t.id)}>JSON</button>
              <button title="导出 Markdown" onClick={() => exportMd(t.id)}>MD</button>
              <button title="重命名" onClick={(e) => { e.stopPropagation(); onRenameTree(t.id); }}>✏️</button>
              <button title="删除整个对话记录" className="tree-del" onClick={() => onDeleteTree(t.id)}>🗑</button>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
