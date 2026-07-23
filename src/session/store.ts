// Durable session store: one versioned JSON file per conversation.
// This avoids whole-database lost updates when multiple Grain processes run.
import { join } from 'path';
import {
  appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { Message } from '../providers/types.js';

const SESSION_SCHEMA_VERSION = 1;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;

export interface SessionRecord {
  schema_version?: 1;
  id: string;
  title: string | null;
  /** Stable project identity; absent records are retained as legacy global sessions. */
  workspace?: string;
  messages: Array<{ id: string; role: string; content_json: string; created_at: string }>;
  created_at: string;
  updated_at: string;
}

interface LegacySessionStore { sessions: SessionRecord[] }

function grainHome(): string {
  return process.env.GRAIN_HOME || join(homedir(), '.grain');
}

export function sessionsDirectory(): string {
  return join(grainHome(), 'sessions');
}

function legacyPath(): string {
  return join(grainHome(), 'sessions.json');
}

function sessionPath(id: string): string | null {
  return SESSION_ID.test(id) ? join(sessionsDirectory(), `${id}.json`) : null;
}

export function sessionArchivePath(id: string): string | null {
  return SESSION_ID.test(id) ? join(sessionsDirectory(), `${id}.archive.jsonl`) : null;
}

function parseSession(value: unknown): SessionRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<SessionRecord>;
  if (typeof raw.id !== 'string' || !SESSION_ID.test(raw.id) || !Array.isArray(raw.messages)) return null;
  const messages = raw.messages.filter(message => {
    if (!message || typeof message !== 'object' || typeof message.id !== 'string'
      || (message.role !== 'user' && message.role !== 'assistant')
      || typeof message.content_json !== 'string' || typeof message.created_at !== 'string') return false;
    try { return Array.isArray(JSON.parse(message.content_json)); }
    catch { return false; }
  });
  const now = new Date().toISOString();
  return {
    schema_version: SESSION_SCHEMA_VERSION,
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : null,
    workspace: typeof raw.workspace === 'string' ? raw.workspace : undefined,
    messages,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : now,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : now,
  };
}

function durableWrite(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  // Persist the directory entry where the platform supports directory fsync.
  try {
    const dir = openSync(sessionsDirectory(), 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  } catch { /* best effort on filesystems that reject directory fsync */ }
}

function readSession(id: string): SessionRecord | null {
  const path = sessionPath(id);
  if (!path || !existsSync(path)) return null;
  try { return parseSession(JSON.parse(readFileSync(path, 'utf8'))); }
  catch { return null; }
}

function archiveMessages(id: string, messages: SessionRecord['messages']): void {
  if (!messages.length) return;
  const path = sessionArchivePath(id);
  if (!path) return;
  const fd = openSync(path, 'a', 0o600);
  try {
    for (const message of messages) appendFileSync(fd, `${JSON.stringify(message)}\n`);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

function waitBriefly(ms = 10): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withSessionLock<T>(id: string, operation: () => T): T {
  const path = sessionPath(id);
  if (!path) throw new Error(`Invalid session id: ${id}`);
  const lock = `${path}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let acquired = false;
  while (!acquired) {
    try {
      const fd = openSync(lock, 'wx', 0o600);
      closeSync(fd);
      acquired = true;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) unlinkSync(lock);
      } catch { /* another process released it */ }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for session lock: ${id}`);
      waitBriefly();
    }
  }
  try { return operation(); }
  finally { try { unlinkSync(lock); } catch { /* already cleaned */ } }
}

const migratedHomes = new Set<string>();

function ensureStorage(): void {
  const home = grainHome();
  mkdirSync(sessionsDirectory(), { recursive: true });
  if (migratedHomes.has(home)) return;
  const marker = join(sessionsDirectory(), '.legacy-migrated-v1');
  const legacy = legacyPath();
  if (!existsSync(marker) && existsSync(legacy)) {
    try {
      const parsed = JSON.parse(readFileSync(legacy, 'utf8')) as LegacySessionStore;
      for (const raw of Array.isArray(parsed?.sessions) ? parsed.sessions : []) {
        const session = parseSession(raw);
        if (!session) continue;
        const path = sessionPath(session.id)!;
        if (!existsSync(path)) durableWrite(path, session);
      }
      durableWrite(marker, { schema_version: 1, migrated_at: new Date().toISOString(), source: 'sessions.json' });
    } catch {
      // Keep the legacy file untouched. A later launch can retry after repair.
    }
  }
  migratedHomes.add(home);
}

