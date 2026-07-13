// Workspace scanner - understand project structure
import { statSync } from 'fs';
import { relative } from 'path';
import { getWorkspaceFS } from '../workspace/index.js';

export const workspaceScanTool = {
  name: 'workspace_scan',
  description: 'Scan the workspace to understand project structure, find key files (package.json, README, etc.), detect languages, and map the codebase',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Root path to scan (default: current directory)', default: '.' },
      max_depth: { type: 'number', description: 'Maximum directory depth to scan', default: 3 },
    },
  },
};

interface ScanResult {
  root: string;
  languages: string[];
  structure: string[];
  keyFiles: {
    package?: string;
    readme?: string;
    config?: string[];
    tests?: string[];
  };
  stats: {
    totalFiles: number;
    totalDirs: number;
    filesByExt: Record<string, number>;
  };
}

export async function executeWorkspaceScan(input: { path?: string; max_depth?: number }): Promise<{ content: string }> {
  let rootPath: string;
  try { rootPath = getWorkspaceFS().resolve(input.path || '.', true); }
  catch (error: any) { return { content: `Workspace scan failed: ${error.message}` }; }
  const maxDepth = Math.min(5, Math.max(1, input.max_depth || 3));

  const result: ScanResult = {
    root: rootPath,
    languages: [],
    structure: [],
    keyFiles: {},
    stats: {
      totalFiles: 0,
      totalDirs: 0,
      filesByExt: {},
    },
  };

  // LocalWorkspaceFS.list applies .gitignore/.grainignore and skips dependency,
  // build, binary, and symlink trees. It also keeps this tool aligned with read/search.
  const files = getWorkspaceFS().list(input.path || '.', maxDepth);
  const maxFiles = 5000;
  const visibleFiles = files.slice(0, maxFiles);
  const directories = new Set<string>();
  for (const relativePath of visibleFiles) {
    const fullPath = getWorkspaceFS().resolve(relativePath, true);
    let stat;
    try { stat = statSync(fullPath); } catch { continue; }
    if (!stat.isFile()) continue;
    result.stats.totalFiles++;
    const parts = relativePath.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
    result.structure.push(`${'  '.repeat(Math.max(0, parts.length - 1))}📄 ${relativePath}`);
    const ext = parts.at(-1)?.split('.').pop() || '';
    result.stats.filesByExt[ext] = (result.stats.filesByExt[ext] || 0) + 1;
    const lower = parts.at(-1)?.toLowerCase() || '';
    if (parts.length === 1 && lower === 'package.json') result.keyFiles.package = relativePath;
    if (lower.startsWith('readme') && !result.keyFiles.readme) result.keyFiles.readme = relativePath;
    if (lower.includes('config') || lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml')) {
      result.keyFiles.config = result.keyFiles.config || [];
      if (result.keyFiles.config.length < 20) result.keyFiles.config.push(relativePath);
    }
    if (lower.includes('test') || lower.includes('spec')) {
      result.keyFiles.tests = result.keyFiles.tests || [];
      result.keyFiles.tests.push(relativePath);
    }
  }
  result.stats.totalDirs = directories.size;

  // Detect languages from extensions
  const langMap: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript',
    js: 'JavaScript',
    jsx: 'JavaScript',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    java: 'Java',
    cpp: 'C++',
    c: 'C',
    rb: 'Ruby',
    php: 'PHP',
  };

  const detectedLangs = new Set<string>();
  for (const [ext, count] of Object.entries(result.stats.filesByExt)) {
    if (langMap[ext]) detectedLangs.add(langMap[ext]);
  }
  result.languages = Array.from(detectedLangs);

  // Format output
  let output = `📊 Workspace Scan: ${result.root}\n\n`;
  output += `Languages: ${result.languages.join(', ') || 'Unknown'}\n`;
  output += `Files: ${result.stats.totalFiles} | Directories: ${result.stats.totalDirs}\n\n`;

  if (result.keyFiles.package) {
    output += `📦 Package: ${result.keyFiles.package}\n`;
  }
  if (result.keyFiles.readme) {
    output += `📖 README: ${result.keyFiles.readme}\n`;
  }
  if (result.keyFiles.config && result.keyFiles.config.length > 0) {
    output += `⚙️  Config files: ${result.keyFiles.config.slice(0, 5).join(', ')}\n`;
  }
  if (result.keyFiles.tests && result.keyFiles.tests.length > 0) {
    output += `🧪 Test files: ${result.keyFiles.tests.length}\n`;
  }

  output += `\n📂 Structure (top ${maxDepth} levels):\n`;
  output += result.structure.slice(0, 50).join('\n');
  if (files.length > 50) {
    output += `\n... (${files.length > maxFiles ? `${files.length - maxFiles} skipped by safety cap; ` : ''}${Math.max(0, files.length - 50)} more items)`;
  }

  output += `\n\n📈 File types:\n`;
  const sortedExts = Object.entries(result.stats.filesByExt)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [ext, count] of sortedExts) {
    output += `  .${ext}: ${count}\n`;
  }

  return { content: output };
}
