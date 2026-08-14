import { Resource } from '../api';

const CODE_EXT = [
  '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp',
  '.go', '.rs', '.rb', '.php', '.sh', '.bash', '.ps1', '.json', '.yaml', '.yml',
  '.html', '.css', '.scss', '.sql', '.md', '.xml', '.toml', '.lua', '.swift', '.kt',
];

export function kindFromMime(mime: string, name: string): Resource['kind'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('text/')) return 'text';
  const lower = name.toLowerCase();
  if (CODE_EXT.some((e) => lower.endsWith(e)) || mime === 'application/json') return 'code';
  return 'file';
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// 发送前压缩图片：最长边缩到 maxSide，转 JPEG 以减小 base64 体积与 token 消耗。
export async function resizeImage(dataUrl: string, maxSide = 2048, quality = 0.85): Promise<string> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('image load failed'));
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return dataUrl;
  }
}

export async function fileToResource(file: File): Promise<Resource> {
  const kind = kindFromMime(file.type, file.name);
  let content = await readFileAsDataURL(file);
  if (kind === 'image') content = await resizeImage(content, 2048);
  return {
    id: crypto.randomUUID(),
    kind,
    mime: file.type || undefined,
    filename: file.name,
    content,
  };
}

// 由剪贴板长文本构造资源（手打短文本不在此列）
export function textToResource(text: string): Resource {
  const looksLikeCode = text.includes('\n') && /[{}();=]|=>|function|def |class |import |SELECT /i.test(text);
  return {
    id: crypto.randomUUID(),
    kind: looksLikeCode ? 'code' : 'text',
    content: text,
  };
}

export function resourcePreview(r: Resource): string {
  if (r.kind === 'image') return r.filename || '图片';
  const head = (r.content || '').slice(0, 60).replace(/\n/g, ' ');
  return `${r.filename ? r.filename + ' · ' : ''}${head}`;
}
