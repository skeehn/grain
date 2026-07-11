export interface FileSnapshot {
  path: string;
  existed: boolean;
  content_hash?: string;
  mode?: number;
  size?: number;
  line_ending?: 'lf' | 'crlf';
  final_newline?: boolean;
  binary?: boolean;
}

export interface ReadRangeResult {
  path: string;
  content: string;
  start_line: number;
  end_line: number;
  total_lines: number;
  hash: string;
}

export interface SearchMatch { path: string; line: number; text: string }

export interface WorkspaceFS {
  readonly root: string;
  resolve(path: string, mustExist?: boolean): string;
  stat(path: string): FileSnapshot;
  list(path?: string, maxDepth?: number): string[];
  readRange(path: string, offset?: number, limit?: number): ReadRangeResult;
  search(pattern: string, path?: string, limit?: number): SearchMatch[];
  snapshot(path: string): FileSnapshot;
  writeAtomic(path: string, content: string, expectedHash?: string): FileSnapshot;
  applyPatch(path: string, oldText: string, newText: string, expectedHash?: string): FileSnapshot;
  move(from: string, to: string): void;
  mkdir(path: string): void;
  remove(path: string): void;
}
