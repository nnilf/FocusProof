import { useEffect, useState } from 'react';

export interface ThemeColors {
  productive: string;
  neutral: string;
  distracted: string;
  away: string;
  ink2: string;
  ink3: string;
  rule: string;
  tint: string;
  tint2: string;
  sheet: string;
}

const TOKENS: Record<keyof ThemeColors, string> = {
  productive: '--c-productive',
  neutral: '--c-neutral',
  distracted: '--c-distracted',
  away: '--c-away',
  ink2: '--ink-2',
  ink3: '--ink-3',
  rule: '--rule',
  tint: '--tint',
  tint2: '--tint-2',
  sheet: '--sheet',
};

function read(): ThemeColors {
  const style = getComputedStyle(document.documentElement);
  const out = {} as ThemeColors;
  for (const [key, token] of Object.entries(TOKENS)) out[key as keyof ThemeColors] = style.getPropertyValue(token).trim();
  return out;
}

/** CSS colour tokens as literal values, for Recharts (SVG attributes can't resolve var()). Updates with the OS theme. */
export function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (): void => setColors(read());
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return colors;
}
