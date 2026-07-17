// Zero-dependency UI screenshot for the design → critique → iterate loop.
// Drives headless Chrome's built-in --screenshot flag (no puppeteer, no CDP
// WebSocket, no npm dep). The captured PNG is queued so the agent loop can
// hand it to a vision-capable model for critique on the next turn.
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { ExecutableTool, ToolResult } from '../providers/types.js';

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean) as string[];

function findChrome(): string | undefined { return CHROME_CANDIDATES.find(p => existsSync(p)); }

// Screenshots the loop should attach to the next turn for visual review.
export interface PendingShot { path: string; mediaType: string }
let pending: PendingShot[] = [];
export function drainPendingScreenshots(): PendingShot[] { const p = pending; pending = []; return p; }
export function hasPendingScreenshots(): boolean { return pending.length > 0; }

let counter = 0;

export const screenshotTool: ExecutableTool = {
  name: 'screenshot',
  description: [
    'Capture a screenshot of a web UI (usually a localhost dev server) so you can SEE and critique the design, then iterate.',
    'Start the app first (e.g. bash: npm run dev), then screenshot its URL. The image is shown to you on the next step when the model supports vision.',
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to capture, e.g. http://localhost:3000' },
      width: { type: 'number', description: 'Viewport width px (default 1280)' },
      height: { type: 'number', description: 'Viewport height px (default 800)' },
    },
    required: ['url'],
  },
  async execute(input: { url: string; width?: number; height?: number }): Promise<ToolResult> {
    const url = String(input.url || '').trim();
    if (!/^https?:\/\/|^file:\/\//.test(url)) return { content: 'screenshot needs an http(s):// or file:// URL (start your dev server first).', is_error: true };
    const chrome = findChrome();
    if (!chrome) return { content: 'No Chrome/Chromium found. Install Google Chrome, or set CHROME_BIN to its path.', is_error: true };

    const w = Math.max(320, Math.min(input.width || 1280, 3840));
    const h = Math.max(240, Math.min(input.height || 800, 4320));
    const dir = join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'screenshots');
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `shot-${process.pid}-${++counter}.png`);

    const res = spawnSync(chrome, [
      '--headless', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
      '--force-color-profile=srgb', `--window-size=${w},${h}`, `--screenshot=${out}`, url,
    ], { timeout: 30_000, stdio: ['ignore', 'ignore', 'pipe'] });

    if (!existsSync(out) || statSync(out).size === 0) {
      const err = (res.stderr?.toString() || '').split('\n').filter(Boolean).slice(-2).join(' ');
      return { content: `Screenshot failed — is the dev server running at ${url}? ${err}`.trim(), is_error: true };
    }

    pending.push({ path: out, mediaType: 'image/png' });
    return { content: `Captured ${url} (${w}×${h}) → ${out}. The image is attached for you to review on the next step; look at the layout, spacing, hierarchy, and color, then iterate.` };
  },
};
