import { useCallback, useEffect, useState } from 'react';
import { api, ContextElement, Tree } from './api';
import TreeSidebar from './components/TreeSidebar';
import ChatWindow from './components/ChatWindow';
import ApiSettings from './components/ApiSettings';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  const [trees, setTrees] = useState<Tree[]>([]);
  const [treeId, setTreeId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<ContextElement[]>([]);
  const [loading, setLoading] = useState(false);
  const [showApi, setShowApi] = useState(false);

  const loadTrees = useCallback(async () => {
    try {
      const t = await api.listTrees();
      setTrees(t);
      setTreeId((cur) => cur ?? t[0]?.id ?? null);
    } catch (e) {
      console.error('加载对话树列表失败：', e);
    }
  }, []);

  const loadTree = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const t = await api.getTree(id);
      setNodes(t.nodes);
    } catch (e) {
      console.error('加载对话树失败：', e);
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrees();
  }, [loadTrees]);

  useEffect(() => {
    if (treeId) loadTree(treeId);
  }, [treeId, loadTree]);

  const createTree = async () => {
    try {
      const t = await api.createTree();
      setTrees((p) => [t, ...p]);
      setTreeId(t.id);
    } catch (e) {
      console.error('创建对话树失败：', e);
      alert('创建对话树失败：' + (e as Error).message);
    }
  };

  const refresh = () => {
    if (treeId) loadTree(treeId);
  };

  const onImported = async (id: string) => {
    await loadTrees();
    setTreeId(id);
  };

  const onDeleteTree = async (id: string) => {
    if (!window.confirm('确定删除整棵对话树？\n该操作会同步删除数据库中这棵树的全部节点与元数据，且不可恢复。')) {
      return;
    }
    try {
      await api.deleteTree(id);
      const remaining = trees.filter((t) => t.id !== id);
      setTrees(remaining);
      if (treeId === id) {
        const next = remaining[0]?.id ?? null;
        setTreeId(next);
      }
    } catch (e) {
      alert('删除失败：' + (e as Error).message);
    }
  };

  const onRenameTree = async (id: string) => {
    const cur = trees.find((t) => t.id === id)?.title ?? '';
    const name = window.prompt('重命名对话树：', cur);
    if (!name || !name.trim()) return;
    try {
      const updated = await api.renameTree(id, name.trim());
      setTrees((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (e) {
      alert('重命名失败：' + (e as Error).message);
    }
  };

  const onSearchSelect = (tid: string, nodeId: string) => {
    setTreeId(tid);
    setFocusId(nodeId);
    // 切换树后节点列表会重载，聚焦高亮在 ChatWindow 内生效
    setTimeout(() => setFocusId(null), 2500);
  };

  const [focusId, setFocusId] = useState<string | null>(null);

  return (
    <ErrorBoundary>
      <div className="app">
        <TreeSidebar
          trees={trees}
          currentId={treeId}
          onSelect={setTreeId}
          onCreate={createTree}
          onImported={onImported}
          onSearchSelect={onSearchSelect}
          onDeleteTree={onDeleteTree}
          onRenameTree={onRenameTree}
          onOpenApi={() => setShowApi(true)}
        />
        <main className="main">
          {treeId ? (
            <ChatWindow
              nodes={nodes}
              treeId={treeId}
              focusId={focusId}
              onChanged={refresh}
              loading={loading}
            />
          ) : (
            <div className="empty">
              <p>还没有对话树</p>
              <button onClick={createTree}>+ 新建一个</button>
            </div>
          )}
        </main>
      </div>
      {showApi && <ApiSettings onClose={() => setShowApi(false)} />}
    </ErrorBoundary>
  );
}
