import type { GrainTheme } from './theme.js';
import { mascotState, type MascotState } from './mascot.js';

/** Fixed dimensions keep the rice sprite safe for retained-cell rendering. */
export const GRAIN_LOGO_WIDTH = 7;
export const GRAIN_LOGO_HEIGHT = 5;

const DITHER = ['.', ':', '*', '#'] as const;

function sprite(state: MascotState, tick: number): readonly string[] {
  const phase = state === 'working' || state === 'thinking' || state === 'verifying' ? Math.abs(tick) % 4 : 3;
  const fill = DITHER[phase];
  const eye = state === 'question' ? '?' : state === 'approval' ? '!' : state === 'failed' ? 'x' : state === 'complete' ? '+' : 'o';
  const base = state === 'working' || state === 'thinking' ? fill : phase > 1 ? '*' : ':';
  return [
    `  ${base}${base === '.' ? '#' : base}   `,
    ` ${base}${fill}${fill}${fill}${base} `,
    `${base}${fill}${eye}${fill}${base}${base}${base}`,
    ` ${base}${fill}${fill}${fill}${base} `,
    `  .=.  `,
  ];
}

export function grainLogoState(status: string): MascotState { return mascotState(status); }

/** Compact one-line form for headers and status rails. */
export function grainLogoFrame(status: string, tick = 0, reducedMotion = false): string {
  return sprite(grainLogoState(status), reducedMotion ? 3 : tick)[2];
}

/** Five-row ASCII rice-ball mascot for welcome and question states. */
export function grainLogoSprite(status: string, tick = 0, reducedMotion = false): readonly string[] {
  return sprite(grainLogoState(status), reducedMotion ? 3 : tick);
}

export function grainLogoColor(status: string, theme: GrainTheme): string {
  const state = grainLogoState(status);
  if (state === 'complete') return theme.success;
  if (state === 'failed') return theme.danger;
  if (state === 'approval' || state === 'question' || state === 'recovery') return theme.warning;
  return theme.evidence;
}
