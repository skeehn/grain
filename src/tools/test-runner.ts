// Test runner integration - auto-run tests, parse output, track results
import { spawn } from 'child_process';
import type { ToolResult } from '../providers/types.js';
import { inspectProject } from '../agent/project.js';

export const testRunnerTool = {
  name: 'run_tests',
  description: 'Run project tests (npm test, pytest, cargo test, etc.). Auto-detects test framework from project files.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Optional: test file pattern or specific test name' },
      framework: { 
        type: 'string', 
        description: 'Optional: force framework (jest, vitest, pytest, cargo, go)',
        enum: ['jest', 'vitest', 'pytest', 'cargo', 'go', 'npm', 'pnpm', 'yarn', 'bun'],
      },
      watch: { type: 'boolean', description: 'Watch mode (not recommended - use for development)', default: false },
      coverage: { type: 'boolean', description: 'Generate coverage report', default: false },
    },
  },
};

interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: string;
  failures: string[];
}

function detectTestFramework(): string | null {
  const inspection = inspectProject(process.cwd());
  const command = inspection.test?.command || '';
  if (command.startsWith('cargo')) return 'cargo';
  if (command.startsWith('go ')) return 'go';
  if (command.includes('pytest')) return 'pytest';
  if (command.includes('vitest')) return 'vitest';
  if (command.includes('jest')) return 'jest';
  if (command.startsWith('bun')) return 'bun';
  if (command.startsWith('pnpm')) return 'pnpm';
  if (command.startsWith('yarn')) return 'yarn';
  if (command.startsWith('npm')) return 'npm';
  if (command.includes('test')) return inspection.kinds.includes('javascript') || inspection.kinds.includes('typescript') ? 'npm' : null;
  return null;
}

function parseTestOutput(output: string, framework: string): TestResult {
  const result: TestResult = {
    passed: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    duration: '',
    failures: [],
  };
  
  if (framework === 'jest' || framework === 'vitest') {
    // Parse Jest/Vitest output
    const passMatch = output.match(/(\d+) passed/);
    const failMatch = output.match(/(\d+) failed/);
    const skipMatch = output.match(/(\d+) skipped/);
    const timeMatch = output.match(/Time:\s+([0-9.]+\s*[a-z]+)/i);
    
    if (passMatch) result.passed = parseInt(passMatch[1]);
    if (failMatch) result.failed = parseInt(failMatch[1]);
    if (skipMatch) result.skipped = parseInt(skipMatch[1]);
    if (timeMatch) result.duration = timeMatch[1];
    
    result.total = result.passed + result.failed + result.skipped;
    
    // Extract failure details
    const failureBlocks = output.match(/FAIL\s+.*?\n[\s\S]*?(?=\n\s*PASS|\n\s*FAIL|$)/g);
    if (failureBlocks) {
      result.failures = failureBlocks.slice(0, 3); // Limit to 3 failures
    }
  } else if (framework === 'pytest') {
    // Parse pytest output
    const summaryMatch = output.match(/(\d+) passed(?:, (\d+) failed)?(?:, (\d+) skipped)?/);
    if (summaryMatch) {
      result.passed = parseInt(summaryMatch[1] || '0');
      result.failed = parseInt(summaryMatch[2] || '0');
      result.skipped = parseInt(summaryMatch[3] || '0');
      result.total = result.passed + result.failed + result.skipped;
    }
    
    const timeMatch = output.match(/in\s+([0-9.]+s)/);
    if (timeMatch) result.duration = timeMatch[1];
  } else if (framework === 'cargo') {
    // Parse cargo test output
    const resultMatch = output.match(/test result:.*?(\d+) passed.*?(\d+) failed/);
    if (resultMatch) {
      result.passed = parseInt(resultMatch[1]);
      result.failed = parseInt(resultMatch[2]);
      result.total = result.passed + result.failed;
    }
  } else if (framework === 'go') {
    result.passed = [...output.matchAll(/^\s*--- PASS:/gm)].length;
    result.failed = [...output.matchAll(/^\s*--- FAIL:/gm)].length;
    result.skipped = [...output.matchAll(/^\s*--- SKIP:/gm)].length;
    result.total = result.passed + result.failed + result.skipped;
    result.failures = [...output.matchAll(/^\s*--- FAIL:.*$/gm)].slice(0, 3).map(match => match[0]);
  }
  
  return result;
}

