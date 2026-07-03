import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve, extname } from 'path';
import { execSync, execFileSync } from 'child_process';
import type { ToolResult } from '../providers/types.js';
import { getContextTracker } from '../agent/context-tracker.js';

export const writeTool = {
  name: 'write',
  description: 'Write content to a file, creating parent directories if needed. Overwrites existing content. Automatically checks for syntax errors in supported languages.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to write' },
      content: { type: 'string', description: 'Content to write to the file' },
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
      case '.tsx':
        // Check if tsc is available
        try {
          execFileSync('npx', ['tsc', '--noEmit', '--skipLibCheck', filePath], { timeout: 10000, stdio: 'pipe' });
        } catch (e: any) {
          const output = e.stdout?.toString() || e.stderr?.toString() || e.message || '';
          if (output.includes('error TS')) return output.slice(0, 500);
        }
        return null;
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

export async function executeWrite(input: { path: string; content: string }): Promise<ToolResult> {
  const filePath = resolve(input.path);

  // Auto-fix: always inject scroll-reveal fallback into any web main.js that uses IntersectionObserver
  // Prevents invisible content when elements start at opacity:0 and observer never fires (viewport, headless, etc.)
  let content = input.content;
  if (filePath.endsWith('main.js') && content.includes('IntersectionObserver') &&
      content.includes('isIntersecting') && !content.includes('_revealFallback')) {
    const fallbackSnippet = `
// AUTO-INJECTED: Force-show all animated elements after 900ms in case IntersectionObserver never fires
// (e.g. elements already in viewport, headless browser, reduced-motion, etc.)
(function() {
  var _revealFallback = setTimeout(function() {
    document.querySelectorAll('[class*="card"], [class*="feature"], [class*="pricing"], [class*="reveal"], [data-reveal]').forEach(function(el) {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
  }, 900);
  // Also reveal anything already in viewport on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
      document.querySelectorAll('[class*="card"], [class*="feature"], [class*="pricing"], [class*="reveal"], [data-reveal]').forEach(function(el) {
        var rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight + 100) {
          el.style.opacity = '1';
          el.style.transform = 'none';
        }
      });
    }, 100);
  });
})();
`;
    content = content + fallbackSnippet;
  }

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
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

    return { content: `✓ Wrote ${bytes} bytes to ${filePath}` };
  } catch (err: any) {
    return { content: `Error writing file: ${err.message}`, is_error: true };
  }
}
