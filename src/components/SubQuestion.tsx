import { useState } from 'react';
import { Resource } from '../api';
import ResourceTray from './ResourceTray';
import { textToResource } from '../utils/resources';

export default function SubQuestion({
  parentId,
  treeId,
  onChanged,
  onStreamSend,
}: {
  parentId: string;
  treeId: string;
  onChanged: () => void;
  onStreamSend: (opts: { parentId: string; userMessage: string; isVolatile?: boolean; resources?: Resource[] }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [resources, setResources] = useState<Resource[]>([]);
  const [volatileMode, setVolatileMode] = useState(false);
  const [sending, setSending] = useState(false);

  const send = () => {
    if (!text.trim() && resources.length === 0) return;
    const q = text;
    const res = resources;
    setText('');
    setResources([]);
    setOpen(false);
    setSending(true);
    onStreamSend({ parentId, userMessage: q, isVolatile: volatileMode, resources: res }).finally(() =>
      setSending(false)
    );
  };

  // 粘贴大段文本/代码时，转为资源而非塞进输入框
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const t = e.clipboardData.getData('text');
    if (t.length > 200) {
      e.preventDefault();
      setResources((prev) => [...prev, textToResource(t)]);
    }
  };

  if (!open) {
    return (
      <button className="subq-toggle" onClick={() => setOpen(true)} disabled={sending}>
        💬 追问
      </button>
    );
  }

  return (
    <div className="subq">
      <ResourceTray resources={resources} onChange={setResources} disabled={sending} />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={handlePaste}
        placeholder="对此回答提出子问题…（粘贴大段文本/代码会自动转为资源）"
      />
      <div className="subq-row">
        <label>
          <input type="checkbox" checked={volatileMode} onChange={(e) => setVolatileMode(e.target.checked)} />
          探索模式
        </label>
        <button onClick={send} disabled={sending}>
          {sending ? '生成中…' : '提交'}
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </div>
  );
}
