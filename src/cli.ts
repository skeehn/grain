#!/usr/bin/env node
import { orchestrate } from './agent/orchestrator.js';
import {
  loadConfig, saveConfig, getConfigDir, validateConfig,
  loadGrainEnv, saveKeyToEnv, listEnvKeys, GRAIN_VERSION, VALID_PROVIDERS,
} from './config.js';
import * as renderer from './tui/renderer.js';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import * as readline from 'readline';
import { spawn, execSync } from 'child_process';
import { handleConfigShow } from './commands/config.js';
import { discoverPlugins } from './plugins/discovery.js';
import { handleWikiCommand } from './commands/wiki.js';
import { handleRunsCommand } from './commands/runs.js';
import { handleLearningCommand } from './commands/learning.js';
import { handleAgentsCommand } from './commands/agents.js';
import { runTui } from './tui/app.js';
import type { GrainThemeName } from './tui/theme.js';
import { handleLabCommand } from './commands/lab.js';

// ─── Load ~/.grain/.env before anything else ──────────────────────────────────

// ─── ANSI helpers (no chalk import needed in cli.ts) ─────────────────────────
const ansi = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  reset:  ansi ? '\x1b[0m' : '',
  bold:   ansi ? '\x1b[1m' : '',
  dim:    ansi ? '\x1b[2m' : '',
  cyan:   ansi ? '\x1b[36m' : '',
  green:  ansi ? '\x1b[32m' : '',
  red:    ansi ? '\x1b[31m' : '',
  yellow: ansi ? '\x1b[33m' : '',
  blue:   ansi ? '\x1b[34m' : '',
  white:  ansi ? '\x1b[37m' : '',
};
const ok   = `${c.green}✓${c.reset}`;
const warn = `${c.yellow}!${c.reset}`;
const err  = `${c.red}✗${c.reset}`;
const dim  = (s: string) => `${c.dim}${s}${c.reset}`;
const bold = (s: string) => `${c.bold}${s}${c.reset}`;

// ─── Arg parser ───────────────────────────────────────────────────────────────

interface ParsedArgs {
  command?: 'init' | 'update' | 'config' | 'status' | 'serve' | 'help' | 'version' | 'skills' | 'engram' | 'wiki' | 'runs' | 'learning' | 'agents' | 'tui' | 'lab';
  configSubcmd?: 'set' | 'reset' | 'show';
  configKey?: string;
  configValue?: string;
  skillsSubcmd?: 'list' | 'view' | 'add' | 'delete';
  skillsName?: string;
  engramSubcmd?: 'stats' | 'search' | 'list' | 'add';
  engramArg?: string;
  prompt?: string;
  printMode: boolean;
  autoApprove: boolean;
  concise: boolean;
  model?: string;
  provider?: string;
  maxTurns?: number;
  tbBridge: boolean;  // TerminalBench bridge mode
  reflect: boolean;   // post-task self-reflection + engram store
  allowDestructive: boolean;
  classic: boolean;
  noAltScreen: boolean;
  theme?: GrainThemeName;
  density?: 'compact' | 'comfortable';
  attachments: string[];
  utilitySubcmd?: string;
  utilityArg?: string;
  utilityOutput?: string;
  unknownFlags?: string[]; // dash-tokens before any prompt text that match no known flag
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = { autoApprove: false, concise: false, tbBridge: false, reflect: false, allowDestructive: false, classic: false, noAltScreen: false, printMode: false, attachments: [] };
  const promptParts: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    // Commands are only recognized before any positional prompt text —
    // once prompt words start, bare words like "config" belong to the prompt.
    if (promptParts.length === 0 && !result.prompt) {
      if (arg === 'init')                                   { result.command = 'init'; break; }
      if (arg === 'update')                                 { result.command = 'update'; break; }
      if (arg === 'status')                                 { result.command = 'status'; break; }
      if (arg === 'serve')                                  { result.command = 'serve'; break; }
      if (arg === 'tui') {
        result.command = 'tui';
        const subcommand = args[i + 1];
        if (subcommand === '--run' || subcommand === '--resume') {
          result.utilitySubcmd = subcommand; result.utilityArg = args[i + 2]; i += 3;
        } else i += 1;
        continue;
      }
      if (arg === 'lab') {
        result.command = 'lab';
        if (args[i + 1] === '--run') {
          if (!args[i + 2]) throw new Error('Usage: grain lab --run <run-id>');
          result.utilityArg = args[i + 2];
        }
        break;
      }
      if (arg === '--help' || arg === '-h' || arg === 'help') { result.command = 'help'; break; }
      if (arg === '--version' || arg === '-v' || arg === 'version') { result.command = 'version'; break; }

      if (arg === 'config') {
        result.command = 'config';
        const sub = args[i + 1];
        if (sub === 'set') {
          result.configSubcmd = 'set';
          result.configKey    = args[i + 2];
          result.configValue  = args[i + 3];
        } else if (sub === 'reset') {
          result.configSubcmd = 'reset';
        } else {
          result.configSubcmd = 'show';
        }
        break;
      }

      if (arg === 'skills') {
        result.command = 'skills';
        const sub = args[i + 1];
        if (sub === 'view' || sub === 'delete') {
          result.skillsSubcmd = sub;
          result.skillsName = args[i + 2];
        } else if (sub === 'add') {
          result.skillsSubcmd = 'add';
          result.skillsName = args[i + 2];
        } else {
          result.skillsSubcmd = 'list';
        }
        break;
      }

      if (arg === 'engram') {
        result.command = 'engram';
        const sub = args[i + 1];
        if (sub === 'search') {
          result.engramSubcmd = 'search';
          result.engramArg = args[i + 2];
        } else if (sub === 'list') {
          result.engramSubcmd = 'list';
        } else if (sub === 'add') {
          result.engramSubcmd = 'add';
          result.engramArg = args.slice(i + 2).join(' ');
        } else {
          result.engramSubcmd = 'stats';
        }
        break;
      }
      if (arg === 'wiki' || arg === 'runs' || arg === 'learning' || arg === 'agents') {
        result.command = arg;
        result.utilitySubcmd = args[i + 1];
        result.utilityArg = args[i + 2];
        result.utilityOutput = args[i + 3];
        break;
      }
    }

