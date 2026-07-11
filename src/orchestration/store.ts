import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { TaskGraph } from './types.js';

function graphDir(): string { return join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'agents'); }

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
    return JSON.parse(readFileSync(path, 'utf8')) as TaskGraph;
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
      .map(name => JSON.parse(readFileSync(join(graphDir(), name), 'utf8')) as TaskGraph);
  }
}
