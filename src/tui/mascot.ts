import type { GrainTheme } from './theme.js';

export type MascotState = 'idle' | 'thinking' | 'working' | 'question' | 'approval' | 'verifying' | 'recovery' | 'complete' | 'failed';

const FRAMES: Record<MascotState, string[]> = {
  idle: ['(•ᴗ•)', '(•ᴗ•)'], thinking: ['(• . •)', '(• · •)', '(• . •)'],
  working: ['(•ᴗ•)≋', '(•ᴗ•)≈', '(•ᴗ•)≋'], question: ['(•?•)'], approval: ['(•!•)'],
  verifying: ['(•ᴗ•)⌁', '(•ᴗ•)⌇'], recovery: ['(•_•)'], complete: ['(＾▽＾)', '(＾▽＾)✦'], failed: ['(×_×)'],
};

export function mascotState(status: string): MascotState {
  if (status === 'waiting_input') return 'question';
  if (status === 'waiting_approval') return 'approval';
  if (status === 'executing_tool') return 'working';
  if (status === 'verifying') return 'verifying';
  if (status === 'needs_reconciliation') return 'recovery';
  if (status === 'succeeded') return 'complete';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return status === 'running' ? 'thinking' : 'idle';
}

export function mascotFrame(status: string, tick: number, reducedMotion: boolean): string {
  const frames = FRAMES[mascotState(status)];
  return frames[reducedMotion ? 0 : tick % frames.length];
}

export function mascotColor(status: string, theme: GrainTheme): string {
  const state = mascotState(status);
  if (state === 'complete') return theme.success;
  if (state === 'failed') return theme.danger;
  if (state === 'approval' || state === 'question' || state === 'recovery') return theme.warning;
  return theme.accent;
}
