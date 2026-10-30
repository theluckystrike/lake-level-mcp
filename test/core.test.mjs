// Fixture tests. Upstream payloads in test/fixtures were saved from the live agencies on 2026-10-30
// (see DATA_SOURCES.md). Expected numbers were read off those payloads by hand (and cross-checked
// with a separate Python script), or copied from lakelevelnow.com's src/data files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LAKES, buildLevel, buildHistory, changeOver, downsampleDaily, parseCdecJson, parseCwmsJson, parseRiseJson,
  parseTwdbCsv, parseUsgsDvJson, parseUsgsRdb, resolveLake, searchLakes, seasonalTarget, fetchReading, compareLakes,
  getLakeLevel, LakeError,
} from '../dist/core.js';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const lake = (slug) => LAKES.find((l) => l.slug === slug);
const NOW = Date.parse('2026-10-30T00:00:00Z');

// A fetchText that serves saved payloads by URL substring, so the adapters run end to end offline.
const offline = (map) => async (url) => {
  for (const [k, f] of Object.entries(map)) if (url.includes(k)) return fx(f);
  throw new Error(`HTTP 503 (no fixture for ${url})`);
};

test('USGS IV RDB (Lake Travis 08154500): parse, latest value, 24 h change', () => {
  const pts = parseUsgsRdb(fx('usgs-iv-travis-08154500.rdb'));
  assert.equal(pts.length, 743);
  assert.deepEqual(pts[0], { t: '2026-09-28T20:00:00-05:00', v: 674.72 });
  assert.deepEqual(pts.at(-1), { t: '2026-10-29T18:00:00-05:00', v: 677.12 });
  assert.equal(changeOver(pts, 24, 12), -0.05); // 677.12 - 677.17 (2026-10-28 18:00 CDT)
});

test('USGS DV JSON (Lake Powell 09379900): 365 daily means, low and high', () => {
  const pts = parseUsgsDvJson(fx('usgs-dv-powell-09379900.json'));
  assert.equal(pts.length, 365);
  assert.deepEqual(pts[0], { t: '2025-10-29', v: 3545.2 });
  assert.deepEqual(pts.at(-1), { t: '2026-10-28', v: 3530.4 });
  const h = buildHistory(lake('lake-powell'), { series: pts, storage: [], agency: 'USGS', gaugeId: '09379900', param: '62614', sourceUrl: 's', dataUrl: 'd', pctFull: null, pctSource: null }, 365, 'daily', NOW);
  assert.equal(h.stats.min.ft, 3516.4);
  assert.equal(h.stats.max.ft, 3545.2);
  assert.equal(h.stats.change_ft, -14.8);
});

test('CDEC JSON (Shasta SHA): unpadded dates, elevation and storage sensors', () => {
  const { elev, storage } = parseCdecJson(fx('cdec-shasta-SHA.json'));
  assert.equal(elev.length, 32);
  assert.deepEqual(elev[0], { t: '2026-09-27', v: 982.45 });
  assert.deepEqual(elev.at(-1), { t: '2026-10-28', v: 973.26 });
  assert.deepEqual(storage.at(-1), { t: '2026-10-28', v: 2286738 });
});

test('CDEC end to end: Shasta 24 h / 7 d / 30 d change, feet below full pool, percent full', async () => {
  const r = await fetchReading(offline({ 'cdec.water.ca.gov': 'cdec-shasta-SHA.json' }), lake('lake-shasta'), 31, NOW);
  const lv = buildLevel(lake('lake-shasta'), r, NOW);
  assert.equal(lv.elevation_ft, 973.26);
  assert.deepEqual(lv.change_ft, { h24: -0.39, d7: -2.32, d30: -8.94 }); // 973.65, 975.58 (10-21), 982.20 (09-28)
  assert.equal(lv.ft_below_full_pool, 93.74); // 1067 - 973.26
  assert.equal(lv.pct_full, 50.2); // 2,286,738 / 4,552,000
  assert.equal(lv.fresh, true);
  assert.equal(lv.almanac, 'https://lakelevelnow.com/almanac/?utm_source=mcp&utm_medium=lake-level-mcp');
  assert.match(lv.more, /^https:\/\/lakelevelnow\.com\/lake\/lake-shasta\/\?utm_source=mcp&utm_medium=lake-level-mcp$/);
});