    if (arg === '-p' || arg === '--prompt')         { result.prompt = args[++i]; result.printMode = true; }
    else if (arg === '-y' || arg === '--yes')        { result.autoApprove = true; }
    else if (arg === '--concise' || arg === '-c')    { result.concise = true; }
    else if (arg === '--model')                      { result.model = args[++i]; }
    else if (arg === '--provider')                   { result.provider = args[++i]; }
    else if (arg === '--max-turns')                  { result.maxTurns = parseInt(args[++i], 10); }
    else if (arg === '--tb-bridge')                  { result.tbBridge = true; }
    else if (arg === '--reflect')                    { result.reflect = true; }
    else if (arg === '--allow-destructive')          { result.allowDestructive = true; }
    else if (arg === '--classic')                    { result.classic = true; }
    else if (arg === '--no-alt-screen')              { result.noAltScreen = true; }
    else if (arg === '--theme')                      { result.theme = args[++i] as ParsedArgs['theme']; }
    else if (arg === '--density')                    { result.density = args[++i] as ParsedArgs['density']; }
    else if (arg === '--attach') {
      const path = args[++i];
      if (!path || path.startsWith('-')) throw new Error('Missing path for --attach');
      result.attachments.push(path);
    }
    else if (arg === '--') {
      // Explicit terminator: everything after it is prompt text verbatim.
      promptParts.push(...args.slice(i + 1));
      break;
    }
    else if (!arg.startsWith('-')) {
      // Positional prompt word. Keep parsing: later flags are still honored.
      if (!result.prompt) promptParts.push(arg);
    }
    else if (promptParts.length > 0) {
      // Dash-token after prompt text began is a prompt word, not a flag
      // ("fix the --dry-run handling", "what is 5 - 3") — never drop it.
      promptParts.push(arg);
    }
    else {
      // Unknown flag before any prompt text — record it so main() can reject
      // loudly instead of silently ignoring a typo like --ys.
      (result.unknownFlags ??= []).push(arg);
    }
    i++;
  }

  if (!result.prompt && promptParts.length > 0) {
    result.prompt = promptParts.join(' ');
  }
  return result;
}

// ─── Interactive prompt helper ────────────────────────────────────────────────

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ─── Engram: silent background auto-start ────────────────────────────────────
// Checks :7474 with a 200ms timeout. If dead and engram binary exists,
// spawns it detached. grain never waits — continues immediately.

