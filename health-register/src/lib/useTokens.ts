import { useEffect, useState } from 'react';

function read(name: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return v ? `rgb(${v})` : '#888';
}

const NAMES = ['text', 'muted', 'border', 'surface', 'surface-2', 'primary', 'accent', 'danger', 'success', 'warning',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6',
  'c-diabetes', 'c-bp', 'c-allergy', 'c-exempt', 'c-chronic', 'c-followup', 'c-critical'] as const;
export type TokenMap = Record<(typeof NAMES)[number], string>;

/** ألوان الرسوم من رموز التصميم، وتتحدث عند تبديل الثيم */
export function useTokens(): TokenMap {
  const snapshot = () => Object.fromEntries(NAMES.map((n) => [n, read(n)])) as TokenMap;
  const [t, setT] = useState<TokenMap>(snapshot);
  useEffect(() => {
    const obs = new MutationObserver(() => setT(snapshot()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return t;
}

export function colorOf(t: TokenMap, color: string) {
  const key = `c-${color}` as keyof TokenMap;
  return t[key] ?? color;
}
