import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';

let currentSpinner: ReturnType<typeof ora> | null = null;

export function streamText(text: string): void {
  if (currentSpinner) {
    currentSpinner.stop();
    currentSpinner = null;
    // Clear the spinner line completely
    process.stdout.write('\r\x1b[K');
  }
  process.stdout.write(chalk.cyan(text));
}

// Alias for streamText
export function stream(text: string): void {
  streamText(text);
}

export function toolStart(name: string, input: any): void {
  if (currentSpinner) {
    currentSpinner.stop();
    currentSpinner = null;
    process.stdout.write('\r\x1b[K');
  }
  // If input is the streaming placeholder, just show tool name
  if (input?._streaming) {
    process.stdout.write('\n' + chalk.dim(`⚡ ${name}...`) + '\n');
    return;
  }
  const summary = summarizeInput(name, input);
  process.stdout.write('\n' + chalk.dim(`⚡ ${name}: ${summary}`) + '\n');
}

// Alias for toolStart
export function tool(name: string, input: any): void {
  toolStart(name, input);
}

export function toolResult(output: string, isError?: boolean): void {
  const maxLines = 30;
  const lines = output.split('\n');
  let display = lines.slice(0, maxLines).join('\n');
  if (lines.length > maxLines) {
    display += `\n... (${lines.length - maxLines} more lines)`;
  }

  const color = isError ? chalk.red : chalk.dim;
  const indented = display.split('\n').map(l => '  ' + l).join('\n');
  process.stdout.write(color(indented) + '\n');
}

// Alias for toolResult
export function result(output: string | any, isError?: boolean): void {
  // Ensure output is a string
  if (typeof output !== 'string') {
    output = JSON.stringify(output, null, 2);
  }
  toolResult(output, isError);
}

// Success message
export function success(msg: string): void {
  process.stdout.write(chalk.green(msg) + '\n');
}

export function newLine() {
  console.log();
}

export function clearLine() {
  process.stdout.write('\r\x1b[K');
}

export function warn(msg: string): void {
  process.stderr.write(chalk.yellow('⚠ ' + msg) + '\n');
}

export function error(msg: string): void {
  process.stderr.write(chalk.red('✗ ' + msg) + '\n');
}

export function info(msg: string): void {
  process.stdout.write(chalk.dim(msg) + '\n');
}

export function dim(msg: string): void {
  process.stdout.write(chalk.gray(msg) + '\n');
}

export function spinner(text?: string): ReturnType<typeof ora> {
  if (currentSpinner) {
    currentSpinner.stop();
  }
  currentSpinner = ora({ text: text || 'Thinking...', color: 'cyan' }).start();
  return currentSpinner;
}

export function stopSpinner(): void {
  if (currentSpinner) {
    currentSpinner.stop();
    currentSpinner = null;
    // Clear the spinner line completely
    process.stdout.write('\r\x1b[K');
  }
}

/** Resolves the user's input, or null when stdin closed without input (EOF/Ctrl+D). */
export function userPrompt(promptText?: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    // Force stdin to stay open
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY,
    });

    let answered = false;

    const question = promptText || chalk.bold.green('\n❯ ');
    
    rl.question(question, (answer: string) => {
      answered = true;
      rl.close();
      resolve(answer);
    });

    rl.on('SIGINT', () => {
      rl.close();
      reject(new Error('SIGINT'));
    });

    // Closed without an answer = stdin EOF (Ctrl+D) — callers must stop
    // re-prompting, otherwise they busy-loop on instantly-closing readlines.
    rl.on('close', () => {
      if (!answered) {
        resolve(null);
      }
    });
  });
}

function summarizeInput(toolName: string, input: any): string {
  switch (toolName) {
    case 'bash':
      return input.command?.slice(0, 80) || '';
    case 'read':
      return input.path || '';
    case 'write':
      return `${input.path} (${input.content?.length || 0} chars)`;
    case 'patch':
      return input.path || '';
    case 'grep':
      return `"${input.pattern}" in ${input.path || '.'}`;
    case 'engram':
      return `${input.action}: ${input.query || input.body?.slice(0, 50) || ''}`;
    case 'delegate':
      return input.task?.slice(0, 60) || '';
    case 'finish':
      return input.result?.slice(0, 60) || '';
    default:
      return JSON.stringify(input).slice(0, 80);
  }
}