export async function ensureEngramRunning(): Promise<void> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 200);
    const res = await fetch('http://localhost:7474/health', { signal: ctrl.signal });
    clearTimeout(tid);
    if (res.ok) return; // already running
  } catch { /* not running */ }

  const bin = join(homedir(), 'bin', 'engram');
  if (!existsSync(bin)) return; // not installed — silent skip

  const db = join(homedir(), '.engram', 'knowledge');
  const child = spawn(bin, ['-d', db, 'serve', '--port', '7474'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref(); // grain doesn't wait for it
}

// ─── grain update ─────────────────────────────────────────────────────────────

async function handleUpdate(): Promise<void> {
  console.log(`\n${bold('grain update')}\n`);
  console.log(`Current version: ${c.cyan}v${GRAIN_VERSION}${c.reset}`);
  process.stdout.write('Checking for updates... ');

  try {
    const res = await fetch('https://api.github.com/repos/skeehn/grain/releases/latest', {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': `grain/${GRAIN_VERSION}` },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const release: any = await res.json();
    const latest = release.tag_name?.replace(/^v/, '') ?? '';

    if (!latest) throw new Error('Could not parse release version');

    if (latest === GRAIN_VERSION) {
      console.log(`${ok} Already up to date (v${GRAIN_VERSION})\n`);
      return;
    }

    console.log(`${ok} New version available: ${c.green}v${latest}${c.reset}\n`);

    // Find asset for this platform
    const plat = platform(); // darwin | linux | win32
    const arch = process.arch; // arm64 | x64
    const assetName = `grain-${plat}-${arch}`;
    const asset = release.assets?.find((a: any) => a.name === assetName || a.name === `${assetName}.js`);

    if (!asset) {
      // No binary asset — fall back to npm / manual
      console.log(`No pre-built binary for ${plat}-${arch}.`);
      console.log(`Install manually:\n`);
      console.log(`  ${c.cyan}curl -fsSL https://raw.githubusercontent.com/skeehn/grain/main/install.sh | sh${c.reset}\n`);
      return;
    }

    const confirm = await ask(`Update to v${latest}? [Y/n] `);
    if (confirm.toLowerCase() === 'n') { console.log('Cancelled.\n'); return; }

    process.stdout.write('Downloading... ');
    const binRes = await fetch(asset.browser_download_url);
    if (!binRes.ok) throw new Error(`Download failed: ${binRes.status}`);
    const buf = await binRes.arrayBuffer();

    // Replace current binary
    const currentBin = process.execPath === process.argv[1]
      ? process.argv[1]                         // running as binary
      : join(homedir(), 'bin', 'grain');        // symlinked install

    writeFileSync(currentBin, Buffer.from(buf), { mode: 0o755 });
    console.log(`${ok} Updated to v${latest}\n`);
    console.log(`Restart grain to use the new version.\n`);
  } catch (e: any) {
    console.log(`${err} Update check failed: ${e.message}`);
    console.log(`\nUpdate manually:\n  ${c.cyan}curl -fsSL https://raw.githubusercontent.com/skeehn/grain/main/install.sh | sh${c.reset}\n`);
  }
}

// ─── grain config ─────────────────────────────────────────────────────────────

async function handleConfig(sub?: string, key?: string, value?: string): Promise<void> {
  if (!sub || sub === 'show') {
    await handleConfigShow();
    return;
  }

  const config = loadConfig();

  if (sub === 'reset') {
    saveConfig({
      provider:   'bedrock',
      model:      null,
      engram_db:  '~/.engram/knowledge',
      max_tokens: 180000,
    });
    console.log(`${ok} Config reset to defaults.\n`);
    return;
  }

  if (sub === 'set') {
    if (!key) {
      console.error(`Usage: grain config set <key> <value>\n`);
      console.error(`Keys: provider  model  key  engram_db  max_tokens\n`);
      process.exit(1);
    }

    // Special: grain config set key ANTHROPIC_API_KEY sk-...
    if (key === 'key') {
      const envKeyName  = value;
      const envKeyValue = process.argv[process.argv.length - 1]; // last arg
      if (!envKeyName || !envKeyValue || envKeyName === envKeyValue) {
        console.error(`Usage: grain config set key <KEY_NAME> <value>`);
        console.error(`  e.g. grain config set key ANTHROPIC_API_KEY sk-ant-...`);
        process.exit(1);
      }
      saveKeyToEnv(envKeyName, envKeyValue);
      const masked = envKeyValue.slice(0, 8) + '...' + envKeyValue.slice(-4);
      console.log(`${ok} Saved ${c.cyan}${envKeyName}${c.reset} = ${dim(masked)} to ~/.grain/.env\n`);
      return;
    }

    if (key === 'provider') {
      if (!value || !VALID_PROVIDERS.includes(value as any)) {
        console.error(`Invalid provider "${value}". Valid: ${VALID_PROVIDERS.join(', ')}`);
        process.exit(1);
      }
      saveConfig({ provider: value });
      console.log(`${ok} provider = ${c.cyan}${value}${c.reset}\n`);
      return;
    }

    if (key === 'model') {
      saveConfig({ model: value ?? null });
      console.log(`${ok} model = ${c.cyan}${value ?? 'auto'}${c.reset}\n`);
      return;
    }

    if (key === 'engram_db') {
      if (!value) { console.error('Usage: grain config set engram_db <path>'); process.exit(1); }
      saveConfig({ engram_db: value });
      console.log(`${ok} engram_db = ${c.cyan}${value}${c.reset}\n`);
      return;
    }

    if (key === 'max_tokens') {
      const n = parseInt(value ?? '', 10);
      if (isNaN(n)) { console.error('max_tokens must be a number'); process.exit(1); }
      saveConfig({ max_tokens: n });
      console.log(`${ok} max_tokens = ${c.cyan}${n}${c.reset}\n`);
      return;
    }

    console.error(`Unknown key "${key}". Valid: provider  model  key  engram_db  max_tokens`);
    process.exit(1);
  }
}

// ─── grain status ─────────────────────────────────────────────────────────────

async function handleStatus(): Promise<void> {
  console.log(`\n${bold('grain status')}\n`);

  // Config
  const config = loadConfig();
  console.log(`  ${bold('Config')}    ${c.cyan}${config.provider}${c.reset} / ${config.model ?? 'auto'}`);

  // Engram
  const engramBin = join(homedir(), 'bin', 'engram');
  process.stdout.write(`  ${bold('Engram')}    `);
  if (!existsSync(engramBin)) {
    console.log(`${warn} binary not found at ~/bin/engram`);
  } else {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 400);
      const res = await fetch('http://localhost:7474/health', { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const stats: any = await (await fetch('http://localhost:7474/stats')).json();
        console.log(`${ok} running  ${dim(`(${stats.nodes} nodes · ${stats.fts_docs} indexed)`)}`);
      } else {
        console.log(`${warn} server not responding`);
      }
    } catch {
      console.log(`${warn} not running  ${dim('(auto-starts on next grain launch)')}`);
    }
  }

  // Skills
  try {
    const { getSkillManager } = await import('./skills/manager.js');
    const mgr = getSkillManager();
    await mgr.initialize();
    const mdSkills  = await mgr.listMarkdownSkills();
    const jsonSkills = await mgr.getAllJsonSkills();
    const total = mdSkills.length + jsonSkills.length;
    if (total > 0) {
      console.log(`  ${bold('Skills')}    ${c.cyan}${total}${c.reset} loaded  ${dim(`(${mdSkills.length} markdown, ${jsonSkills.length} learned)`)}`);
    } else {
      console.log(`  ${bold('Skills')}    ${dim('none — create one with: grain skills add <name>')}`);
    }
  } catch { /* skip */ }

  // Git status (current directory)
  try {
    const { execSync } = await import('child_process');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', stdio: ['pipe','pipe','pipe'] }).trim();
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8', stdio: ['pipe','pipe','pipe'] }).trim();
    const changed = gitStatus ? gitStatus.split('\n').length : 0;
    const toplevel = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8', stdio: ['pipe','pipe','pipe'] }).trim();
    const repoName = toplevel.split('/').pop() || toplevel;
    console.log(`  ${bold('Repo')}      ${c.cyan}${repoName}${c.reset}  ${dim(`${branch}${changed > 0 ? ` · ${changed} changed` : ' · clean'}`)}`);
  } catch { /* not in a git repo */ }

  // Sessions
  try {
    const { statSync } = await import('fs');
    const dbPath = join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'sessions.json');
    if (existsSync(dbPath)) {
      const sz = statSync(dbPath).size;
      console.log(`  ${bold('Sessions')}  ${dim(`${(sz / 1024).toFixed(0)} KB stored`)}`);
    }
  } catch { /* skip */ }

  // Provider check
  process.stdout.write(`  ${bold('Provider')}  `);
  if (config.provider === 'bedrock') {
    const hasAWS = !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_REGION);
    if (hasAWS) {
      console.log(`${ok} bedrock  ${dim(`(${process.env.AWS_PROFILE || process.env.AWS_REGION || 'env detected'})`)}`);
    } else {
      console.log(`${warn} bedrock — no AWS credentials in env`);
    }
  } else if (config.provider === 'anthropic') {
    console.log(process.env.ANTHROPIC_API_KEY
      ? `${ok} anthropic  ${dim('(ANTHROPIC_API_KEY set)')}`
      : `${err} anthropic — ANTHROPIC_API_KEY not set\n       Run: grain config set key ANTHROPIC_API_KEY sk-...`);
  } else if (config.provider === 'openrouter') {
    console.log(process.env.OPENROUTER_API_KEY
      ? `${ok} openrouter`
      : `${err} openrouter — OPENROUTER_API_KEY not set\n       Run: grain config set key OPENROUTER_API_KEY ...`);
  } else if (config.provider === 'groq') {
    console.log(process.env.GROQ_API_KEY
      ? `${ok} groq`
      : `${err} groq — GROQ_API_KEY not set\n       Run: grain config set key GROQ_API_KEY ...`);
  } else if (config.provider === 'ollama') {
    try {
      await fetch('http://localhost:11434/api/tags');
      console.log(`${ok} ollama  ${dim('(localhost:11434 responding)')}`);
    } catch {
      console.log(`${warn} ollama  ${dim('(localhost:11434 not responding — is Ollama running?)')}`);
    }
  }

  // Plugins
  {
    const plugins = await discoverPlugins(config.plugins?.plugins ?? {});
    const installed = plugins.filter(p => p.installed);
    const count = installed.length;
    const names = installed.map(p => `${ok} ${p.name}`).join('  ');
    const notInstalled = plugins.filter(p => !p.installed).map(p => `${dim(p.name)}`).join('  ');
    const parts = [names, notInstalled].filter(Boolean).join('  ');
    console.log(`  ${bold('Plugins')}   ${c.cyan}${count}${c.reset} installed${count > 0 ? `  ${parts}` : `  ${dim('none found')}`}`);
  }

  // Version + update hint
  console.log();
  console.log(`  ${bold('Version')}   ${c.cyan}v${GRAIN_VERSION}${c.reset}  ${dim('  run "grain update" to check for updates')}`);
  console.log();
}

