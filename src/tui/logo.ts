import type { GrainTheme } from './theme.js';
import { mascotState, type MascotState } from './mascot.js';

/** The terminal-safe width of the Grain rice mark. */
export const GRAIN_LOGO_WIDTH = 7;

const FRAMES: Record<MascotState, readonly string[]> = {
  idle: ['  <•>  '],
  thinking: ['  <·>  ', '  <∙>  ', '  <·>  '],
  working: ['  <≋>  ', '  <≈>  ', '  <≋>  '],
  question: ['  <?>  '],
  approval: ['  <!>  '],
  verifying: ['  <~>  ', '  <⌁>  '],
  recovery: ['  <_>  '],
  complete: ['  <✦>  ', '  <✧>  '],
  failed: ['  <×>  '],
};

export function grainLogoState(status: string): MascotState {
  return mascotState(status);
}

/** Return a fixed-width rice-grain mark for the current run state. */
export function grainLogoFrame(status: string, tick = 0, reducedMotion = false): string {
  const frames = FRAMES[grainLogoState(status)];
  return frames[reducedMotion ? 0 : Math.abs(tick) % frames.length];
}

export function grainLogoColor(status: string, theme: GrainTheme): string {
  const state = grainLogoState(status);
  if (state === 'complete') return theme.success;
  if (state === 'failed') return theme.danger;
  if (state === 'approval' || state === 'question' || state === 'recovery') return theme.warning;
  return theme.accent;
}
