import { existsSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { getConfigDir, loadConfig, saveConfig, saveKeyToEnv, type GrainConfig } from '../config.js';

export type SetupProvider = 'bedrock' | 'anthropic' | 'openrouter' | 'groq' | 'ollama' | 'claude-code' | 'codex' | 'opencode';
export interface ProviderSetup { id: SetupProvider; label: string; envKey?: string; keyUrl?: string; detected: boolean; subscription?: boolean; }
export interface SetupIO { prompt(message: string): Promise<string | null>; info(message: string): void; open(url: string): boolean; }

const PROVIDERS: Omit<ProviderSetup, 'detected'>[] = [
  { id: 'bedrock', label: 'AWS Bedrock' },
  { id: 'anthropic', label: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openrouter', label: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'groq', label: 'Groq', envKey: 'GROQ_API_KEY', keyUrl: 'https://console.groq.com/keys' },
  { id: 'ollama', label: 'Ollama' },
];

/** Subscription CLIs need no key from Grain — their own login is the credential. */
const AGENT_PROVIDERS: Array<Omit<ProviderSetup, 'detected'> & { binary: string }> = [
  { id: 'claude-code', label: 'Claude (Claude Code subscription)', binary: 'claude', subscription: true },
  { id: 'codex', label: 'Codex (ChatGPT subscription)', binary: 'codex', subscription: true },
  { id: 'opencode', label: 'OpenCode (local agent)', binary: 'opencode', subscription: true },
];

export function discoverProviders(
  env: NodeJS.ProcessEnv = process.env,
  ollamaDetected = false,
  installedAgents: string[] = [],
): ProviderSetup[] {
  const aws = Boolean(env.AWS_REGION || env.AWS_PROFILE || env.AWS_ACCESS_KEY_ID);
  return [
    ...PROVIDERS.map(provider => ({ ...provider, detected: provider.id === 'bedrock' ? aws : provider.id === 'ollama' ? ollamaDetected : Boolean(provider.envKey && env[provider.envKey]) })),
    ...AGENT_PROVIDERS.filter(agent => installedAgents.includes(agent.id))
      .map(({ binary: _binary, ...agent }) => ({ ...agent, detected: true })),
  ];
}

export function providerReady(config: GrainConfig, env: NodeJS.ProcessEnv = process.env, ollamaDetected = false): boolean {
  // A signed-in CLI carries its own credential; re-running setup for it would
  // strand subscription users on a key prompt they can never satisfy.
  if (AGENT_PROVIDERS.some(agent => agent.id === config.provider)) return true;
  if (config.provider === 'bedrock') return Boolean(env.AWS_REGION || env.AWS_PROFILE || env.AWS_ACCESS_KEY_ID);
  if (config.provider === 'ollama') return ollamaDetected;
  const option = PROVIDERS.find(provider => provider.id === config.provider);
  return Boolean(option?.envKey && env[option.envKey]);
}

export function selectProvider(providers: ProviderSetup[], choice: string): ProviderSetup | undefined {
  // An installed subscription is the best default: it works immediately and
  // costs nothing beyond what the user already pays for.
  if (!choice) {
    return providers.find(provider => provider.subscription && provider.detected)
      || providers.find(provider => provider.detected)
      || providers.find(provider => provider.id === 'ollama');
  }
  if (/^\d+$/u.test(choice)) return providers[Number.parseInt(choice, 10) - 1];
  return providers.find(provider => provider.id === choice.toLowerCase());
}

/** Which coding-agent CLIs are installed right now. */
export async function detectAgentClis(): Promise<string[]> {
  const results = await Promise.all(AGENT_PROVIDERS.map(agent => new Promise<string | null>(resolve => {
    let settled = false;
    const done = (value: string | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } done(null); }, 2_500);
    timer.unref?.();
    const child = spawn(agent.binary, ['--version'], { stdio: 'ignore' });
    child.on('error', () => done(null));
    child.on('close', code => done(code === 0 ? agent.id : null));
  })));
  return results.filter((id): id is string => Boolean(id));
}

export async function detectOllama(fetcher: typeof fetch = fetch): Promise<boolean> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 250);
  try {
    const response = await fetcher(`${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}/api/tags`, { signal: controller.signal });
    return response.ok;
  } catch { return false;
  } finally { clearTimeout(timer); }
}

/** Opens a provider dashboard only after the workspace explicitly asks the user. */
export function openProviderPage(url: string): boolean {
  const command = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform() === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(command, args, { detached: true, stdio: 'ignore' }).unref(); return true; } catch { return false; }
}

export async function ensureWorkspaceSetup(
  io: SetupIO,
  options: { env?: NodeJS.ProcessEnv; ollamaDetected?: boolean; installedAgents?: string[] } = {},
): Promise<GrainConfig> {
  const env = options.env || process.env;
  const hasConfig = existsSync(join(getConfigDir(), 'config.json'));
  const config = loadConfig();
  const ollamaDetected = options.ollamaDetected ?? await detectOllama();
  if (hasConfig && providerReady(config, env, ollamaDetected)) return config;

  const installedAgents = options.installedAgents ?? await detectAgentClis();
  const providers = discoverProviders(env, ollamaDetected, installedAgents);
  io.info('(•ᴗ•) Let’s connect Grain. Pick a provider; you can change this later with /model.');
  providers.forEach((provider, index) => io.info(
    `  ${index + 1}. ${provider.label}${provider.subscription ? ' · signed in, no API key needed' : provider.detected ? ' · ready' : ''}`));
  let selected: ProviderSetup | undefined;
  do {
    const rawChoice = (await io.prompt(`Provider [1-${providers.length}]`))?.trim() || '';
    selected = selectProvider(providers, rawChoice);
    if (!selected) io.info('Invalid provider choice. Enter a listed number or provider name.');
  } while (!selected);

  if (selected.envKey && !env[selected.envKey]) {
    const open = (await io.prompt(`Open ${selected.label} to create an API key? [y/N]`))?.trim().toLowerCase();
    if (open === 'y' || open === 'yes') {
      if (selected.keyUrl && io.open(selected.keyUrl)) io.info(`Opened ${selected.label}. Paste the key here when ready.`);
      else io.info(`Open ${selected.keyUrl || selected.label} and paste the key here.`);
    }
    const key = await io.prompt(`${selected.envKey}`);
    if (!key?.trim()) throw new Error(`A ${selected.envKey} is required to use ${selected.label}. Run grain again when ready.`);
    saveKeyToEnv(selected.envKey, key.trim()); env[selected.envKey] = key.trim();
  }

  if (selected.id === 'ollama' && !ollamaDetected) io.info('Ollama is selected. Start it with `ollama serve` before sending a task.');
  const next = { ...config, provider: selected.id, model: null } as GrainConfig;
  saveConfig(next);
  io.info(`Connected to ${selected.label}. Grain is ready.`);
  return next;
}