test('Reclamation RISE (Lake Mead items 6123/6124): level, change, percent full', async () => {
  const pts = parseRiseJson(fx('rise-mead-elev-6123.json'));
  assert.equal(pts.length, 32);
  const f = offline({ 'itemId=6123': 'rise-mead-elev-6123.json', 'itemId=6124': 'rise-mead-storage-6124.json' });
  const lv = buildLevel(lake('lake-mead'), await fetchReading(f, lake('lake-mead'), 31, NOW), NOW);
  assert.equal(lv.elevation_ft, 1038.38);
  assert.equal(lv.change_ft.h24, 0.09);
  assert.equal(lv.change_ft.d7, 1.19); // 1038.38 - 1037.19 (2026-10-21)
  assert.equal(lv.ft_below_full_pool, 190.62); // 1229 - 1038.38
  assert.equal(lv.pct_full, 23.7); // 6,866,580 / 28,945,000
  assert.equal(lv.almanac, null); // Mead is not one of the 19 almanac lakes on the site
});

test('TWDB CSV (Amistad): skips comment block, percent full from TWDB', async () => {
  const rows = parseTwdbCsv(fx('twdb-amistad-30day.csv'));
  assert.equal(rows.length, 31);
  assert.deepEqual(rows.at(-1), { t: '2026-10-29', v: 1063.05, pct: 46.0, storage: 921278 });
  const lv = buildLevel(lake('lake-amistad'), await fetchReading(offline({ 'amistad-30day': 'twdb-amistad-30day.csv' }), lake('lake-amistad'), 31, NOW), NOW);
  assert.equal(lv.change_ft.h24, 0.1);
  assert.equal(lv.change_ft.d7, 0.4); // 1063.05 - 1062.65 (2026-10-22)
  assert.equal(lv.ft_below_full_pool, 53.95); // 1117 - 1063.05
  assert.equal(lv.pct_full, 46);
});

test('USACE CWMS (Texoma DENI): hourly values, future-stamped points dropped', () => {
  const txt = fx('cwms-texoma-deni.json');
  const pts = parseCwmsJson(txt, NOW);
  assert.equal(pts.length, 168);
  assert.deepEqual(pts.at(-1), { t: '2026-10-29T23:00:00.000Z', v: 617.01 });
  assert.equal(changeOver(pts, 24, 12), 0.04); // 617.01 - 616.97
  // With "now" set 3 hours before the last stamp, the last 2 points (more than 15 min ahead) are dropped.
  assert.equal(parseCwmsJson(txt, Date.parse('2026-10-29T21:00:00Z')).length, 166);
});

test('Seasonal targets match the operator curves the site publishes', () => {
  const s = (slug, when) => seasonalTarget(lake(slug).seasonal.points, lake(slug).seasonal.interp, when);
  assert.equal(s('lake-lanier', '2026-10-30T12:00:00-04:00'), 1070.52); // 1071 -> 1070 between Oct 1 and Dec 1
  assert.equal(s('lake-texoma', '2026-10-30'), 618.37); // 616.5 -> 618.5 between Oct 1 and Nov 1
  assert.equal(s('kentucky-lake', '2026-04-14'), 356.5); // 354 -> 359 between Mar 30 and Apr 29
  assert.equal(s('wappapello-lake', '2026-10-30'), 359.74); // step curve, summer value holds to Dec 15
  assert.equal(s('wappapello-lake', '2027-01-10'), 354.74); // wraps the year end
  assert.equal(s('lake-allatoona', '2026-06-15'), 840);
});

test('Reference levels from lakelevelnow.com data: feet from full pool agrees with the site', () => {
  // src/data/levels.json on the site: Travis 677.24 ft -> 3.76 ft from full; Powell 3527.3 -> 172.7; Lanier 1063.09 -> 7.91.
  const one = (slug, t, v) => buildLevel(lake(slug), { series: [{ t, v }], storage: [], pctFull: null, pctSource: null, agency: 'USGS', gaugeId: 'x', param: 'p', sourceUrl: 's', dataUrl: 'd' }, NOW);
  assert.equal(one('lake-travis', '2026-10-26T02:15:00.000-05:00', 677.24).ft_below_full_pool, 3.76);
  assert.equal(one('lake-powell', '2026-10-25T23:45:00.000-07:00', 3527.3).ft_below_full_pool, 172.7);
  assert.equal(one('lake-lanier', '2026-10-26T03:15:00.000-04:00', 1063.09).ft_below_full_pool, 7.91);
  assert.equal(lake('lake-mead').fullPoolFt, 1229);
  assert.equal(lake('lake-texoma').fullPoolFt, 617);
});