// ─── grain init ───────────────────────────────────────────────────────────────

async function handleInit(): Promise<void> {
  console.log(`\n${bold('grain init')}\n`);

  // Show existing config if present
  const configPath = join(getConfigDir(), 'config.json');
  if (existsSync(configPath)) {
    const cur = loadConfig();
    console.log(`Existing config found:`);
    console.log(`  provider:  ${c.cyan}${cur.provider}${c.reset}`);
    console.log(`  model:     ${cur.model ?? dim('auto')}`);
    console.log(`  engram_db: ${dim(cur.engram_db)}\n`);
    const redo = await ask('Reconfigure? [y/N] ');
    if (redo.toLowerCase() !== 'y') {
      console.log('Keeping existing config. Run "grain status" to check everything is working.\n');
      process.exit(0);
    }
    console.log();
  }

  // ── Detect available providers ───────────────────────────────────────────
  console.log('Detecting providers...\n');
  const available: Array<{ name: string; label: string; hint?: string }> = [];

  const awsOk = !!(process.env.AWS_REGION || process.env.AWS_PROFILE || process.env.AWS_ACCESS_KEY_ID);
  if (awsOk) {
    const hint = process.env.AWS_PROFILE ? `profile=${process.env.AWS_PROFILE}` : `region=${process.env.AWS_REGION || 'us-east-1'}`;
    available.push({ name: 'bedrock', label: `AWS Bedrock`, hint });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    available.push({ name: 'anthropic', label: 'Anthropic', hint: 'ANTHROPIC_API_KEY set' });
  }
  if (process.env.OPENROUTER_API_KEY) {
    available.push({ name: 'openrouter', label: 'OpenRouter', hint: 'OPENROUTER_API_KEY set' });
  }
  if (process.env.GROQ_API_KEY) {
    available.push({ name: 'groq', label: 'Groq', hint: 'GROQ_API_KEY set' });
  }
  available.push({ name: 'ollama', label: 'Ollama', hint: 'local, no key needed' });

  available.forEach((p, i) => {
    const hintStr = p.hint ? dim(` (${p.hint})`) : '';
    console.log(`  ${c.bold}${i + 1}.${c.reset} ${p.label}${hintStr}`);
  });

  // If nothing detected except ollama, offer key entry
  if (available.length === 1) {
    console.log(`\n${warn} No cloud provider credentials detected.`);
    console.log(`  To use Anthropic: grain config set key ANTHROPIC_API_KEY sk-ant-...`);
    console.log(`  To use Bedrock:   aws configure  (then re-run grain init)`);
    console.log();
  }

  // ── Choose provider ───────────────────────────────────────────────────────
  console.log();
  const choice = await ask(`Provider [1-${available.length}] (default: ${available[0].name}): `);
  let provider = available[0].name;
  const num = parseInt(choice, 10);
  if (!isNaN(num) && num >= 1 && num <= available.length) {
    provider = available[num - 1].name;
  } else if (choice.trim()) {
    const match = available.find(p => p.name.startsWith(choice.toLowerCase()));
    if (match) provider = match.name;
  }
  console.log(`\nUsing: ${bold(provider)}\n`);

  // ── API key entry for new providers ──────────────────────────────────────
  if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
    const key = await ask('ANTHROPIC_API_KEY (paste, hidden after save): ');
    if (!key.trim()) { console.log('No key entered. Exiting.'); process.exit(1); }
    saveKeyToEnv('ANTHROPIC_API_KEY', key.trim());
    process.env.ANTHROPIC_API_KEY = key.trim();
    console.log(`${ok} Saved to ~/.grain/.env\n`);
  }

  if (provider === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
    const key = await ask('OPENROUTER_API_KEY: ');
    if (!key.trim()) { console.log('No key entered. Exiting.'); process.exit(1); }
    saveKeyToEnv('OPENROUTER_API_KEY', key.trim());
    process.env.OPENROUTER_API_KEY = key.trim();
    console.log(`${ok} Saved to ~/.grain/.env\n`);
  }

  if (provider === 'groq' && !process.env.GROQ_API_KEY) {
    const key = await ask('GROQ_API_KEY: ');
    if (!key.trim()) { console.log('No key entered. Exiting.'); process.exit(1); }
    saveKeyToEnv('GROQ_API_KEY', key.trim());
    process.env.GROQ_API_KEY = key.trim();
    console.log(`${ok} Saved to ~/.grain/.env\n`);
  }

  // ── Test connection ───────────────────────────────────────────────────────
  if (provider === 'bedrock') {
    process.stdout.write('Testing Bedrock connection... ');
    const result = await testBedrockConnection();
    if (result.ok) {
      console.log(`${ok} connected\n`);
    } else {
      console.log(`${err} failed\n  ${dim(result.error ?? 'Unknown error')}\n`);
      console.log('Check credentials: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY');
      console.log('or run: aws configure\n');
      const go = await ask('Continue anyway? [y/N] ');
      if (go.toLowerCase() !== 'y') process.exit(1);
    }
  }

  // ── Save config ───────────────────────────────────────────────────────────
  saveConfig({ provider, model: null, engram_db: '~/.engram/knowledge', max_tokens: 180000 });
  console.log(`${ok} Config saved to ~/.grain/config.json\n`);

  // ── Skills dir ────────────────────────────────────────────────────────────
  const { mkdirSync } = await import('fs');
  mkdirSync(join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'skills'), { recursive: true });

  // ── Engram ────────────────────────────────────────────────────────────────
  const engramBin = join(homedir(), 'bin', 'engram');
  console.log('─────────────────────────────────');
  if (existsSync(engramBin)) {
    console.log(`${ok} engram binary found`);
    process.stdout.write('   Starting memory server... ');
    try {
      execSync('curl -sf http://localhost:7474/health > /dev/null 2>&1');
      console.log(`${ok} already running`);
    } catch {
      try {
        const db = join(homedir(), '.engram', 'knowledge');
        const child = spawn(engramBin, ['-d', db, 'serve', '--port', '7474'], {
          detached: true, stdio: 'ignore',
        });
        child.unref();
        await new Promise(r => setTimeout(r, 900));
        execSync('curl -sf http://localhost:7474/health > /dev/null 2>&1');
        console.log(`${ok} started at http://localhost:7474`);
      } catch {
        console.log(`${warn} could not start — run manually: engram -d ~/.engram/knowledge serve`);
      }
    }
  } else {
    console.log(`${warn} engram not found at ~/bin/engram`);
    console.log(`   grain works without it but won't have persistent memory.`);
    console.log(`   Build: cd ~/engram && cargo build --release && cp target/release/engram ~/bin/`);
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('─────────────────────────────────\n');
  console.log(`${bold('Ready.')}\n`);
  console.log(`  ${c.cyan}grain "explain this codebase"${c.reset}`);
  console.log(`  ${c.cyan}grain --yes "add tests for src/auth.ts"${c.reset}`);
  console.log(`  ${c.cyan}grain status${c.reset}              ${dim('check everything is running')}`);
  console.log(`  ${c.cyan}grain update${c.reset}              ${dim('check for new version')}`);
  console.log();
}