export function workspaceKey(cwd = process.cwd()): string {
  const normalized = cwd.replaceAll('\\', '/');
  if (/^[A-Za-z]:\/$/u.test(normalized)) return normalized;
  return normalized.replace(/\/+$/u, '') || '/';
}

export async function createSession(title?: string, workspace?: string): Promise<string> {
  ensureStorage();
  const id = randomUUID();
  const now = new Date().toISOString();
  const session: SessionRecord = {
    schema_version: SESSION_SCHEMA_VERSION,
    id,
    title: title || null,
    workspace: workspace ? workspaceKey(workspace) : undefined,
    messages: [],
    created_at: now,
    updated_at: now,
  };
  durableWrite(sessionPath(id)!, session);
  return id;
}

export async function addMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: Message['content'],
): Promise<void> {
  ensureStorage();
  if (!sessionPath(sessionId)) return;
  withSessionLock(sessionId, () => {
    const session = readSession(sessionId);
    if (!session) return;
    session.messages.push({
      id: randomUUID(), role, content_json: JSON.stringify(content), created_at: new Date().toISOString(),
    });
    session.updated_at = new Date().toISOString();

    const archived: SessionRecord['messages'] = [];
    if (session.messages.length > 100) {
      archived.push(...session.messages.slice(0, -100));
      session.messages = session.messages.slice(-100);
      const carriesToolResult = (message: SessionRecord['messages'][number]): boolean => {
        try {
          const blocks = JSON.parse(message.content_json);
          return Array.isArray(blocks) && blocks.some((block: any) => block?.type === 'tool_result');
        } catch { return false; }
      };
      let stripped = 0;
      while (session.messages.length > 1 && stripped < 10
        && (session.messages[0].role === 'assistant' || carriesToolResult(session.messages[0]))) {
        archived.push(session.messages.shift()!);
        stripped++;
      }
    }
    // Archive before replacing the active window. A crash can at worst leave
    // duplicate archive lines, which retain stable message IDs for deduping;
    // it cannot silently lose an evicted message.
    archiveMessages(sessionId, archived);
    durableWrite(sessionPath(sessionId)!, session);
  });
}

export async function getMessages(sessionId: string): Promise<Message[]> {
  ensureStorage();
  const session = readSession(sessionId);
  if (!session) return [];
  return session.messages.flatMap(message => {
    try { return [{ role: message.role as 'user' | 'assistant', content: JSON.parse(message.content_json) }]; }
    catch { return []; }
  });
}

function allSessions(): SessionRecord[] {
  ensureStorage();
  return readdirSync(sessionsDirectory())
    .filter(name => SESSION_ID.test(name.replace(/\.json$/u, '')) && name.endsWith('.json'))
    .flatMap(name => {
      try {
        const parsed = parseSession(JSON.parse(readFileSync(join(sessionsDirectory(), name), 'utf8')));
        return parsed ? [parsed] : [];
      } catch { return []; }
    });
}

export async function getLastSession(workspace?: string): Promise<string | null> {
  const key = workspace ? workspaceKey(workspace) : undefined;
  const candidates = allSessions().filter(session => !key || session.workspace === key);
  candidates.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return candidates[0]?.id || null;
}

export async function listSessions(workspace?: string): Promise<Pick<SessionRecord, 'id' | 'title' | 'workspace' | 'updated_at'>[]> {
  const key = workspace ? workspaceKey(workspace) : undefined;
  return allSessions().filter(session => !key || session.workspace === key)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .map(({ id, title, workspace: sessionWorkspace, updated_at }) => ({ id, title, workspace: sessionWorkspace, updated_at }));
}