test('Registry mirrors the site: 44 lakes, 43 live bindings, 19 almanac lakes, slugs unique', () => {
  assert.equal(LAKES.length, 44);
  assert.equal(LAKES.filter((l) => l.feed).length, 43);
  assert.equal(LAKES.filter((l) => l.almanac).length, 19);
  assert.equal(new Set(LAKES.map((l) => l.slug)).size, 44);
  assert.deepEqual(lake('lake-travis').feed, { type: 'usgs', site: '08154500', param: '00062' });
});

test('Search and resolve: by name, by state, ambiguity and unknown input', () => {
  assert.equal(resolveLake('Lake Travis').slug, 'lake-travis');
  assert.equal(resolveLake('mead').slug, 'lake-mead');
  assert.equal(resolveLake('Shasta').slug, 'lake-shasta');
  assert.equal(searchLakes(undefined, 'Oklahoma').length, 4);
  assert.equal(searchLakes(undefined, 'CA').length, 12);
  assert.ok(searchLakes('colorado river').some((l) => l.slug === 'lake-mead'));
  assert.throws(() => resolveLake('Lake Nowhere Atlantis'), LakeError);
  assert.throws(() => searchLakes(undefined, 'Narnia'), /Unknown state/);
});

test('Daily downsampling keeps the latest reading of each day', () => {
  const d = downsampleDaily([{ t: '2026-10-01T01:00:00-05:00', v: 1 }, { t: '2026-10-01T23:00:00-05:00', v: 2 }, { t: '2026-10-02T05:00:00-05:00', v: 3 }]);
  assert.deepEqual(d, [{ t: '2026-10-01', v: 2 }, { t: '2026-10-02', v: 3 }]);
  assert.equal(changeOver([{ t: '2026-10-01', v: 1 }, { t: '2026-10-20', v: 2 }], 7 * 24, 36), null); // gap gives null, not a wrong span
});

test('Upstream down: clear error naming the agency and the lake page; registry-only lake explained', async () => {
  await assert.rejects(getLakeLevel(offline({}), 'lake-texoma', NOW), /U\.S\. Army Corps of Engineers \(CWMS\) gauge for Lake Texoma did not return data .*lakelevelnow\.com\/lake\/lake-texoma\//);
  await assert.rejects(getLakeLevel(offline({}), 'high-rock-lake', NOW), /no public government gauge feed/);
});

test('USGS down for a Texas lake falls back to the TWDB record', async () => {
  const f = async (url) => { if (url.includes('usgs.gov')) throw new Error('HTTP 503'); throw new Error('unreachable'); };
  await assert.rejects(fetchReading(f, lake('lake-travis'), 31, NOW), /Lake Travis did not return data/);
  const g = offline({ 'travis-30day': 'twdb-amistad-30day.csv' }); // any TWDB-shaped body proves the path
  const r = await fetchReading(g, lake('lake-travis'), 31, NOW);
  assert.equal(r.agency, 'Texas Water Development Board');
});

test('compare_lakes: one gauge down does not fail the call; ranking by feet below full pool', async () => {
  const f = offline({ 'itemId=6123': 'rise-mead-elev-6123.json', 'itemId=6124': 'rise-mead-storage-6124.json', 'amistad-30day': 'twdb-amistad-30day.csv', 'cdec.water.ca.gov': 'cdec-shasta-SHA.json' });
  const out = await compareLakes(f, ['lake-mead', 'lake-amistad', 'lake-shasta', 'lake-texoma'], NOW);
  assert.deepEqual(out.ranked_by_ft_below_full_pool, ['lake-mead', 'lake-shasta', 'lake-amistad']);
  assert.equal(out.lakes.find((r) => r.slug === 'lake-texoma').ok, false);
  await assert.rejects(compareLakes(f, ['lake-mead'], NOW), /2 to 10/);
});
