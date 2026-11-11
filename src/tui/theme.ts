/**
 * ComiCode terminal design tokens.
 *
 * `theme` is a live proxy: it resolves to the palette selected in Settings
 * (`ui.theme`) at access time, so every `theme.accent`-style usage across the
 * TUI picks up theme changes without prop drilling.
 */
export interface ThemeTokens {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentDim: string;
  text: string;
  muted: string;
  faint: string;
  warm: string;
  danger: string;
  warning: string;
  info: string;
  violet: string;
  success: string;
  /** Readable foreground on top of `accent` (selected rows). */
  black: string;
  /** Bright/highlight text. */
  white: string;
}

const obsidian: ThemeTokens = {
  bg: '#0B0E14',
  surface: '#111722',
  surfaceAlt: '#171E2B',
  border: '#232B3A',
  borderStrong: '#334155',
  accent: '#7CE8C3',
  accentDim: '#2F6F5E',
  text: '#E6EAF2',
  muted: '#8A94A6',
  faint: '#566176',
  warm: '#E9B872',
  danger: '#FF7A85',
  warning: '#F2C14E',
  info: '#7FB8FF',
  violet: '#B49CFF',
  success: '#7CE8C3',
  black: '#0B0E14',
  white: '#F7F9FC',
};

const nord: ThemeTokens = {
  bg: '#242933',
  surface: '#2E3440',
  surfaceAlt: '#3B4252',
  border: '#3B4252',
  borderStrong: '#4C566A',
  accent: '#88C0D0',
  accentDim: '#4C7A8A',
  text: '#ECEFF4',
  muted: '#9AA5B1',
  faint: '#616E88',
  warm: '#EBCB8B',
  danger: '#BF616A',
  warning: '#EBCB8B',
  info: '#81A1C1',
  violet: '#B48EAD',
  success: '#A3BE8C',
  black: '#242933',
  white: '#ECEFF4',
};

const forest: ThemeTokens = {
  bg: '#0C1512',
  surface: '#122019',
  surfaceAlt: '#182A22',
  border: '#1F352B',
  borderStrong: '#2E4A3C',
  accent: '#7FD8A4',
  accentDim: '#2E6B4C',
  text: '#E4F2EA',
  muted: '#8FA99B',
  faint: '#57705F',
  warm: '#E5C07B',
  danger: '#FF7A85',
  warning: '#E5C07B',
  info: '#7FB8FF',
  violet: '#B49CFF',
  success: '#7FD8A4',
  black: '#0C1512',
  white: '#F2FAF5',
};

const ocean: ThemeTokens = {
  bg: '#0A1420',
  surface: '#0F1E30',
  surfaceAlt: '#16293F',
  border: '#1B3350',
  borderStrong: '#274263',
  accent: '#6CC7FF',
  accentDim: '#2C5F8F',
  text: '#E3F0FA',
  muted: '#8CA3BC',
  faint: '#546C85',
  warm: '#FFC978',
  danger: '#FF7A85',
  warning: '#FFC978',
  info: '#8FD0FF',
  violet: '#B49CFF',
  success: '#6CC7FF',
  black: '#0A1420',
  white: '#F0F8FF',
};

const ember: ThemeTokens = {
  bg: '#150E0B',
  surface: '#1F1512',
  surfaceAlt: '#2A1D18',
  border: '#3A2A22',
  borderStrong: '#54402F',
  accent: '#FFAB6B',
  accentDim: '#8F5426',
  text: '#F5EAE2',
  muted: '#B08F7E',
  faint: '#6E5546',
  warm: '#FFD08A',
  danger: '#FF7A85',
  warning: '#FFD08A',
  info: '#8FCBFF',
  violet: '#D0B3FF',
  success: '#FFAB6B',
  black: '#150E0B',
  white: '#FFF6EF',
};

const mono: ThemeTokens = {
  bg: '#0E0E10',
  surface: '#161618',
  surfaceAlt: '#1E1E22',
  border: '#2A2A30',
  borderStrong: '#3D3D45',
  accent: '#D6D6DE',
  accentDim: '#6E6E78',
  text: '#EDEDF2',
  muted: '#9C9CA8',
  faint: '#61616C',
  warm: '#E8E8EE',
  danger: '#FF8080',
  warning: '#E8D27A',
  info: '#9EC2FF',
  violet: '#C8B8FF',
  success: '#B8E6B0',
  black: '#0E0E10',
  white: '#FAFAFC',
};

const lavender: ThemeTokens = {
  bg: '#120E1C',
  surface: '#1A1428',
  surfaceAlt: '#241B36',
  border: '#322A48',
  borderStrong: '#463B63',
  accent: '#C9A8F0',
  accentDim: '#6B4E96',
  text: '#EFE9F8',
  muted: '#A89CC0',
  faint: '#6E628A',
  warm: '#F0C9A0',
  danger: '#FF8FA3',
  warning: '#F0D08A',
  info: '#9CC4FF',
  violet: '#E0C8FF',
  success: '#B5E3C0',
  black: '#120E1C',
  white: '#F6F1FC',
};

