import { useRef, useState, type ReactNode } from 'react';

// 作为 ReactMarkdown 的 `pre` 覆写组件：在代码块右上角放一个复制按钮。
// 复制时直接读取渲染后 <pre> 的 textContent，避免再解析语法高亮后的 DOM。
export default function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const text = ref.current?.textContent ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默失败（如非 localhost / 非 https 环境）
    }
  };

  return (
    <div className="code-block">
      <button className="code-copy" type="button" onClick={onCopy} aria-label="复制代码">
        {copied ? '已复制' : '复制'}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}