// ─── grain --help ─────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`
${bold(`grain v${GRAIN_VERSION}`)} — your coding workspace

  grain                         open your workspace
  grain "do something"           start a workspace with a task
  grain update                   install the latest release

Your first launch connects a provider in the conversation. Grain remembers the
current repository, your sessions, theme, and approved tools for the session.

Inside Grain, type ${bold('/help')} for plans, files, diffs, wiki, history, agents,
attachments, models, settings, and themes. Grain asks before every write or
risky action by default.

${bold('AUTOMATION')}
  grain -p "task" --yes             non-interactive script/CI task
  --provider <name> --model <id>   one-run override
  --attach <path>                  attach text/code/image material

Legacy expert commands (${dim('runs, wiki, agents, lab, config')}) remain available
for scripts and diagnostics.
`);
}

// ─── Bedrock connection test ──────────────────────────────────────────────────

async function testBedrockConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const region = process.env.AWS_REGION || 'us-east-1';
    const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region });
    await client.send(new InvokeModelCommand({
      modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      contentType: 'application/json',
      accept: 'application/json',
    }));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message?.split('\n')[0] };
  }
}

// ─── First-run welcome ────────────────────────────────────────────────────────

function showWelcomeIfNeeded(): void {
  const flag = join(getConfigDir(), '.welcomed');
  if (existsSync(flag)) return;
  try { writeFileSync(flag, new Date().toISOString()); } catch { /* ignore */ }

  renderer.banner(`v${GRAIN_VERSION} · coding agent · memory in the loop`);
  console.log(`Run ${c.cyan}grain init${c.reset} to set up your provider and API keys.`);
  console.log(`Run ${c.cyan}grain --help${c.reset} for all commands.\n`);
}

// ─── Engram handler ───────────────────────────────────────────────────────────

const ENGRAM_API = 'http://localhost:7474';

async function handleEngram(subcmd?: string, arg?: string): Promise<void> {
  // Check server is up
  try {
    const health = await fetch(`${ENGRAM_API}/health`, { signal: AbortSignal.timeout(1000) });
    if (!health.ok) throw new Error('not ok');
  } catch {
    console.error(`${err} engram server not running at ${ENGRAM_API}`);
    console.log(dim('  Run: grain init  (auto-starts engram)'));
    process.exitCode = 1;
    return;
  }

  if (!subcmd || subcmd === 'stats') {
    const [statsRes, nodesRes] = await Promise.all([
      fetch(`${ENGRAM_API}/stats`).then(r => r.json()) as Promise<any>,
      fetch(`${ENGRAM_API}/nodes?limit=100`).then(r => r.json()) as Promise<any[]>,
    ]);

    // Count tags across all nodes
    const tagCounts: Record<string, number> = {};
    for (const node of nodesRes) {
      for (const tag of (node.tags || [])) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    console.log(`\n${bold('engram stats')}\n`);
    console.log(`  ${bold('Nodes')}    ${c.cyan}${statsRes.nodes}${c.reset}  ${dim(`(${statsRes.fts_docs} indexed, ${statsRes.vectors} vectors)`)}`);
    console.log(`  ${bold('Edges')}    ${c.cyan}${statsRes.edges}${c.reset}`);
    if (statsRes.object_bytes) {
      console.log(`  ${bold('Storage')}  ${dim(`${(statsRes.object_bytes / 1024).toFixed(0)} KB`)}`);
    }
    if (topTags.length > 0) {
      console.log(`\n  ${bold('Top Tags')}`);
      for (const [tag, count] of topTags) {
        const bar = '█'.repeat(Math.min(count, 20));
        console.log(`  ${c.cyan}${tag.padEnd(20)}${c.reset} ${dim(bar)} ${count}`);
      }
    }
    console.log('');
    return;
  }

  if (subcmd === 'list') {
    const nodes = await fetch(`${ENGRAM_API}/nodes?limit=20`).then(r => r.json()) as any[];
    if (!nodes.length) { console.log(dim('No nodes in engram.')); return; }
    console.log(`\n${bold('Recent nodes')} ${dim('(latest 20)')}\n`);
    for (const node of nodes) {
      const tags = node.tags?.length ? dim(` [${node.tags.join(', ')}]`) : '';
      const body = node.body.slice(0, 80).replace(/\n/g, ' ');
      console.log(`  ${c.cyan}${node.id.slice(-8)}${c.reset}${tags}`);
      console.log(`  ${dim(body)}`);
    }
    console.log('');
    return;
  }

  if (subcmd === 'search') {
    if (!arg) { console.error(`${err} Usage: grain engram search <query>`); return; }
    const res = await fetch(`${ENGRAM_API}/search?q=${encodeURIComponent(arg)}&limit=10`).then(r => r.json()) as any[];
    if (!res.length) { console.log(dim(`No results for "${arg}"`)); return; }
    // Normalize scores relative to top result
    const maxScore = Math.max(...res.map((n: any) => n.score || 0), 0.001);
    console.log(`\n${bold(`engram search: "${arg}"`)}\n`);
    for (const node of res) {
      const tags = node.tags?.length ? dim(` [${node.tags.join(', ')}]`) : '';
      const normalizedPct = Math.round(((node.score || 0) / maxScore) * 100);
      const score = `${normalizedPct}%`;
      const body = node.body.slice(0, 120).replace(/\n/g, ' ');
      console.log(`  ${c.cyan}${score.padEnd(5)}${c.reset}${tags}`);
      console.log(`  ${body}\n`);
    }
    return;
  }

  if (subcmd === 'add') {
    if (!arg) { console.error(`${err} Usage: grain engram add <fact>`); return; }
    const res = await fetch(`${ENGRAM_API}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: arg, tags: ['manual'], node_type: 'fact' }),
    }).then(r => r.json()) as any;
    console.log(`${ok} Stored: ${c.cyan}${res.id}${c.reset}`);
    return;
  }

  console.error(`${err} Unknown subcommand: ${subcmd}`);
  console.log(`Usage: grain engram [stats|list|search <query>|add <fact>]`);
}

