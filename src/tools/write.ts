import { extname } from 'path';
import { execSync, execFileSync } from 'child_process';
import type { ToolResult } from '../providers/types.js';
import { getContextTracker } from '../agent/context-tracker.js';
import { getWorkspaceFS } from '../workspace/index.js';

export const writeTool = {
  name: 'write',
  description: 'Write content to a file, creating parent directories if needed. Overwrites existing content. Automatically checks for syntax errors in supported languages.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to write' },
      content: { type: 'string', description: 'Content to write to the file' },
      expected_hash: { type: 'string', description: 'Optional sha256 from read; write fails if the file changed' },
    },
    required: ['path', 'content'],
  },
};

// Quick syntax check after writing
function syntaxCheck(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  try {
    switch (ext) {
      case '.json':
        JSON.parse(require('fs').readFileSync(filePath, 'utf-8'));
        return null;
      case '.py':
        execFileSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', filePath], { timeout: 5000 });
        return null;
      case '.ts':
      case '.tsx': {
        // A single-file tsc ignores the project's tsconfig, so type errors,
        // JSX-factory settings (TS17xxx), and path-alias resolution (TS2307)
        // would produce false positives. Only surface genuine *syntax* errors
        // — TS parser codes are in the 1000–1999 range — which is all this
        // "syntax check" claims to catch and which don't depend on config.
        try {
          execFileSync('npx', ['tsc', '--noEmit', '--skipLibCheck', filePath], { timeout: 10000, stdio: 'pipe' });
        } catch (e: any) {
          const output = e.stdout?.toString() || e.stderr?.toString() || e.message || '';
          const syntaxErrors = output
            .split('\n')
            .filter((l: string) => /error TS1\d{3}:/.test(l));
          if (syntaxErrors.length > 0) return syntaxErrors.join('\n').slice(0, 500);
        }
        return null;
      }
      case '.js':
      case '.jsx':
      case '.mjs':
        execSync(`node --check "${filePath}"`, { timeout: 5000 });
        return null;
      case '.rs':
        // Just check syntax, not full compilation
        try {
          execSync(`rustfmt --check "${filePath}" 2>&1`, { timeout: 5000 });
        } catch { /* rustfmt not critical */ }
        return null;
      default:
        return null;
    }
  } catch (e: any) {
    const msg = e.stdout?.toString() || e.stderr?.toString() || e.message;
    return msg.slice(0, 500);
  }
}

export async function executeWrite(input: { path: string; content: string; expected_hash?: string }): Promise<ToolResult> {
  try {
    const workspace = getWorkspaceFS();
    const written = workspace.writeAtomic(input.path, input.content, input.expected_hash);
    const filePath = workspace.resolve(input.path, true);
    const bytes = Buffer.byteLength(input.content);

    // Track file write
    const tracker = getContextTracker();
    tracker.trackFileWrite(filePath);

    // Auto syntax check
    const error = syntaxCheck(filePath);
    if (error) {
      return {
        content: `Wrote ${bytes} bytes to ${filePath}\n\n⚠️ SYNTAX ERROR DETECTED:\n${error}\n\nPlease fix the error and write the file again.`,
        is_error: false, // Not a tool error, but signals to LLM to fix
      };
    }

    return { content: `✓ Wrote ${bytes} bytes to ${filePath}\nsha256:${written.content_hash}` };
  } catch (err: any) {
    return { content: `Error writing file: ${err.message}`, is_error: true };
  }
}
