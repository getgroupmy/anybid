export const colors = {
  bg: '#f6f7f9',
  surface: '#ffffff',
  border: '#e3e7ee',
  borderStrong: '#d5dae3',
  text: '#21262f',
  textMuted: '#647694',
  textFaint: '#8494ae',
  brand: '#ef3307',
  brandDark: '#c62208',
  brandSoft: '#fff4ed',
  good: '#178253',
  goodSoft: '#eefbf3',
  warn: '#b45309',
  warnSoft: '#fffbeb',
  danger: '#b91c1c',
  dangerSoft: '#fef2f2',
  overlay: 'rgba(33, 38, 47, 0.55)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const type = {
  h1: { fontSize: 24, fontWeight: '700' },
  h2: { fontSize: 18, fontWeight: '700' },
  h3: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 14, fontWeight: '400' },
  small: { fontSize: 12, fontWeight: '400' },
  tiny: { fontSize: 11, fontWeight: '500' },
} as const;

export const shadow = {
  shadowColor: '#21262f',
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;
