// Context Tracker - Session file/operation tracking
// Lightweight, synchronous, no engram dependency for core tracking
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { createHash, randomUUID } from 'crypto';

interface SessionContext {
  sessionId: string;
  startTime: number;
  workingDirectory: string;
  lastModifiedFile?: string;
  lastReadFile?: string;
  recentFiles: string[];
  operationHistory: Array<{
    operation: string;
    files: string[];
    timestamp: number;
  }>;
  projectName?: string;
  projectType?: string;
  currentModule?: string;
  currentTask?: string;
}

class ContextTracker {
  private sessionPath: string;
  private sessionFile: string;
  private session: SessionContext;

  constructor() {
    const baseDir = join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'context');
    this.sessionPath = join(baseDir, 'session');
    if (!existsSync(this.sessionPath)) {
      mkdirSync(this.sessionPath, { recursive: true });
    }
    this.sessionFile = this.fileFor(process.cwd());
    this.session = this.loadSession(process.cwd());
  }

  private normalizeWorkspace(path: string): string {
    return path.replaceAll('\\', '/').replace(/\/+$/u, '') || '/';
  }

  private fileFor(workingDirectory: string): string {
    const key = createHash('sha256').update(this.normalizeWorkspace(workingDirectory)).digest('hex').slice(0, 20);
    return join(this.sessionPath, `${key}.json`);
  }

  private freshSession(workingDirectory: string): SessionContext {
    return {
      sessionId: randomUUID(), startTime: Date.now(), workingDirectory: this.normalizeWorkspace(workingDirectory),
      recentFiles: [], operationHistory: [],
    };
  }

  private loadSession(workingDirectory: string): SessionContext {
    const normalized = this.normalizeWorkspace(workingDirectory);
    const sessionFile = this.fileFor(normalized);
    this.sessionFile = sessionFile;
    if (existsSync(sessionFile)) {
      try {
        const parsed = JSON.parse(readFileSync(sessionFile, 'utf-8')) as SessionContext;
        if (parsed && this.normalizeWorkspace(parsed.workingDirectory) === normalized
          && Array.isArray(parsed.recentFiles) && Array.isArray(parsed.operationHistory)) return parsed;
      } catch {
        // Corrupted, start fresh
      }
    }
    return this.freshSession(normalized);
  }

  private ensureWorkspace(workingDirectory = process.cwd()) {
    const normalized = this.normalizeWorkspace(workingDirectory);
    if (this.normalizeWorkspace(this.session.workingDirectory) !== normalized) {
      this.session = this.loadSession(normalized);
    }
  }

  private saveSession() {
    const tmp = `${this.sessionFile}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.session, null, 2), { mode: 0o600 });
    renameSync(tmp, this.sessionFile);
  }

  trackFileRead(path: string) {
    this.ensureWorkspace();
    this.session.lastReadFile = path;
    this.addRecentFile(path);
    this.addOperation('read', [path]);
  }

  trackFileWrite(path: string) {
    this.ensureWorkspace();
    this.session.lastModifiedFile = path;
    this.addRecentFile(path);
    this.addOperation('write', [path]);
  }

  trackFileEdit(path: string) {
    this.ensureWorkspace();
    this.session.lastModifiedFile = path;
    this.addRecentFile(path);
    this.addOperation('edit', [path]);
  }

  trackOperation(operation: string, files: string[]) {
    this.ensureWorkspace();
    this.addOperation(operation, files);
  }

  private addRecentFile(path: string) {
    this.session.recentFiles = this.session.recentFiles.filter(f => f !== path);
    this.session.recentFiles.unshift(path);
    this.session.recentFiles = this.session.recentFiles.slice(0, 10);
    this.saveSession();
  }

  private addOperation(operation: string, files: string[]) {
    this.session.operationHistory.push({ operation, files, timestamp: Date.now() });
    if (this.session.operationHistory.length > 50) {
      this.session.operationHistory = this.session.operationHistory.slice(-50);
    }
    this.saveSession();
  }

  resolveReference(ref: string): string | null {
    this.ensureWorkspace();
    const normalized = ref.toLowerCase().trim();
    if (normalized.match(/^(that|the|this)\s+file$/)) {
      return this.session.lastModifiedFile || this.session.lastReadFile || null;
    }
    if (normalized.match(/^(that|the|this)\s+test/)) {
      return this.session.recentFiles.find(f =>
        f.includes('.test.') || f.includes('.spec.') || f.includes('_test.')
      ) || null;
    }
    if (normalized.match(/last\s+file/)) {
      return this.session.lastModifiedFile || this.session.lastReadFile || null;
    }
    return null;
  }

  getContextSummary(): string {
    this.ensureWorkspace();
    const lines: string[] = [];
    if (this.session.recentFiles.length > 0) {
      lines.push('Recent files: ' + this.session.recentFiles.slice(0, 5).join(', '));
    }
    if (this.session.lastModifiedFile) {
      lines.push('Last modified: ' + this.session.lastModifiedFile);
    }
    const recentOps = this.session.operationHistory.slice(-3);
    if (recentOps.length > 0) {
      lines.push('Recent ops: ' + recentOps.map(o => `${o.operation}(${o.files[0] || ''})`).join(', '));
    }
    return lines.join('\n');
  }

  setProjectContext(name: string, type: string, module?: string) {
    this.ensureWorkspace();
    this.session.projectName = name;
    this.session.projectType = type;
    if (module) this.session.currentModule = module;
    this.saveSession();
  }

  updateProjectContext(path: string, _operation: string) {
    this.ensureWorkspace(path);
    this.session.projectName = basename(path);
    this.session.workingDirectory = path;
    this.saveSession();
  }

  // Stubs for project-explainer compatibility (engram caching disabled for now)
  async getCachedProjectAnalysis(_path: string): Promise<any | null> {
    return null;
  }

  async cacheProjectAnalysis(path: string, analysis: any): Promise<void> {
    // Store via engram HTTP if available
    try {
      const { executeEngram } = await import('../tools/engram.js');
      await executeEngram({ action: 'add', body: JSON.stringify({ path, analysis }), tags: ['project-cache'] });
    } catch (_err) {
      // Engram unavailable — skip cache
    }
  }

  setTaskContext(task: string) {
    this.ensureWorkspace();
    this.session.currentTask = task;
    this.saveSession();
  }

  clearTaskContext() {
    this.ensureWorkspace();
    this.session.currentTask = undefined;
    this.saveSession();
  }
}

// Singleton
let tracker: ContextTracker | null = null;

export function getContextTracker(): ContextTracker {
  if (!tracker) {
    tracker = new ContextTracker();
  }
  return tracker;
}

export function resetContextTracker() {
  tracker = null;
}

// Convenience wrappers
export function trackToolCall(toolName: string, input: any, _result: any) {
  const t = getContextTracker();
  if (toolName === 'write' && input.path) t.trackFileWrite(input.path);
  else if (toolName === 'read' && input.path) t.trackFileRead(input.path);
  else if (toolName === 'patch' && input.path) t.trackFileEdit(input.path);
  else t.trackOperation(toolName, [input.path].filter(Boolean));
}

export function getContextSummary(): string {
  return getContextTracker().getContextSummary();
}
