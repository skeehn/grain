/**
 * Config command — `grain config show`
 * 
 * Displays configuration in a well-formatted table with sections:
 * - Provider (name, model, endpoint if vllm)
 * - Plugins (installed agent binaries with versions)
 * - MCP Servers (if configured)
 * - Paths (config dir, engram db, sessions)
 */
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig, getConfigDir, VALID_PROVIDERS, listEnvKeys } from '../config.js';
import { discoverPlugins } from '../plugins/discovery.js';
import { loadMcpConfig, mcpConfigPath } from '../mcp/config.js';
import { sessionsDirectory } from '../session/store.js';

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const c = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  white:   '\x1b[37m',
};

const ok   = `${c.green}✓${c.reset}`;
const warn = `${c.yellow}!${c.reset}`;
const err  = `${c.red}✗${c.reset}`;
const dim  = (s: string) => `${c.dim}${s}${c.reset}`;
const bold = (s: string) => `${c.bold}${s}${c.reset}`;
const cyan = (s: string) => `${c.cyan}${s}${c.reset}`;
const green = (s: string) => `${c.green}${s}${c.reset}`;
const yellow = (s: string) => `${c.yellow}${s}${c.reset}`;
const magenta = (s: string) => `${c.magenta}${s}${c.reset}`;

// Box drawing characters
const BOX = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  teeRight: '├',
  teeLeft: '┤',
};

// ─── Formatting helpers ───────────────────────────────────────────────────────

function sectionHeader(title: string): string {
  const line = BOX.horizontal.repeat(60);
  return `\n${c.cyan}${BOX.topLeft}${line}${c.reset}\n${c.cyan}${BOX.vertical}${c.reset} ${bold(title)}\n${c.cyan}${BOX.teeRight}${BOX.horizontal.repeat(60)}${c.reset}`;
}

function row(label: string, value: string, indent = 2): string {
  const spaces = ' '.repeat(indent);
  const labelPad = 18 - label.length;
  return `${spaces}${dim(label)}${' '.repeat(Math.max(1, labelPad))}${value}`;
}

function sectionEnd(): string {
  return `${c.cyan}${BOX.bottomLeft}${BOX.horizontal.repeat(60)}${c.reset}`;
}

// ─── Main show command ────────────────────────────────────────────────────────

