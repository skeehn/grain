// Workspace scanner - understand project structure
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';
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
  const maxDepth = input.max_depth || 3;

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

  const ignorePatterns = [
    'node_modules',
    '.git',
    'dist',
    'build',
    'target',
    '.next',
    'coverage',
    '__pycache__',
    '.venv',
    'venv',
  ];

  function scanDir(dirPath: string, depth: number) {
    if (depth > maxDepth) return;

    let entries: string[];
    try {
      entries = readdirSync(dirPath);
    } catch (err) {
      // Ignore permission errors on the directory itself
      return;
    }

    for (const entry of entries) {
      if (ignorePatterns.includes(entry)) continue;

      const fullPath = join(dirPath, entry);
      const relativePath = relative(rootPath, fullPath);

      let stat;
      try {
        stat = statSync(fullPath);
      } catch (err) {
        // Skip unreadable entries (broken symlinks, permission errors) but keep scanning
        continue;
      }

      if (stat.isDirectory()) {
        result.stats.totalDirs++;
        result.structure.push(`${'  '.repeat(depth)}📁 ${entry}/`);
        scanDir(fullPath, depth + 1);
      } else {
        result.stats.totalFiles++;
        result.structure.push(`${'  '.repeat(depth)}📄 ${entry}`);

        // Track extensions
        const ext = entry.split('.').pop() || '';
        result.stats.filesByExt[ext] = (result.stats.filesByExt[ext] || 0) + 1;

        // Detect key files
        const lower = entry.toLowerCase();
        if (lower === 'package.json') result.keyFiles.package = relativePath;
        if (lower.startsWith('readme')) result.keyFiles.readme = relativePath;
        if (lower.includes('config') || lower.includes('.json') || lower.includes('.yaml')) {
          result.keyFiles.config = result.keyFiles.config || [];
          result.keyFiles.config.push(relativePath);
        }
        if (lower.includes('test') || lower.includes('spec')) {
          result.keyFiles.tests = result.keyFiles.tests || [];
          result.keyFiles.tests.push(relativePath);
        }
      }
    }
  }

  scanDir(rootPath, 0);

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
  if (result.structure.length > 50) {
    output += `\n... (${result.structure.length - 50} more items)`;
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
