// Tree-sitter repo map - generates structured overview of a codebase
// Falls back to regex-based parsing when tree-sitter native bindings aren't available
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import type { ToolResult } from '../providers/types.js';

export const repoMapTool = {
  name: 'repo_map',
  description: 'Generate a structured map of a codebase showing files, exports, functions, classes, and their relationships. Essential for understanding large projects before making changes.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Root directory to map (default: cwd)' },
      depth: { type: 'number', description: 'Max directory depth (default: 4)' },
      focus: { type: 'string', description: 'Focus on files matching this pattern (e.g. "*.rs", "src/**")' },
    },
    required: [],
  },
};

interface FileInfo {
  path: string;
  language: string;
  exports: string[];
  imports: string[];
  functions: string[];
  classes: string[];
  types: string[];
  lines: number;
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'target', 'dist', 'build', '.next',
  '__pycache__', '.venv', 'venv', '.cargo', 'vendor', 'coverage',
]);

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.rs': 'rust', '.py': 'python', '.go': 'go', '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.hpp': 'cpp', '.java': 'java', '.rb': 'ruby',
};

function walkDir(dir: string, maxDepth: number, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const files: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      if (IGNORE_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkDir(fullPath, maxDepth, depth + 1));
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (LANG_MAP[ext]) files.push(fullPath);
      }
    }
  } catch {}

  return files;
}

// Regex-based parsing (works without native deps)
function parseFile(filePath: string): FileInfo {
  const ext = extname(filePath);
  const language = LANG_MAP[ext] || 'unknown';
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').length;

  const exports: string[] = [];
  const imports: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];
  const types: string[] = [];

  const fileLines = content.split('\n');

  for (const line of fileLines) {
    switch (language) {
      case 'typescript':
      case 'javascript':
        // Exports
        const expMatch = line.match(/^export\s+(default\s+)?(function|class|const|let|type|interface|enum)\s+(\w+)/);
        if (expMatch) exports.push(`${expMatch[2]} ${expMatch[3]}`);

        // Imports
        const impMatch = line.match(/^import\s+.*from\s+['"]([^'"]+)['"]/);
        if (impMatch) imports.push(impMatch[1]);

        // Functions (non-exported)
        const fnMatch = line.match(/^(?:async\s+)?function\s+(\w+)/);
        if (fnMatch && !line.includes('export')) functions.push(fnMatch[1]);

        // Types/Interfaces
        const typeMatch = line.match(/^(?:export\s+)?(?:type|interface)\s+(\w+)/);
        if (typeMatch) types.push(typeMatch[1]);

        // Classes
        const classMatch = line.match(/^(?:export\s+)?class\s+(\w+)/);
        if (classMatch) classes.push(classMatch[1]);
        break;

      case 'rust':
        const rustFn = line.match(/^pub(?:\(crate\))?\s+(?:async\s+)?fn\s+(\w+)/);
        if (rustFn) exports.push(`fn ${rustFn[1]}`);
        const rustStruct = line.match(/^pub\s+struct\s+(\w+)/);
        if (rustStruct) types.push(`struct ${rustStruct[1]}`);
        const rustEnum = line.match(/^pub\s+enum\s+(\w+)/);
        if (rustEnum) types.push(`enum ${rustEnum[1]}`);
        const rustTrait = line.match(/^pub\s+trait\s+(\w+)/);
        if (rustTrait) types.push(`trait ${rustTrait[1]}`);
        const rustImpl = line.match(/^impl(?:<[^>]+>)?\s+(\w+)/);
        if (rustImpl) classes.push(`impl ${rustImpl[1]}`);
        const rustUse = line.match(/^use\s+([^;]+)/);
        if (rustUse) imports.push(rustUse[1].trim());
        break;

      case 'python':
        const pyDef = line.match(/^def\s+(\w+)/);
        if (pyDef) functions.push(pyDef[1]);
        const pyClass = line.match(/^class\s+(\w+)/);
        if (pyClass) classes.push(pyClass[1]);
        const pyImport = line.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)/);
        if (pyImport) imports.push(pyImport[1] || pyImport[2]);
        break;

      case 'go':
        const goFn = line.match(/^func\s+(?:\([^)]+\)\s+)?(\w+)/);
        if (goFn) functions.push(goFn[1]);
        const goType = line.match(/^type\s+(\w+)\s+(struct|interface)/);
        if (goType) types.push(`${goType[2]} ${goType[1]}`);
        break;
    }
  }

  return { path: filePath, language, exports, imports, functions, classes, types, lines };
}

export async function executeRepoMap(input: { path?: string; depth?: number; focus?: string }): Promise<ToolResult> {
  const rootDir = input.path || process.cwd();
  const maxDepth = input.depth || 4;

  try {
    let files = walkDir(rootDir, maxDepth);

    // Apply focus filter (glob-ish: ** matches across dirs, * within a segment)
    if (input.focus) {
      let regex: RegExp;
      try {
        const escaped = input.focus.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        const pattern = escaped
          .replace(/\*\*/g, '\u0000')   // placeholder so single-* pass doesn't touch it
          .replace(/\*/g, '[^/]*')
          .replace(/\u0000/g, '.*');
        regex = new RegExp(pattern);
      } catch (err: any) {
        return {
          content: `Invalid focus pattern "${input.focus}": ${err.message}`,
          is_error: true,
        };
      }
      files = files.filter(f => regex.test(relative(rootDir, f)));
    }

    if (files.length === 0) {
      return { content: `No source files found in ${rootDir}` };
    }

    // Limit to prevent overwhelming context
    if (files.length > 200) {
      files = files.slice(0, 200);
    }

    const parsed = files.map(f => parseFile(f));

    // Build summary
    let output = `## Repository Map: ${rootDir}\n`;
    output += `Files: ${parsed.length} | Languages: ${[...new Set(parsed.map(f => f.language))].join(', ')}\n`;
    output += `Total lines: ${parsed.reduce((s, f) => s + f.lines, 0).toLocaleString()}\n\n`;

    // Group by directory
    const byDir = new Map<string, FileInfo[]>();
    for (const file of parsed) {
      const rel = relative(rootDir, file.path);
      const dir = rel.split('/').slice(0, -1).join('/') || '.';
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir)!.push(file);
    }

    for (const [dir, dirFiles] of [...byDir.entries()].sort()) {
      output += `### ${dir}/\n`;
      for (const file of dirFiles) {
        const name = relative(rootDir, file.path);
        const symbols = [
          ...file.exports.map(e => `+${e}`),
          ...file.types.map(t => `T:${t}`),
          ...file.classes.map(c => `C:${c}`),
        ].slice(0, 8);

        output += `  ${name} (${file.lines}L)`;
        if (symbols.length > 0) output += ` [${symbols.join(', ')}]`;
        output += '\n';
      }
      output += '\n';
    }

    // Key relationships (imports between local files)
    output += `### Key Imports\n`;
    const localImports = parsed
      .filter(f => f.imports.some(i => i.startsWith('.') || i.startsWith('~')))
      .slice(0, 20);
    for (const file of localImports) {
      const localDeps = file.imports.filter(i => i.startsWith('.') || i.startsWith('~')).slice(0, 5);
      if (localDeps.length > 0) {
        output += `  ${relative(rootDir, file.path)} → ${localDeps.join(', ')}\n`;
      }
    }

    return { content: output };
  } catch (err: any) {
    return { content: `Error mapping repo: ${err.message}`, is_error: true };
  }
}
