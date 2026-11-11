# EcoPulse Indonesia (PantauAlam)

Real-time environmental intelligence for Indonesia: air quality, fires, deforestation,
weather and community reports. Everything updates automatically; nobody enters data by hand.

## How data flows

| Job | Schedule (UTC) | Source | Writes to |
|---|---|---|---|
| `firms.yml` | every 3 h | NASA FIRMS (VIIRS NOAA-20/21, S-NPP) | `fire_hotspots` |
| `air-weather.yml` | every 30 min | OpenAQ v3, AQICN, Open-Meteo, BMKG (quakes + CAP warnings) | `aq_*`, `city_aq_snapshots`, `weather_forecasts`, `earthquakes` |
| `news.yml` | hourly | RSS feeds (Mongabay, Antara…) + Claude Haiku | `news_articles` |
| `maintenance.yml` | daily 19:41 (02:41 WIB) | — | deletes old data, expires reports, weekly province stats |
| `keepalive.yml` | 1st of each month | — | tiny commit so GitHub never pauses the schedules |

Every run is logged in the `ingestion_runs` table (Supabase → Table Editor), so failures are
visible without opening GitHub.

## Setup

1. **Database:** run `supabase/schema.sql` in Supabase → SQL Editor (safe to re-run).
   Files in `supabase/migrations/` are already included in `schema.sql`; run them alone only if
   your database was created from an older schema.
2. **Secrets:** GitHub → Settings → Secrets and variables → Actions:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FIRMS_MAP_KEY`, `AQICN_TOKEN`, `OPENAQ_API_KEY`,
   `ANTHROPIC_API_KEY` (news, later).
3. **First run:** GitHub → Actions → pick a workflow → **Run workflow**.

## Local development

```bash
npm install
npm test            # parser tests, no network or keys needed
npm run typecheck
```

## Data licences and attribution

- **AQICN / World Air Quality Index Project:** attribution to WAQI and the originating agency is
  required; data is unvalidated; only the last 6 hours are kept (no archiving), and it is not used
  for rankings. Free, non-commercial use.
- **OpenAQ:** used for history and the province leaderboard. Credit OpenAQ and the data provider.
- **NASA FIRMS:** fire data courtesy of NASA FIRMS (LANCE).
- **Open-Meteo:** free for non-commercial use, CC BY 4.0.
- **BMKG:** earthquake data and extreme-weather warnings (CAP) from Badan Meteorologi, Klimatologi, dan Geofisika.
- **Province borders:** "Indonesia GeoJSON & TopoJSON Maps (38 Provinces)" by denyherianto, CC BY 4.0
  (github.com/denyherianto/indonesia-geojson-topojson-maps-with-38-provinces); geometry repaired with ST_MakeValid.
- **News:** we store only the headline, link and our own AI-written summary. Article text stays with the publisher.

## Licence

MIT. See `LICENSE`.
