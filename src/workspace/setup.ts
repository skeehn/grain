import { existsSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { getConfigDir, loadConfig, saveConfig, saveKeyToEnv, type GrainConfig } from '../config.js';

export type SetupProvider = 'bedrock' | 'anthropic' | 'openrouter' | 'groq' | 'ollama';
export interface ProviderSetup { id: SetupProvider; label: string; envKey?: string; keyUrl?: string; detected: boolean; }
export interface SetupIO { prompt(message: string): Promise<string | null>; info(message: string): void; open(url: string): boolean; }

const PROVIDERS: Omit<ProviderSetup, 'detected'>[] = [
  { id: 'bedrock', label: 'AWS Bedrock' },
  { id: 'anthropic', label: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openrouter', label: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'groq', label: 'Groq', envKey: 'GROQ_API_KEY', keyUrl: 'https://console.groq.com/keys' },
  { id: 'ollama', label: 'Ollama' },
];

export function discoverProviders(env: NodeJS.ProcessEnv = process.env, ollamaDetected = false): ProviderSetup[] {
  const aws = Boolean(env.AWS_REGION || env.AWS_PROFILE || env.AWS_ACCESS_KEY_ID);
  return PROVIDERS.map(provider => ({ ...provider, detected: provider.id === 'bedrock' ? aws : provider.id === 'ollama' ? ollamaDetected : Boolean(provider.envKey && env[provider.envKey]) }));
}

export function providerReady(config: GrainConfig, env: NodeJS.ProcessEnv = process.env, ollamaDetected = false): boolean {
  if (config.provider === 'bedrock') return Boolean(env.AWS_REGION || env.AWS_PROFILE || env.AWS_ACCESS_KEY_ID);
  if (config.provider === 'ollama') return ollamaDetected;
  const option = PROVIDERS.find(provider => provider.id === config.provider);
  return Boolean(option?.envKey && env[option.envKey]);
}

export function selectProvider(providers: ProviderSetup[], choice: string): ProviderSetup | undefined {
  if (!choice) return providers.find(provider => provider.detected) || providers.find(provider => provider.id === 'ollama');
  if (/^\d+$/u.test(choice)) return providers[Number.parseInt(choice, 10) - 1];
  return providers.find(provider => provider.id === choice.toLowerCase());
}

export async function detectOllama(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 250);
    const response = await fetcher(`${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}/api/tags`, { signal: controller.signal });
    clearTimeout(timer); return response.ok;
  } catch { return false; }
}

/** Opens a provider dashboard only after the workspace explicitly asks the user. */
export function openProviderPage(url: string): boolean {
  const command = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform() === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(command, args, { detached: true, stdio: 'ignore' }).unref(); return true; } catch { return false; }
}

export async function ensureWorkspaceSetup(io: SetupIO, options: { env?: NodeJS.ProcessEnv; ollamaDetected?: boolean } = {}): Promise<GrainConfig> {
  const env = options.env || process.env;
  const hasConfig = existsSync(join(getConfigDir(), 'config.json'));
  const config = loadConfig();
  const ollamaDetected = options.ollamaDetected ?? await detectOllama();
  if (hasConfig && providerReady(config, env, ollamaDetected)) return config;

  const providers = discoverProviders(env, ollamaDetected);
  io.info('(•ᴗ•) Let’s connect Grain. Pick a provider; you can change this later in /settings.');
  providers.forEach((provider, index) => io.info(`  ${index + 1}. ${provider.label}${provider.detected ? ' · ready' : ''}`));
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