export async function executeTestRunner(input: {
  pattern?: string;
  framework?: string;
  watch?: boolean;
  coverage?: boolean;
}): Promise<ToolResult> {
  const cwd = process.cwd();

  let framework: string | null;
  try {
    framework = input.framework || detectTestFramework();
  } catch (err: any) {
    return { content: err.message, is_error: true };
  }

  if (!framework) {
    return {
      content: 'Could not detect test framework. Specify manually with framework parameter.',
      is_error: true,
    };
  }
  
  // Build command
  let cmd: string;
  let args: string[];
  
  switch (framework) {
    case 'jest':
      cmd = 'npx';
      args = ['jest'];
      if (input.pattern) args.push(input.pattern);
      if (input.watch) args.push('--watch');
      if (input.coverage) args.push('--coverage');
      break;
      
    case 'vitest':
      cmd = 'npx';
      args = ['vitest', 'run'];
      if (input.pattern) args.push(input.pattern);
      if (input.watch) args = ['vitest']; // watch is default
      if (input.coverage) args.push('--coverage');
      break;
      
    case 'pytest':
      cmd = 'pytest';
      args = [];
      if (input.pattern) args.push(input.pattern);
      if (input.coverage) args.push('--cov');
      break;
      
    case 'cargo':
      cmd = 'cargo';
      args = ['test'];
      if (input.pattern) args.push(input.pattern);
      break;
      
    case 'go':
      cmd = 'go';
      args = ['test', '-v', './...'];
      if (input.pattern) args = ['test', '-v', input.pattern];
      if (input.coverage) args.push('-cover');
      break;

    case 'pnpm':
      cmd = 'pnpm';
      args = ['test'];
      break;

    case 'yarn':
      cmd = 'yarn';
      args = ['test'];
      break;
      
    case 'npm':
      cmd = 'npm';
      args = ['test'];
      break;
      
    case 'bun':
      cmd = 'bun';
      args = ['test'];
      if (input.pattern) args.push(input.pattern);
      break;
      
    default:
      return { content: `Unsupported framework: ${framework}`, is_error: true };
  }
  
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300000, // 5 min timeout
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => (stdout += data.toString()));
    proc.stderr.on('data', (data) => (stderr += data.toString()));
    
    proc.on('close', (code) => {
      const output = stdout + stderr;
      const results = parseTestOutput(output, framework);
      
      let summary = `🧪 Test Results (${framework}):\n\n`;
      
      if (results.total > 0) {
        summary += `✓ Passed: ${results.passed}\n`;
        if (results.failed > 0) summary += `✗ Failed: ${results.failed}\n`;
        if (results.skipped > 0) summary += `⊘ Skipped: ${results.skipped}\n`;
        summary += `━━━━━━━━━━━━━━━━━\n`;
        summary += `Total: ${results.total}\n`;
        if (results.duration) summary += `Duration: ${results.duration}\n`;
        
        if (results.failures.length > 0) {
          summary += `\n❌ Failures:\n`;
          summary += results.failures.join('\n\n');
        }
      } else {
        // Couldn't parse, show raw output (truncated)
        summary += output.split('\n').slice(-30).join('\n');
      }
      
      if (code === 0) {
        resolve({ content: summary });
      } else {
        resolve({ content: summary, is_error: true });
      }
    });
    
    proc.on('error', (err) => {
      resolve({
        content: `Test execution failed: ${err.message}`,
        is_error: true,
      });
    });
  });
}
