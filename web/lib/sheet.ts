// The phone bottom sheet rests at one of three heights. A tap on its handle steps through them;
// a drag moves one step in the direction of the drag.
export type Snap = 'peek' | 'half' | 'full';
const ORDER: Snap[] = ['peek', 'half', 'full'];

// `dy` is how far the finger moved, in pixels: negative = up. Under 24 px counts as a tap.
export function nextSnap(current: Snap, dy: number): Snap {
  const i = ORDER.indexOf(current);
  if (Math.abs(dy) < 24) return ORDER[(i + 1) % ORDER.length];
  return ORDER[Math.max(0, Math.min(ORDER.length - 1, i + (dy < 0 ? 1 : -1)))];
}
