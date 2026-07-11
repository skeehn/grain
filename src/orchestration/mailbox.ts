import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { AgentMessage } from './types.js';

type MailEvent = { type: 'sent'; message: AgentMessage } | { type: 'acknowledged'; id: string; at: string };

export class AgentMailbox {
  readonly path: string;
  constructor(graphId: string, path = join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'agents', graphId, 'mailbox.jsonl')) { this.path = path; }
  private append(event: MailEvent): void { mkdirSync(dirname(this.path), { recursive: true }); appendFileSync(this.path, `${JSON.stringify(event)}\n`, { mode: 0o600 }); }
  list(to?: string): AgentMessage[] {
    const messages = new Map<string, AgentMessage>(); if (!existsSync(this.path)) return [];
    for (const line of readFileSync(this.path, 'utf8').split('\n').filter(Boolean)) {
      const event = JSON.parse(line) as MailEvent;
      if (event.type === 'sent') messages.set(event.message.id, event.message);
      else { const message = messages.get(event.id); if (!message) throw new Error(`Mailbox acknowledgement references unknown message ${event.id}`); message.acknowledgedAt = event.at; }
    }
    return [...messages.values()].filter(message => !to || message.to === to);
  }
  send(input: Omit<AgentMessage, 'id' | 'createdAt'>): AgentMessage {
    const message: AgentMessage = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.append({ type: 'sent', message }); return message;
  }
  acknowledge(id: string): AgentMessage {
    const message = this.list().find(item => item.id === id); if (!message) throw new Error(`Unknown mailbox message ${id}`);
    if (!message.acknowledgedAt) this.append({ type: 'acknowledged', id, at: new Date().toISOString() });
    return this.list().find(item => item.id === id)!;
  }
}
