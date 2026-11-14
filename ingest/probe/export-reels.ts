// Temporary: exports the live numbers used in social videos.
import { writeFileSync } from 'node:fs';
import { db } from '../lib/db.ts';
const out: Record<string, unknown> = { at: new Date().toISOString() };
const pts = await db().rpc('repeat_fire_points'); if (pts.error) throw pts.error; out.repeatPoints = pts.data;
const prov = await db().from('repeat_fire_provinces').select('*').order('cells_3plus', { ascending: false }); if (prov.error) throw prov.error; out.repeatProvinces = prov.data;
const meta = await db().from('repeat_fire_meta').select('*'); out.repeatMeta = meta.data;
const em = await db().from('emission_sources').select('*'); if (em.error) throw em.error; out.emitters = em.data;
const provs = await db().from('provinces').select('id,name_en,name_id'); out.provinces = provs.data;
// Per-year counts for the 5/5 cells in West Kalimantan, for the year-by-year animation.
const cells = []; for (let off = 0; ; off += 1000) { const r = await db().from('repeat_fire_cells').select('lon,lat,years,n_years,province_id').gte('n_years', 3).range(off, off + 999); if (r.error) throw r.error; cells.push(...r.data); if (r.data.length < 1000) break; }
out.cells3 = cells;
writeFileSync('reels-data.json', JSON.stringify(out));
console.log('cells3', cells.length, 'emitters', (em.data ?? []).length);
