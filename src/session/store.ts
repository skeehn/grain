// Session store - simple JSON file (fast, no native deps, no WASM)
import { join } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { Message } from '../providers/types.js';

const DB_DIR = process.env.GRAIN_HOME || join(homedir(), '.grain');
const DB_PATH = join(DB_DIR, 'sessions.json');

interface SessionRecord {
  id: string;
  title: string | null;
  messages: Array<{ id: string; role: string; content_json: string; created_at: string }>;
  created_at: string;
  updated_at: string;
}

interface SessionStore {
  sessions: SessionRecord[];
}

let store: SessionStore | null = null;

function getStore(): SessionStore {
  if (store) return store;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  if (existsSync(DB_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(DB_PATH, 'utf-8'));
      // Validate shape — `null` or a foreign schema would break every caller
      if (parsed && Array.isArray(parsed.sessions)) {
        store = parsed;
        return store!;
      }
    } catch {
      // Corrupted, start fresh
    }
  }

  store = { sessions: [] };
  return store;
}

function saveStore() {
  if (store) {
    // Keep only last 50 sessions to prevent bloat
    if (store.sessions.length > 50) {
      store.sessions = store.sessions.slice(-50);
    }
    // Atomic write: a crash mid-write must not leave truncated JSON
    // (the corruption handler would then silently discard all history).
    const tmp = DB_PATH + '.tmp';
    writeFileSync(tmp, JSON.stringify(store, null, 2));
    renameSync(tmp, DB_PATH);
  }
}

export async function createSession(title?: string): Promise<string> {
  const id = randomUUID();
  const s = getStore();
  s.sessions.push({
    id,
    title: title || null,
    messages: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  saveStore();
  return id;
}

export async function addMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: Message['content']
): Promise<void> {
  const s = getStore();
  const session = s.sessions.find(sess => sess.id === sessionId);
  if (!session) return;

  session.messages.push({
    id: randomUUID(),
    role,
    content_json: JSON.stringify(content),
    created_at: new Date().toISOString(),
  });
  session.updated_at = new Date().toISOString();

  // Keep only last 100 messages per session
  if (session.messages.length > 100) {
    session.messages = session.messages.slice(-100);
    // Truncation must not cut between a tool_use and its tool_result, and the
    // history must start with a plain user message — otherwise --resume 400s.
    const carriesToolResult = (m: SessionRecord['messages'][number]): boolean => {
      try {
        const blocks = JSON.parse(m.content_json);
        return Array.isArray(blocks) && blocks.some((b: any) => b?.type === 'tool_result');
      } catch {
        return false;
      }
    };
    // Bound the cleanup: a long tool-only stretch could otherwise strip the
    // whole slice and wipe persisted --resume history. If no clean user
    // boundary exists within a few messages, keep the 100 as-is — a rare
    // imperfect resume beats deleting the session.
    const MAX_STRIP = 10;
    let stripped = 0;
    while (
      session.messages.length > 1 &&
      stripped < MAX_STRIP &&
      (session.messages[0].role === 'assistant' || carriesToolResult(session.messages[0]))
    ) {
      session.messages.shift();
      stripped++;
    }
  }

  saveStore();
}

export async function getMessages(sessionId: string): Promise<Message[]> {
  const s = getStore();
  const session = s.sessions.find(sess => sess.id === sessionId);
  if (!session) return [];

  return session.messages.map(msg => ({
    role: msg.role as 'user' | 'assistant',
    content: JSON.parse(msg.content_json),
  }));
}

export async function getLastSession(): Promise<string | null> {
  const s = getStore();
  if (s.sessions.length === 0) return null;
  // Sort by updated_at descending
  const sorted = [...s.sessions].sort((a, b) =>
    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
  return sorted[0].id;
}
