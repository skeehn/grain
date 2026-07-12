import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { basename, extname, join } from 'path';
import { runDirectory } from './kernel/journal.js';

export type AttachmentKind = 'text' | 'image';
export interface GrainAttachment { id: string; name: string; path: string; storedPath: string; mediaType: string; kind: AttachmentKind; bytes: number; sha256: string; }

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.mdx', '.json', '.yaml', '.yml', '.toml', '.csv', '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.css', '.html', '.sh', '.log']);
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

export function classifyAttachment(path: string): { kind: AttachmentKind; mediaType: string } | undefined {
  const ext = extname(path).toLowerCase();
  if (IMAGE_TYPES[ext]) return { kind: 'image', mediaType: IMAGE_TYPES[ext] };
  if (TEXT_EXTENSIONS.has(ext)) return { kind: 'text', mediaType: ext === '.json' ? 'application/json' : 'text/plain' };
  return undefined;
}

export function queueAttachment(runId: string, path: string): GrainAttachment {
  if (!existsSync(path)) throw new Error(`Attachment not found: ${path}`);
  const type = classifyAttachment(path);
  if (!type) throw new Error(`Unsupported attachment: ${basename(path)}. Use text/code files or PNG, JPEG, WebP, GIF.`);
  const stat = statSync(path); if (!stat.isFile()) throw new Error(`Attachment is not a file: ${path}`);
  if (stat.size > 10 * 1024 * 1024) throw new Error(`Attachment exceeds 10 MiB: ${basename(path)}`);
  const content = readFileSync(path);
  const sha256 = createHash('sha256').update(content).digest('hex');
  const dir = join(runDirectory(runId), 'attachments'); mkdirSync(dir, { recursive: true });
  const storedPath = join(dir, `${sha256.slice(0, 12)}-${basename(path)}`); copyFileSync(path, storedPath);
  const attachment: GrainAttachment = { id: sha256.slice(0, 16), name: basename(path), path, storedPath, mediaType: type.mediaType, kind: type.kind, bytes: stat.size, sha256 };
  writeFileSync(join(dir, `${attachment.id}.json`), JSON.stringify(attachment, null, 2), { mode: 0o600 });
  return attachment;
}
