// Where the map of Indonesia sits inside its box. On the wide dark hero the headline covers the left
// side, so the islands are fitted into the right part; everywhere else they simply fill the box.
export type Padding = { top: number; right: number; bottom: number; left: number };

export function heroPadding(boxWidth: number, tone: 'light' | 'dark'): Padding {
  if (tone === 'dark' && boxWidth >= 900) return { top: 40, right: 32, bottom: 150, left: Math.round(boxWidth * 0.44) };
  return { top: 12, right: 12, bottom: tone === 'dark' ? 28 : 12, left: 12 };
}
