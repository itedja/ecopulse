'use client';
// Draws shareable image cards on a canvas, in the same visual language as the app
// (ink + grey, colour only for data). 1080×1350 = Instagram portrait / WhatsApp friendly.
import { category } from './aqi';

export const W = 1080, H = 1350;
const INK = '#0E1116', MUTED = '#5B6470', LINE = '#E3E6EA', GROUND = '#F4F5F7', FIRE = '#C2410C';
const SANS = 'Inter, system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

function base(ctx: CanvasRenderingContext2D, site: string) {
  ctx.fillStyle = GROUND; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#FFFFFF'; roundRect(ctx, 48, 48, W - 96, H - 96, 36); ctx.fill();
  // brand
  ctx.fillStyle = INK; roundRect(ctx, 96, 104, 26, 26, 6); ctx.fill();
  ctx.font = `700 34px ${SANS}`; ctx.fillText('EcoPulse', 138, 130);
  ctx.font = `500 26px ${SANS}`; ctx.fillStyle = MUTED; ctx.fillText('Indonesia', 300, 130);
  // footer
  ctx.strokeStyle = LINE; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(96, H - 170); ctx.lineTo(W - 96, H - 170); ctx.stroke();
  ctx.font = `500 24px ${MONO}`; ctx.fillStyle = MUTED;
  ctx.fillText(site, 96, H - 118);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 3): number {
  const words = text.split(' ');
  let line = '', lines = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + lines * lineH); lines++; line = w;
      if (lines === maxLines - 1) { ctx.fillText(fitText(ctx, words.slice(words.indexOf(w)).join(' '), maxW), x, y + lines * lineH); return y + (lines + 1) * lineH; }
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, y + lines * lineH); lines++; }
  return y + lines * lineH;
}

export type RankRow = { name: string; value: number; sub?: string };

export function drawRankingCard(ctx: CanvasRenderingContext2D, o: {
  title: string; subtitle: string; rows: RankRow[]; unit: string; kind: 'fire' | 'air' | 'forest'; source: string; site: string;
}) {
  base(ctx, o.site);
  ctx.fillStyle = INK; ctx.font = `700 64px ${SANS}`;
  wrap(ctx, o.title, 96, 250, W - 192, 74, 2);
  ctx.fillStyle = MUTED; ctx.font = `500 30px ${SANS}`; ctx.fillText(o.subtitle, 96, 410);

  const rows = o.rows.slice(0, 5);
  const max = Math.max(1, ...rows.map((r) => r.value));
  let y = 470;
  rows.forEach((r, i) => {
    ctx.fillStyle = MUTED; ctx.font = `600 34px ${MONO}`; ctx.fillText(String(i + 1), 96, y + 40);
    ctx.fillStyle = INK; ctx.font = `600 38px ${SANS}`; ctx.fillText(fitText(ctx, r.name, 560), 150, y + 40);
    ctx.font = `700 44px ${SANS}`; ctx.textAlign = 'right'; ctx.fillText(String(r.value), W - 96, y + 42); ctx.textAlign = 'left';
    const color = o.kind === 'fire' ? FIRE : o.kind === 'forest' ? '#8B5E34' : (category(r.value)?.color ?? MUTED);
    ctx.fillStyle = LINE; roundRect(ctx, 150, y + 66, W - 246, 14, 7); ctx.fill();
    ctx.fillStyle = color; roundRect(ctx, 150, y + 66, Math.max(14, (W - 246) * (r.value / max)), 14, 7); ctx.fill();
    if (r.sub) { ctx.fillStyle = MUTED; ctx.font = `500 22px ${MONO}`; ctx.fillText(r.sub, 150, y + 112); }
    y += 122;
  });
  ctx.fillStyle = MUTED; ctx.font = `500 22px ${MONO}`; ctx.fillText(`${o.unit} · ${o.source}`, 96, H - 210);
}

export function drawCityCard(ctx: CanvasRenderingContext2D, o: {
  city: string; aqi: number; catLabel: string; verdict: string; when: string; lines: [string, string][]; source: string; site: string;
}) {
  base(ctx, o.site);
  const cat = category(o.aqi)!;
  ctx.fillStyle = MUTED; ctx.font = `500 32px ${SANS}`; ctx.fillText(o.when, 96, 230);
  ctx.fillStyle = INK; ctx.font = `700 72px ${SANS}`; ctx.fillText(fitText(ctx, o.city, W - 192), 96, 320);
  ctx.font = `700 260px ${SANS}`; ctx.fillText(String(o.aqi), 88, 580);
  const aqiW = ctx.measureText(String(o.aqi)).width;
  ctx.font = `600 40px ${SANS}`;
  const badgeW = Math.min(W - 96 - (130 + aqiW), ctx.measureText(o.catLabel).width + 48);
  ctx.fillStyle = cat.color; roundRect(ctx, 120 + aqiW, 470, badgeW, 70, 12); ctx.fill();
  ctx.fillStyle = cat.ink; ctx.fillText(fitText(ctx, o.catLabel, badgeW - 48), 144 + aqiW, 518);
  ctx.fillStyle = MUTED; ctx.font = `500 28px ${MONO}`; ctx.fillText('US AQI · PM2.5', 96, 640);
  ctx.fillStyle = INK; ctx.font = `600 44px ${SANS}`;
  let y = wrap(ctx, o.verdict, 96, 730, W - 192, 58, 3) + 30;
  for (const [k, v] of o.lines) {
    ctx.fillStyle = MUTED; ctx.font = `500 30px ${SANS}`; ctx.fillText(k, 96, y);
    ctx.fillStyle = INK; ctx.font = `600 34px ${SANS}`; ctx.textAlign = 'right'; ctx.fillText(fitText(ctx, v, 560), W - 96, y); ctx.textAlign = 'left';
    y += 62;
  }
  ctx.fillStyle = MUTED; ctx.font = `500 22px ${MONO}`; ctx.fillText(o.source, 96, H - 210);
}

