import { useState } from 'react';

// 复制某段文本到剪贴板，点击后短暂显示「已复制」反馈。
export default function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 退化方案：clipboard API 不可用时用临时 textarea
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      className={`copy-btn${copied ? ' copied' : ''}${className ? ' ' + className : ''}`}
      title="复制此框文本"
      onClick={onClick}
    >
      {copied ? '✓ 已复制' : '📋 复制'}
    </button>
  );
}
