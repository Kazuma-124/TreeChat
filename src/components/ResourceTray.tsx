import { useRef } from 'react';
import { Resource } from '../api';
import { fileToResource, resourcePreview } from '../utils/resources';

const ACCEPT =
  'image/*,text/*,.js,.jsx,.ts,.tsx,.py,.java,.cpp,.c,.h,.hpp,.go,.rs,.rb,.php,.sh,.bash,.ps1,.json,.yaml,.yml,.html,.css,.scss,.sql,.md,.xml,.toml,.lua,.swift,.kt';

export default function ResourceTray({
  resources,
  onChange,
  disabled,
}: {
  resources: Resource[];
  onChange: (next: Resource[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const next = [...resources];
    for (const f of Array.from(files)) next.push(await fileToResource(f));
    onChange(next);
  };

  const remove = (id: string) => onChange(resources.filter((r) => r.id !== id));

  return (
    <div className="resource-tray">
      {resources.map((r) => (
        <div className="resource-chip" key={r.id}>
          {r.kind === 'image' && r.content ? (
            <img src={r.content} alt="资源" className="resource-thumb" />
          ) : (
            <span className="resource-text" title={r.content}>{resourcePreview(r)}</span>
          )}
          <button className="resource-del" onClick={() => remove(r.id)} disabled={disabled} title="移除">
            ×
          </button>
        </div>
      ))}
      <button className="resource-add" onClick={() => inputRef.current?.click()} disabled={disabled} title="添加图片/文件">
        📎
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