export function drawForestCard(ctx: CanvasRenderingContext2D, o: {
  title: string; area: string; alerts: number; fires: number; dates: string; summary: string;
  labels: { area: string; alerts: string; fires: string }; site: string;
}) {
  base(ctx, o.site);
  ctx.fillStyle = '#8B5E34'; ctx.fillRect(96, 196, 26, 26);
  ctx.font = `700 26px ${SANS}`; ctx.fillText('FOREST LOSS · SATELLITE ALERTS', 138, 218);
  ctx.fillStyle = INK; ctx.font = `700 60px ${SANS}`;
  let y = wrap(ctx, o.title, 96, 310, W - 192, 70, 2);
  ctx.fillStyle = MUTED; ctx.font = `500 28px ${MONO}`; ctx.fillText(o.dates, 96, y + 10);
  // three stats
  const stats: [string, string, string][] = [[o.area, 'ha', o.labels.area], [String(o.alerts), '', o.labels.alerts], [String(o.fires), '', o.labels.fires]];
  const colW = (W - 192 - 40) / 3;
  stats.forEach(([v, unit, label], i) => {
    const x = 96 + i * (colW + 20), top = y + 60;
    ctx.strokeStyle = LINE; ctx.lineWidth = 2; roundRect(ctx, x, top, colW, 170, 18); ctx.stroke();
    ctx.fillStyle = i === 2 && o.fires > 0 ? FIRE : INK; ctx.font = `700 64px ${SANS}`; ctx.fillText(v, x + 24, top + 88);
    if (unit) { const w = ctx.measureText(v).width; ctx.fillStyle = MUTED; ctx.font = `500 30px ${SANS}`; ctx.fillText(unit, x + 32 + w, top + 88); }
    ctx.fillStyle = MUTED; ctx.font = `500 24px ${SANS}`; wrap(ctx, label, x + 24, top + 130, colW - 40, 28, 2);
  });
  ctx.fillStyle = INK; ctx.font = `500 34px ${SANS}`;
  if (o.summary) wrap(ctx, o.summary, 96, y + 320, W - 192, 46, 6);
  ctx.fillStyle = MUTED; ctx.font = `500 22px ${MONO}`; ctx.fillText('Global Forest Watch integrated alerts · NASA FIRMS', 96, H - 210);
}

// "Today's worst in Indonesia": three big rows, each with the colour of what it measures.
export function drawTodayCard(ctx: CanvasRenderingContext2D, o: {
  title: string; when: string; rows: { label: string; place: string; value: string; color: string }[]; source: string; site: string;
}) {
  base(ctx, o.site);
  ctx.fillStyle = MUTED; ctx.font = `500 30px ${SANS}`; ctx.fillText(o.when, 96, 230);
  ctx.fillStyle = INK; ctx.font = `700 64px ${SANS}`;
  let y = wrap(ctx, o.title, 96, 310, W - 192, 74, 2) + 40;
  for (const r of o.rows) {
    ctx.fillStyle = r.color; roundRect(ctx, 96, y, W - 192, 8, 4); ctx.fill();
    ctx.fillStyle = MUTED; ctx.font = `600 26px ${SANS}`; ctx.fillText(r.label, 96, y + 62);
    ctx.fillStyle = INK; ctx.font = `700 54px ${SANS}`; ctx.fillText(fitText(ctx, r.place, W - 192), 96, y + 130);
    ctx.fillStyle = r.color; ctx.font = `600 34px ${SANS}`; ctx.fillText(r.value, 96, y + 182);
    y += 236;
  }
  ctx.fillStyle = MUTED; ctx.font = `500 22px ${MONO}`; ctx.fillText(o.source, 96, H - 210);
}

// Render → PNG → native share sheet (phones), or download (desktop).
export async function shareCanvas(draw: (ctx: CanvasRenderingContext2D) => void, filename: string, text: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  try { await document.fonts?.ready; } catch { /* fonts optional */ }
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  draw(canvas.getContext('2d')!);
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], text }); return 'shared'; }
    catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}
