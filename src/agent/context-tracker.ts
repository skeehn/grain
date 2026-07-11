// Context Tracker - Session file/operation tracking
// Lightweight, synchronous, no engram dependency for core tracking
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

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
  private session: SessionContext;

  constructor() {
    const baseDir = join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'context');
    this.sessionPath = join(baseDir, 'session');
    if (!existsSync(this.sessionPath)) {
      mkdirSync(this.sessionPath, { recursive: true });
    }
    this.session = this.loadSession();
  }

  private loadSession(): SessionContext {
    const sessionFile = join(this.sessionPath, 'current.json');
    if (existsSync(sessionFile)) {
      try {
        return JSON.parse(readFileSync(sessionFile, 'utf-8'));
      } catch {
        // Corrupted, start fresh
      }
    }
    return {
      sessionId: Date.now().toString(),
      startTime: Date.now(),
      workingDirectory: process.cwd(),
      recentFiles: [],
      operationHistory: [],
    };
  }

  private saveSession() {
    const sessionFile = join(this.sessionPath, 'current.json');
    writeFileSync(sessionFile, JSON.stringify(this.session, null, 2));
  }

  trackFileRead(path: string) {
    this.session.lastReadFile = path;
    this.addRecentFile(path);
    this.addOperation('read', [path]);
  }

  trackFileWrite(path: string) {
    this.session.lastModifiedFile = path;
    this.addRecentFile(path);
    this.addOperation('write', [path]);
  }

  trackFileEdit(path: string) {
    this.session.lastModifiedFile = path;
    this.addRecentFile(path);
    this.addOperation('edit', [path]);
  }

  trackOperation(operation: string, files: string[]) {
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
    this.session.projectName = name;
    this.session.projectType = type;
    if (module) this.session.currentModule = module;
    this.saveSession();
  }

  updateProjectContext(path: string, _operation: string) {
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
    this.session.currentTask = task;
    this.saveSession();
  }

  clearTaskContext() {
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