export async function handleConfigShow(): Promise<void> {
  const config = loadConfig();
  const envKeys = listEnvKeys();
  
  console.log(`\n${bold('grain config show')}`);
  
  // ─── Provider Section ─────────────────────────────────────────────────────
  console.log(sectionHeader('Provider'));
  
  const providerValid = VALID_PROVIDERS.includes(config.provider as any);
  const providerStatus = providerValid ? green(config.provider) : yellow(config.provider);
  console.log(row('Provider', providerStatus));
  
  // Model
  const modelDisplay = config.model && config.model.trim() 
    ? cyan(config.model) 
    : dim('auto (smart routing)');
  console.log(row('Model', modelDisplay));
  
  // Endpoint (vllm only)
  if (config.provider === 'vllm') {
    const endpoint = config.vllm?.endpoint ?? dim('not set');
    console.log(row('Endpoint', endpoint));
  }
  
  // API keys status
  const keyMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    groq: 'GROQ_API_KEY',
    bedrock: 'AWS_ACCESS_KEY_ID',
  };
  
  const requiredKey = keyMap[config.provider];
  if (requiredKey) {
    const keyValue = process.env[requiredKey] || envKeys[requiredKey];
    if (keyValue) {
      const masked = keyValue.slice(0, 8) + '...' + keyValue.slice(-4);
      console.log(row('API Key', `${ok} ${dim(masked)}`));
    } else if (config.provider === 'bedrock') {
      // Bedrock can use profile or env
      const hasProfile = !!process.env.AWS_PROFILE;
      const hasRegion = !!process.env.AWS_REGION;
      if (hasProfile || hasRegion) {
        console.log(row('Credentials', `${ok} ${dim(process.env.AWS_PROFILE || process.env.AWS_REGION || 'env')}`));
      } else {
        console.log(row('Credentials', `${warn} ${dim('not configured')}`));
      }
    } else {
      console.log(row('API Key', `${err} ${dim('not set')}`));
    }
  }
  
  console.log(sectionEnd());
  
  // ─── Plugins Section ──────────────────────────────────────────────────────
  console.log(sectionHeader('Plugins'));
  
  const plugins = await discoverPlugins(config.plugins?.plugins ?? {});
  
  if (plugins.length === 0) {
    console.log(row('', dim('No plugins configured')));
  } else {
    for (const plugin of plugins) {
      let status: string;
      if (!plugin.installed) {
        status = `${err} ${dim('not installed')}`;
      } else if (!plugin.enabled) {
        status = `${warn} ${dim('disabled')}`;
      } else {
        // Clean up version string - extract just the version number
        let ver = '';
        if (plugin.version) {
          // Try to extract semver-like version (e.g., "2.1.195" from "2.1.195 (Claude Code)")
          const match = plugin.version.match(/(\d+\.\d+\.?\d*)/);
          ver = match ? dim(match[1]) : dim(plugin.version.slice(0, 20));
        }
        status = `${ok} ${ver}`;
      }
      console.log(row(plugin.name, status));
    }
  }
  
  // Show routing preference
  const routing = config.plugins?.routing;
  if (routing?.prefer) {
    console.log(row('Prefer', cyan(routing.prefer)));
  }
  if (routing?.fallback && routing.fallback.length > 0) {
    console.log(row('Fallback', dim(routing.fallback.join(' → '))));
  }
  
  console.log(sectionEnd());
  
  // ─── MCP Servers Section ──────────────────────────────────────────────────
  let mcpServers: Array<{ name: string; command?: string; url?: string }> = [];
  let mcpError = '';
  try {
    mcpServers = Object.entries(loadMcpConfig().servers).map(([name, server]) => ({ name, command: server.command, url: server.url }));
  } catch (error: any) { mcpError = error.message; }
  
  console.log(sectionHeader('MCP Servers'));
  
  if (mcpError) {
    console.log(row('', `${err} ${mcpError}`));
    console.log(row('Config file', dim(mcpConfigPath())));
  } else if (mcpServers.length === 0) {
    console.log(row('', dim('None configured')));
    console.log(row('', dim(`Add MCP servers to ${mcpConfigPath()}`)));
  } else {
    for (const server of mcpServers) {
      const detail = server.url ?? server.command ?? '';
      console.log(row(server.name, dim(detail)));
    }
  }
  
  console.log(sectionEnd());
  
  // ─── Paths Section ────────────────────────────────────────────────────────
  console.log(sectionHeader('Paths'));
  
  const configDir = getConfigDir();
  const engramDb = config.engram_db.replace(/^~(?=\/|$)/, homedir());
  const sessionsPath = sessionsDirectory();
  const skillsPath = join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'skills');
  
  console.log(row('Config', dim(configDir)));
  
  // Engram DB with status
  if (existsSync(engramDb)) {
    try {
      const size = statSync(engramDb).size;
      const sizeStr = size > 1024 * 1024 
        ? `${(size / (1024 * 1024)).toFixed(1)} MB`
        : `${(size / 1024).toFixed(0)} KB`;
      console.log(row('Engram DB', `${dim(engramDb)} ${dim(`(${sizeStr})`)}`));
    } catch {
      console.log(row('Engram DB', dim(engramDb)));
    }
  } else {
    console.log(row('Engram DB', `${dim(engramDb)} ${dim('(not created)')}`));
  }
  
  // Sessions DB
  if (existsSync(sessionsPath)) {
    try {
      const files = readdirSync(sessionsPath).filter(name => name.endsWith('.json'));
      const size = files.reduce((total, name) => total + statSync(join(sessionsPath, name)).size, 0);
      const sizeStr = size > 1024 * 1024 
        ? `${(size / (1024 * 1024)).toFixed(1)} MB`
        : `${(size / 1024).toFixed(0)} KB`;
      console.log(row('Sessions', `${dim(sessionsPath)} ${dim(`(${files.length} conversations, ${sizeStr})`)}`));
    } catch {
      console.log(row('Sessions', dim(sessionsPath)));
    }
  } else {
    console.log(row('Sessions', `${dim(sessionsPath)} ${dim('(not created)')}`));
  }
  
  // Skills
  if (existsSync(skillsPath)) {
    try {
      const { readdirSync } = await import('fs');
      const skills = readdirSync(skillsPath).filter(f => f.endsWith('.md') || f.endsWith('.json'));
      console.log(row('Skills', `${dim(skillsPath)} ${dim(`(${skills.length} files)`)}`));
    } catch {
      console.log(row('Skills', dim(skillsPath)));
    }
  } else {
    console.log(row('Skills', `${dim(skillsPath)} ${dim('(not created)')}`));
  }
  
  console.log(sectionEnd());
  
  // ─── Quick commands hint ──────────────────────────────────────────────────
  console.log();
  console.log(dim('  Commands:'));
  console.log(dim('    grain config set provider <name>   Change provider'));
  console.log(dim('    grain config set model <id>        Set model override'));
  console.log(dim('    grain config reset                 Restore defaults'));
  console.log();
}
