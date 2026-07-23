import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { TaskGraph } from './types.js';
import { DEFAULT_RUN_TREE_LIMITS } from './types.js';

function graphDir(): string { return join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'agents'); }

function normalizeGraph(raw: any): TaskGraph {
  const createdAt = String(raw?.createdAt || raw?.tasks?.[0]?.createdAt || new Date(0).toISOString());
  const tasks = Array.isArray(raw?.tasks) ? raw.tasks : [];
  const byId = new Map(tasks.map((task: any) => [task.id, task]));
  const depthOf = (task: any, seen = new Set<string>()): number => {
    if (!task?.parentId || seen.has(task.id)) return 0;
    seen.add(task.id); return 1 + depthOf(byId.get(task.parentId), seen);
  };
  return { ...raw, createdAt, limits: { ...DEFAULT_RUN_TREE_LIMITS, ...(raw?.limits || {}) },
    usage: { turns: 0, tokens: 0, costUsd: 0, wallTimeMs: 0, toolCalls: 0, ...(raw?.usage || {}) },
    tasks: tasks.map((task: any) => ({ ...task, depth: Number.isInteger(task.depth) ? task.depth : depthOf(task) })) } as TaskGraph;
}

export class TaskGraphStore {
  save(graph: TaskGraph): string {
    const path = join(graphDir(), `${graph.id}.json`); mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(graph, null, 2)}\n`, { mode: 0o600 }); renameSync(temp, path);
    return path;
  }
  load(id: string): TaskGraph {
    const path = join(graphDir(), `${id}.json`);
    if (!existsSync(path)) throw new Error(`Unknown agent graph ${id}`);
    return normalizeGraph(JSON.parse(readFileSync(path, 'utf8')));
  }
  update(id: string, mutate: (graph: TaskGraph) => void): TaskGraph {
    const lock = join(graphDir(), `${id}.lock`); mkdirSync(graphDir(), { recursive: true });
    let descriptor: number | undefined;
    for (let attempt = 0; attempt < 500; attempt++) {
      try { descriptor = openSync(lock, 'wx', 0o600); break; }
      catch (error: any) {
        if (error?.code !== 'EEXIST') throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    if (descriptor === undefined) throw new Error(`Timed out acquiring graph lock ${id}`);
    try { const graph = this.load(id); mutate(graph); this.save(graph); return graph; }
    finally { closeSync(descriptor); try { unlinkSync(lock); } catch {} }
  }
  list(): TaskGraph[] {
    if (!existsSync(graphDir())) return [];
    return readdirSync(graphDir()).filter(name => name.endsWith('.json')).sort()
      .map(name => normalizeGraph(JSON.parse(readFileSync(join(graphDir(), name), 'utf8'))));
  }
}