// ─── Skills handler ───────────────────────────────────────────────────────────

async function handleSkills(subcmd?: string, name?: string): Promise<void> {
  const { getSkillManager } = await import('./skills/manager.js');
  const mgr = getSkillManager();
  await mgr.initialize();

  if (!subcmd || subcmd === 'list') {
    const mdSkills  = await mgr.listMarkdownSkills();
    const jsonSkills = await mgr.getAllJsonSkills();

    if (mdSkills.length === 0 && jsonSkills.length === 0) {
      console.log(`${dim('No skills found.')} Add one with: ${c.cyan}grain skills add <name>${c.reset}`);
      console.log(`Skills directory: ${dim(mgr.getSkillsDirectory())}`);
      return;
    }

    if (mdSkills.length > 0) {
      console.log(`\n${bold('Markdown Skills')} ${dim('(~/.grain/skills/*.md)')}`);
      for (const s of mdSkills) {
        const tags = s.tags.length > 0 ? dim(` [${s.tags.join(', ')}]`) : '';
        const desc = s.description ? `  ${dim(s.description)}` : '';
        console.log(`  ${c.cyan}${s.name}${c.reset}${tags}${desc}`);
      }
    }

    if (jsonSkills.length > 0) {
      console.log(`\n${bold('Learned Patterns')} ${dim('(keyword-matched)')}`);
      for (const s of jsonSkills) {
        const rate = `${(s.metadata.success_rate * 100).toFixed(0)}%`;
        console.log(`  ${c.cyan}${s.name}${c.reset}  ${dim(`used ${s.metadata.times_used}x · ${rate} success`)}`);
      }
    }
    console.log('');
    return;
  }

  if (subcmd === 'view') {
    if (!name) { console.error(`${err} Usage: grain skills view <name>`); return; }
    const skill = await mgr.getMarkdownSkill(name);
    if (!skill) { console.error(`${err} Skill not found: ${name}`); process.exitCode = 1; return; }
    console.log(`\n${bold(skill.name)}`);
    if (skill.description) console.log(dim(skill.description));
    if (skill.tags.length > 0) console.log(dim(`tags: ${skill.tags.join(', ')}`));
    console.log(`\n${skill.content}\n`);
    return;
  }

  if (subcmd === 'add') {
    if (!name) { console.error(`${err} Usage: grain skills add <name>`); return; }
    const iface = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> => new Promise(r => iface.question(q, r));

    try {
      // Ask all single-line questions BEFORE consuming the multiline body:
      // breaking out of `for await (const line of iface)` closes the
      // interface, so no questions may follow it.
      const description = await ask(`Description (one line): `);
      const tagsRaw = await ask(`Tags (comma-separated, optional): `);
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

      console.log(`Enter skill content (markdown). Type ${c.cyan}EOF${c.reset} on a line by itself to finish:`);
      const lines: string[] = [];
      for await (const line of iface) {
        if (line.trim() === 'EOF') break;
        lines.push(line);
      }

      const content = lines.join('\n');
      const skill = await mgr.createMarkdownSkill(name, description, content, tags);
      console.log(`\n${ok} Created skill: ${c.cyan}${skill.name}${c.reset}`);
      console.log(dim(`  ${skill.filePath}`));
    } finally {
      iface.close();
    }
    return;
  }

  if (subcmd === 'delete') {
    if (!name) { console.error(`${err} Usage: grain skills delete <name>`); return; }
    const deleted = await mgr.deleteMarkdownSkill(name);
    if (deleted) {
      console.log(`${ok} Deleted skill: ${name}`);
    } else {
      console.error(`${err} Skill not found: ${name}`);
    }
    return;
  }

  console.error(`${err} Unknown subcommand: ${subcmd}`);
  console.log(`Usage: grain skills [list|view <name>|add <name>|delete <name>]`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadGrainEnv();
  const parsed = parseArgs(process.argv);

  if (parsed.unknownFlags?.length) {
    console.error(`Unknown flag${parsed.unknownFlags.length > 1 ? 's' : ''}: ${parsed.unknownFlags.join(', ')}`);
    console.error('Run "grain --help" for usage, or use -- to pass literal dashes in a prompt.');
    process.exitCode = 1;
    return;
  }

  if (parsed.theme) {
    const themes: GrainThemeName[] = ['field', 'studio', 'arcade', 'system'];
    if (!themes.includes(parsed.theme)) throw new Error(`Unknown theme "${parsed.theme}". Use: ${themes.join(', ')}`);
    const config = loadConfig();
    saveConfig({ ...config, tui: { ...config.tui!, theme: parsed.theme, schemaVersion: 2 } });
  }

  // Commands that don't need engram or the agent
  if (parsed.command === 'help')    { showHelp(); return; }
  if (parsed.command === 'version') { console.log(`grain v${GRAIN_VERSION}`); return; }
  if (parsed.command === 'update')  { await handleUpdate(); return; }
  if (parsed.command === 'init')    { await handleInit(); return; }
  if (parsed.command === 'status')  { await handleStatus(); return; }
  if (parsed.command === 'serve') {
    renderer.error('The serve command is not available. Run "grain" for the interactive agent.');
    process.exitCode = 1;
    return;
  }
  if (parsed.command === 'skills')  { await handleSkills(parsed.skillsSubcmd, parsed.skillsName); return; }
  if (parsed.command === 'engram')  { await handleEngram(parsed.engramSubcmd, parsed.engramArg); return; }
  if (parsed.command === 'wiki') { await handleWikiCommand(parsed.utilitySubcmd, parsed.utilityArg); return; }
  if (parsed.command === 'runs') { handleRunsCommand(parsed.utilitySubcmd, parsed.utilityArg, parsed.utilityOutput); return; }
  if (parsed.command === 'learning') { handleLearningCommand(parsed.utilitySubcmd, parsed.utilityArg, parsed.utilityOutput); return; }
  if (parsed.command === 'agents') { await handleAgentsCommand(parsed.utilitySubcmd, parsed.utilityArg, parsed.utilityOutput); return; }
  if (parsed.command === 'tui') {
    const config = loadConfig();
    if (parsed.utilitySubcmd && !['--run', '--resume'].includes(parsed.utilitySubcmd)) throw new Error('Usage: grain tui [--run|--resume <run-id>]');
    await runTui({ runId: parsed.utilityArg, alternateScreen: parsed.noAltScreen ? false : config.tui?.alternateScreen }); return;
  }
  if (parsed.command === 'lab') { handleLabCommand(parsed.utilityArg); return; }

  if (parsed.command === 'config') {
    await handleConfig(parsed.configSubcmd, parsed.configKey, parsed.configValue);
    return;
  }

  // The workspace owns first-run guidance. Keep the legacy banner only for
  // non-interactive print mode, where there is no conversational setup.
  if (parsed.printMode && !parsed.prompt) showWelcomeIfNeeded();

  // Silently ensure engram is running (non-blocking)
  ensureEngramRunning().catch(() => { /* never fails grain */ });

  // Run the agent
  try {
    // TB bridge mode: set env so bash.ts proxies commands to container
    if (parsed.tbBridge) {
      process.env.GRAIN_TB_BRIDGE = '1';
      process.env.GRAIN_MACHINE = '1';
    }

    await orchestrate({
      prompt:      parsed.prompt,
      autoApprove: parsed.autoApprove || parsed.tbBridge,
      concise:     parsed.concise     || parsed.tbBridge,
      model:       parsed.model,
      provider:    parsed.provider,
      maxTurns:    parsed.maxTurns,
      reflect:     parsed.reflect,
      allowDestructive: parsed.allowDestructive,
      benchmark: parsed.tbBridge,
      attachments: parsed.attachments,
      workspace: !parsed.printMode,
    });

    // Signal done to TB bridge
    if (parsed.tbBridge) {
      process.stdout.write(JSON.stringify({ type: 'done' }) + '\n');
    }

    // Force exit in non-TTY mode — readline or other libuv handles
    // can keep the event loop alive even after all work is done.
    if (!process.stdin.isTTY) {
      process.exit(0);
    }
  } catch (e: any) {
    if (e.message === 'SIGINT') {
      renderer.newLine();
      renderer.info('Goodbye.');
    } else {
      renderer.error(e.message);
      process.exit(1);
    }
  }
}

if (import.meta.main) {
  main().catch(e => { renderer.error(e.message); process.exitCode = 1; });
}
