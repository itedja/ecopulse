// Temporary: prints what Climate TRACE's public API returns for Indonesia, to design the emitters layer.
const B = 'https://api.climatetrace.org/v7';
const j = async (p: string) => { const r = await fetch(B + p); const t = await r.text(); return { status: r.status, body: t.length > 3000 ? t.slice(0, 3000) + '…' : t }; };
const show = async (label: string, p: string) => { const r = await j(p); console.log(`\n### ${label}  GET ${p} -> ${r.status}\n${r.body}`); };
await show('sectors', '/definitions/sectors');
await show('subsectors', '/definitions/subsectors');
await show('gases', '/definitions/gases');
await show('IDN total 2025', '/sources/emissions?gadmId=IDN&year=2025&gas=co2e_100yr');
for (const s of ['power', 'manufacturing', 'fossil-fuel-operations', 'mineral-extraction', 'waste'])
  await show(`top ${s} 2025`, `/sources?gadmId=IDN&year=2025&gas=co2e_100yr&sectors=${s}&limit=3`);
await show('top pm2_5 2025', '/sources?gadmId=IDN&year=2025&gas=pm2_5&limit=3');
await show('top so2 2025', '/sources?gadmId=IDN&year=2025&gas=so2&limit=3');
await show('top 2026', '/sources?gadmId=IDN&year=2026&gas=co2e_100yr&limit=2');
const top = await (await fetch(`${B}/sources?gadmId=IDN&year=2025&gas=co2e_100yr&sectors=power&limit=1`)).json().catch(() => null);
const id = Array.isArray(top) ? top[0]?.id : null;
if (id) await show('one source detail', `/sources/${id}`);
let n = 0; for (let off = 0; off < 20000; off += 1000) { const r = await (await fetch(`${B}/sources?gadmId=IDN&year=2025&gas=co2e_100yr&limit=1000&offset=${off}`)).json().catch(() => []); if (!Array.isArray(r) || !r.length) break; n += r.length; const pts = r.filter((x: { sourceType?: string }) => x.sourceType === 'point-source').length; console.log(`page ${off}: ${r.length} rows, point-source ${pts}, last ${r[r.length - 1]?.emissionsQuantity}`); }
console.log('total IDN sources 2025:', n);