const paper: ThemeTokens = {
  bg: '#F6F3EC',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEAE0',
  border: '#D9D2C4',
  borderStrong: '#BDB4A2',
  accent: '#1F5FD0',
  accentDim: '#9DB8E8',
  text: '#1E2430',
  muted: '#5A6474',
  faint: '#8B93A3',
  warm: '#A05A1E',
  danger: '#C22E3A',
  warning: '#8A6A12',
  info: '#0E6FA8',
  violet: '#6B3FB5',
  success: '#1E7A46',
  black: '#FFFFFF',
  white: '#1E2430',
};

const daylight: ThemeTokens = {
  bg: '#EEF3F9',
  surface: '#FFFFFF',
  surfaceAlt: '#E4ECF5',
  border: '#CBD8E8',
  borderStrong: '#A9BCD6',
  accent: '#0B62C4',
  accentDim: '#8FB4E0',
  text: '#152238',
  muted: '#4F5F75',
  faint: '#8494A9',
  warm: '#9A5B12',
  danger: '#B91C2C',
  warning: '#8A6108',
  info: '#0369A1',
  violet: '#6D3FC0',
  success: '#15803D',
  black: '#FFFFFF',
  white: '#152238',
};

const sepia: ThemeTokens = {
  bg: '#F1E7D5',
  surface: '#F8F1E3',
  surfaceAlt: '#EAE0CB',
  border: '#D8C9AE',
  borderStrong: '#BFAE8C',
  accent: '#8A4B12',
  accentDim: '#C9A06B',
  text: '#33291D',
  muted: '#6E5F4B',
  faint: '#9B8B72',
  warm: '#7A4410',
  danger: '#A02C22',
  warning: '#7A5A10',
  info: '#2F5E8A',
  violet: '#6B3E86',
  success: '#3E6B2F',
  black: '#FFFFFF',
  white: '#33291D',
};

const blossom: ThemeTokens = {
  bg: '#FDF1F4',
  surface: '#FFFFFF',
  surfaceAlt: '#F9E4EA',
  border: '#F0CFD9',
  borderStrong: '#E0A9BC',
  accent: '#C2185B',
  accentDim: '#E8A3BC',
  text: '#33161F',
  muted: '#7A4A58',
  faint: '#A98A94',
  warm: '#9A4A1E',
  danger: '#B91C2C',
  warning: '#8A6108',
  info: '#0E6FA8',
  violet: '#7C3AED',
  success: '#15803D',
  black: '#FFFFFF',
  white: '#33161F',
};

const slate: ThemeTokens = {
  bg: '#E9EDF2',
  surface: '#F4F6F9',
  surfaceAlt: '#DFE5EC',
  border: '#C3CDDA',
  borderStrong: '#A3B1C4',
  accent: '#1D4ED8',
  accentDim: '#A9BEE8',
  text: '#1B2430',
  muted: '#4A586C',
  faint: '#7C8AA0',
  warm: '#92580E',
  danger: '#B91C2C',
  warning: '#85600A',
  info: '#0369A1',
  violet: '#6D3FC0',
  success: '#15803D',
  black: '#FFFFFF',
  white: '#1B2430',
};

const contrast: ThemeTokens = {
  bg: '#000000',
  surface: '#0A0A0A',
  surfaceAlt: '#141414',
  border: '#3A3A3A',
  borderStrong: '#5C5C5C',
  accent: '#FFD400',
  accentDim: '#8A7500',
  text: '#FFFFFF',
  muted: '#C8C8C8',
  faint: '#8A8A8A',
  warm: '#FFB84D',
  danger: '#FF5C5C',
  warning: '#FFD400',
  info: '#6FB7FF',
  violet: '#D9B8FF',
  success: '#7DFF9B',
  black: '#000000',
  white: '#FFFFFF',
};

export const THEMES: Record<string, ThemeTokens> = {
  obsidian,
  nord,
  forest,
  ocean,
  ember,
  mono,
  lavender,
  paper,
  daylight,
  sepia,
  blossom,
  slate,
  contrast,
};

export const THEME_NAMES = Object.keys(THEMES);
export const THEME_LABELS: Record<string, string> = {
  obsidian: 'Obsidian (dark)',
  nord: 'Nord',
  forest: 'Forest',
  ocean: 'Ocean',
  ember: 'Ember',
  mono: 'Mono',
  lavender: 'Lavender',
  paper: 'Paper (light)',
  daylight: 'Daylight (light)',
  sepia: 'Sepia (light)',
  blossom: 'Blossom (light)',
  slate: 'Slate (light)',
  contrast: 'High contrast',
};

let activeTheme = 'obsidian';

/** Select the active palette. Unknown names fall back to obsidian. */
export function setActiveTheme(name: string | null | undefined): void {
  activeTheme = name && name in THEMES ? name : 'obsidian';
}

export function activeThemeName(): string {
  return activeTheme;
}

export const theme: ThemeTokens = new Proxy({} as ThemeTokens, {
  get: (_target, prop: keyof ThemeTokens) => THEMES[activeTheme]![prop],
});

export const glyph = {
  brand: '◈',
  prompt: '❯',
  active: '▸',
  bullet: '·',
  tool: '⚙',
  route: '⇢',
  check: '✔',
  cross: '✖',
  pause: 'Ⅱ',
  dot: '●',
  ring: '○',
  arrowUp: '↑',
  arrowDown: '↓',
  arrowLeft: '←',
  arrowRight: '→',
  rule: '─',
} as const;
