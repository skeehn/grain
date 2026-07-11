export type ColorCapability = 'none' | 'ansi16' | 'ansi256' | 'truecolor';

export interface TerminalCapabilities {
  columns: number;
  rows: number;
  color: ColorCapability;
  unicode: boolean;
  mouse: boolean;
  reducedMotion: boolean;
}

export interface CellStyle {
  foreground?: string;
  background?: string;
  bold?: boolean;
  dim?: boolean;
}

export interface Cell { grapheme: string; width: number; style: CellStyle; }
export interface TuiCursor { row: number; column: number; visible: boolean; }
export interface TuiFrame { width: number; height: number; cells: Cell[]; cursor?: TuiCursor; }

export interface RunSummary { id: string; status: string; provider: string; model: string; task: string; elapsedMs: number; }
export interface TimelineItem { sequence: number; kind: string; label: string; detail?: string; status?: string; }
export interface WorkspaceActivity { path: string; operation: string; status: string; }
export interface AgentSummary { id: string; role: string; state: string; objective: string; }
export interface ApprovalSummary { id: string; tool: string; risk: string; decision?: string; }
export interface ContextSummary { usedTokens: number; budgetTokens: number; sources: number; }
export interface DiagnosticSummary { passed: number; failed: number; pending: number; }

export interface TuiViewModel {
  run: RunSummary;
  timeline: TimelineItem[];
  workspace: WorkspaceActivity[];
  agents: AgentSummary[];
  approvals: ApprovalSummary[];
  context: ContextSummary;
  diagnostics: DiagnosticSummary;
}
