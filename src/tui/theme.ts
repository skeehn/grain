import type { CellStyle } from './types.js';

export type GrainThemeName = 'field' | 'studio' | 'arcade' | 'system';

export interface GrainTheme {
  name: GrainThemeName;
  canvas: string; panel: string; raised: string; line: string;
  text: string; muted: string; accent: string; success: string;
  warning: string; danger: string; evidence: string;
}

export type GrainThemeRole = Exclude<keyof GrainTheme, 'name'>;

export const THEMES: Record<GrainThemeName, GrainTheme> = {
  field:  { name: 'field', canvas: '#161713', panel: '#1D1F1A', raised: '#25271F', line: '#393A31', text: '#E7E0D2', muted: '#929084', accent: '#D6A85F', success: '#88A678', warning: '#E5B567', danger: '#E06C75', evidence: '#7FA7B8' },
  studio: { name: 'studio', canvas: '#FFF8ED', panel: '#FFFDF8', raised: '#F6E5C7', line: '#D9C7A9', text: '#30291F', muted: '#796F63', accent: '#C87337', success: '#4E8B72', warning: '#B87822', danger: '#C35262', evidence: '#397E9B' },
  arcade: { name: 'arcade', canvas: '#0A0B1C', panel: '#131530', raised: '#20234A', line: '#3D4176', text: '#E8F1FF', muted: '#919BC2', accent: '#F6E25B', success: '#71E6A1', warning: '#FFB45E', danger: '#FF6B9A', evidence: '#72D8FF' },
  system: { name: 'system', canvas: '#000000', panel: '#000000', raised: '#000000', line: '#777777', text: '#FFFFFF', muted: '#AAAAAA', accent: '#FFFFFF', success: '#FFFFFF', warning: '#FFFFFF', danger: '#FFFFFF', evidence: '#FFFFFF' },
};

export function resolveTheme(value: string | undefined): GrainTheme {
  return value && Object.prototype.hasOwnProperty.call(THEMES, value) ? THEMES[value as GrainThemeName] : THEMES.field;
}

export function themeStyle(theme: GrainTheme, role: GrainThemeRole, extra: CellStyle = {}): CellStyle {
  return { foreground: theme[role] as string, ...extra };
}
