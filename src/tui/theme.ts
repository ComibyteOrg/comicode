/**
 * ComiCode terminal design tokens.
 *
 * Direction: "obsidian editorial" — a dark, quiet canvas with one signal accent
 * (mint), one warm accent for the human voice, and a small family of cool
 * support colors. Everything else is deliberate hierarchy, not rainbow output.
 */
export const theme = {
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
} as const;

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
