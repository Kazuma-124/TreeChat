import { useState } from 'react';

export default function SubQuestion({
  parentId,
  treeId,
  onChanged,
  onStreamSend,
}: {
  parentId: string;
  treeId: string;
  onChanged: () => void;
  onStreamSend: (opts: { parentId: string; userMessage: string; isVolatile?: boolean }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [volatileMode, setVolatileMode] = useState(false);
  const [sending, setSending] = useState(false);

  const send = () => {
    if (!text.trim()) return;
    const q = text;
    setText('');
    setOpen(false);
    setSending(true);
    onStreamSend({ parentId, userMessage: q, isVolatile: volatileMode }).finally(() => setSending(false));
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
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="对此回答提出子问题…"
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
