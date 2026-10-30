// Pure core for lake-level-mcp. The only I/O is the upstream gauge fetches, done through an
// injected fetchText so the Node and Worker entries can each supply their own cache.
import { LAKES, LAKES_DATA_AS_OF } from './lakes.data.js';
export { LAKES, LAKES_DATA_AS_OF };
export const REPO = 'lake-level-mcp';
export const SITE = 'https://lakelevelnow.com';
export const UTM = `utm_source=mcp&utm_medium=${REPO}`;
/** A reading older than this is reported as not fresh (same window as lakelevelnow.com). */
export const FRESH_DAYS = 7;
export const MAX_HISTORY_DAYS = 365;
export const MAX_COMPARE = 10;
export class LakeError extends Error {
}
export class UpstreamError extends Error {
}
// ---------------------------------------------------------------- lake lookup
const STATE_NAMES = {
    AL: 'Alabama', AZ: 'Arizona', CA: 'California', GA: 'Georgia', KY: 'Kentucky', MO: 'Missouri',
    NC: 'North Carolina', NV: 'Nevada', OK: 'Oklahoma', TX: 'Texas', UT: 'Utah', VA: 'Virginia',
};
const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['lake', 'lakes', 'reservoir', 'the', 'level', 'levels', 'water', 'of']);
const core = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w)).join(' ');
export function stateCode(input) {
    const s = input.trim();
    if (/^[A-Za-z]{2}$/.test(s))
        return s.toUpperCase();
    const hit = Object.entries(STATE_NAMES).find(([, n]) => norm(n) === norm(s));
    return hit ? hit[0] : null;
}
export function lakeUrl(lake) {
    return `${SITE}/lake/${lake.slug}/?${UTM}`;
}
export const ALMANAC_URL = `${SITE}/almanac/?${UTM}`;
function haystack(l) {
    return norm([l.name, l.slug, l.river ?? '', l.operator ?? '', l.state, STATE_NAMES[l.state] ?? ''].join(' '));
}
export function searchLakes(query, state) {
    let list = LAKES;
    if (state) {
        const code = stateCode(state);
        if (!code)
            throw new LakeError(`Unknown state "${state}". Use a two-letter code such as TX or a full name such as Texas.`);
        list = list.filter((l) => l.state === code);
    }
    if (query && query.trim()) {
        const words = core(query).split(' ').filter(Boolean);
        const q = norm(query);
        if (words.length === 0)
            return list;
        const scored = list
            .map((l) => {
            const h = haystack(l);
            const nameCore = core(l.name);
            let score = 0;
            if (l.slug === q.replace(/ /g, '-'))
                score += 100;
            if (nameCore === words.join(' '))
                score += 50;
            for (const w of words)
                if (h.split(' ').includes(w))
                    score += 10;
                else if (h.includes(w))
                    score += 4;
            const all = words.every((w) => h.includes(w));
            return { l, score: all ? score + 5 : 0 };
        })
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score || a.l.name.localeCompare(b.l.name));
        return scored.map((x) => x.l);
    }
    return [...list].sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
}
/** Resolve a slug or a lake name to exactly one lake, or throw a helpful error. */
export function resolveLake(input) {
    const raw = input.trim();
    const slug = norm(raw).replace(/ /g, '-');
    const exact = LAKES.find((l) => l.slug === slug || norm(l.name) === norm(raw));
    if (exact)
        return exact;
    const hits = searchLakes(raw);
    if (hits.length === 1)
        return hits[0];
    if (hits.length > 1) {
        const top = hits.filter((h) => core(h.name) === core(raw));
        if (top.length === 1)
            return top[0];
        throw new LakeError(`"${input}" matches ${hits.length} lakes: ${hits.slice(0, 8).map((h) => `${h.name}, ${h.state} (${h.slug})`).join('; ')}. Pass one slug.`);
    }
    throw new LakeError(`No lake matches "${input}". Call search_lakes to list the ${LAKES.length} covered lakes.`);
}
// ---------------------------------------------------------------- parsers (pure, fixture-tested)
const TZ_OFFSETS = {
    UTC: '+00:00', GMT: '+00:00', EST: '-05:00', EDT: '-04:00', CST: '-06:00', CDT: '-05:00',
    MST: '-07:00', MDT: '-06:00', PST: '-08:00', PDT: '-07:00', AKST: '-09:00', AKDT: '-08:00', HST: '-10:00',
};
/** USGS reservoir-elevation parameters: 62614 (ft above NGVD/NAVD) and 00062 (ft above datum). */
export const USGS_ELEV_PARAMS = ['62614', '00062'];
/**
 * USGS NWIS RDB (tab separated, '#' comments, header line, width line). A gauge can carry both
 * elevation parameters; the preferred one is used when it has values, else the other one with the
 * most values (some bindings name 62614 while the gauge publishes 00062, as at Allatoona).
 */
export function parseUsgsRdb(text, prefer) {
    const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
    if (lines.length < 2)
        return [];
    const header = lines[0].split('\t');
    const iDt = header.indexOf('datetime');
    const iTz = header.indexOf('tz_cd');
    const cols = header.map((h, i) => ({ i, m: /^\d+_(\d{5})$/.exec(h) })).filter((x) => x.m).map((x) => ({ i: x.i, param: x.m[1] }));
    if (iDt < 0 || !cols.length)
        return [];
    const rows = lines.slice(2).map((l) => l.split('\t'));
    const good = (c, i) => c[i] !== '' && c[i] !== undefined && Number.isFinite(Number(c[i])) && Number(c[i]) !== -999999;
    const counted = cols.map((c) => ({ ...c, n: rows.filter((r) => good(r, c.i)).length })).filter((c) => c.n > 0);
    if (!counted.length)
        return [];
    const pick = counted.find((c) => c.param === prefer) ?? counted.sort((a, b) => b.n - a.n)[0];
    const out = [];
    for (const c of rows) {
        if (!good(c, pick.i))
            continue;
        const off = TZ_OFFSETS[(c[iTz] ?? '').trim()] ?? '+00:00';
        const dt = String(c[iDt]).trim();
        const t = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(dt) ? `${dt.replace(' ', 'T')}:00${off}` : dt;
        out.push({ t, v: Number(c[pick.i]) });
    }
    out.param = pick.param;
    return out;
}
/** USGS NWIS daily values JSON (WaterML-JSON). Returns daily mean points, preferring the given parameter. */
export function parseUsgsDvJson(text, prefer) {
    const d = JSON.parse(text);
    const ts = (d?.value?.timeSeries ?? []).filter((t) => String(t?.name ?? '').endsWith(':00003') && (t.values?.[0]?.value ?? []).length);
    const mean = ts.find((t) => String(t.name).includes(`:${prefer}:`)) ?? ts[0];
    if (!mean)
        return [];
    return mean.values[0].value
        .map((p) => ({ t: String(p.dateTime).slice(0, 10), v: Number(p.value) }))
        .filter((p) => Number.isFinite(p.v) && p.v !== -999999);
}
/** CDEC JSONDataServlet rows. Sensor 6 = reservoir elevation (ft), 15 = storage (acre-feet). */
export function parseCdecJson(text) {
    const rows = JSON.parse(text);
    if (!Array.isArray(rows))
        return { elev: [], storage: [] };
    const pick = (sensor) => rows
        .filter((r) => String(r.SENSOR_NUM) === sensor && r.value !== null && r.value !== undefined && Number(r.value) !== -9999)
        .map((r) => {
        const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(r.date ?? r.obsDate));
        const t = m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : String(r.date);
        return { t, v: Number(r.value) };
    })
        .filter((p) => Number.isFinite(p.v))
        .sort((a, b) => a.t.localeCompare(b.t));
    return { elev: pick('6'), storage: pick('15') };
}
/** Reclamation RISE /rise/api/result JSON:API body. */
export function parseRiseJson(text) {
    const d = JSON.parse(text);
    return (d?.data ?? [])
        .map((r) => ({ t: String(r?.attributes?.dateTime ?? ''), v: Number(r?.attributes?.result) }))
        .filter((p) => p.t && Number.isFinite(p.v))
        .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}
/** Texas Water Development Board reservoir CSV ('#' comment block, then a header row). */
export function parseTwdbCsv(text) {
    const rows = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (rows.length < 2)
        return [];
    const header = rows[0].split(',');
    const iDate = header.indexOf('date');
    const iLvl = header.indexOf('water_level');
    const iPct = header.indexOf('percent_full');
    const iSto = header.indexOf('reservoir_storage');
    if (iDate < 0 || iLvl < 0)
        return [];
    const out = [];
    for (const r of rows.slice(1)) {
        const c = r.split(',');
        if (c.length !== header.length || !/^\d{4}-\d{2}-\d{2}$/.test(c[iDate]) || c[iLvl] === '')
            continue;
        const v = Number(c[iLvl]);
        if (!Number.isFinite(v))
            continue;
        const pct = iPct >= 0 && c[iPct] !== '' && Number.isFinite(Number(c[iPct])) ? Number(c[iPct]) : null;
        const storage = iSto >= 0 && c[iSto] !== '' && Number.isFinite(Number(c[iSto])) ? Number(c[iSto]) : null;
        out.push({ t: c[iDate], v, pct, storage });
    }
    return out;
}
/** USACE CWMS Data API timeseries JSON. Drops points stamped later than now + 15 min (some loggers stamp local time as UTC). */
export function parseCwmsJson(text, nowMs) {
    const d = JSON.parse(text);
    return (d?.values ?? [])
        .filter((x) => Array.isArray(x) && x[1] !== null && Number.isFinite(Number(x[1])) && x[0] <= nowMs + 15 * 60000)
        .map((x) => ({ t: new Date(x[0]).toISOString(), v: Math.round(Number(x[1]) * 100) / 100 }));
}
// ---------------------------------------------------------------- series math (pure)
const ms = (t) => (/^\d{4}-\d{2}-\d{2}$/.test(t) ? Date.parse(`${t}T12:00:00Z`) : Date.parse(t));
const r2 = (x) => Math.round(x * 100) / 100;
/** One point per calendar day (the day as written in the timestamp), keeping the latest reading of each day. */
export function downsampleDaily(points) {
    const byDay = new Map();
    for (const p of points) {
        const day = p.t.slice(0, 10);
        const prev = byDay.get(day);
        if (!prev || ms(p.t) >= ms(prev.t))
            byDay.set(day, p);
    }
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, p]) => ({ t: day, v: p.v }));
}
/**
 * Change from the reading closest to `hours` before the latest one. The base reading must lie
 * within `tolHours` of that target, so a gap in the record gives null instead of a wrong span.
 */
export function changeOver(points, hours, tolHours) {
    if (points.length < 2)
        return null;
    const last = points[points.length - 1];
    const target = ms(last.t) - hours * 3600000;
    let best = null;
    let bestGap = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
        const gap = Math.abs(ms(points[i].t) - target);
        if (gap < bestGap) {
            bestGap = gap;
            best = points[i];
        }
    }
    if (!best || bestGap > tolHours * 3600000)
        return null;
    return r2(last.v - best.v);
}
const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
/** Day of a 365-day year (0-364) for "MM-DD"; Feb 29 counts as Feb 28. Same rule as lakelevelnow.com. */
const doyMD = (md) => {
    const [m, d] = md.split('-').map(Number);
    return CUM[m - 1] + Math.min(d, m === 2 ? 28 : d) - 1;
};
/**
 * Seasonal target elevation from an operator curve of [MM-DD, ft] breakpoints that repeats each year.
 * `when` is the reading's timestamp; its calendar date is used as written by the feed, never shifted
 * to UTC (the lakelevelnow.com rule). Ported from the site's src/lib/seasonal.ts curveAt().
 */
export function seasonalTarget(points, interp, when) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(when);
    if (!m || !points.length)
        return null;
    const doy = doyMD(`${m[2]}-${m[3]}`);
    const pts = points.map(([md, v]) => ({ d: doyMD(md), v })).sort((a, b) => a.d - b.d);
    let prev = pts[pts.length - 1];
    let next = pts[0];
    let prevD = prev.d - 365;
    let nextD = next.d;
    for (let i = 0; i < pts.length; i++) {
        if (pts[i].d <= doy) {
            prev = pts[i];
            prevD = pts[i].d;
            next = pts[(i + 1) % pts.length];
            nextD = i + 1 < pts.length ? next.d : next.d + 365;
        }
    }
    if (doy < pts[0].d) {
        prev = pts[pts.length - 1];
        prevD = prev.d - 365;
        next = pts[0];
        nextD = next.d;
    }
    const target = interp === 'step' || nextD === prevD ? prev.v : prev.v + ((next.v - prev.v) * (doy - prevD)) / (nextD - prevD);
    return r2(target);
}
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const TIMEOUT = 15000;
function agencyOf(feed) {
    return { usgs: 'USGS', cdec: 'California DWR (CDEC)', usbr: 'U.S. Bureau of Reclamation', twdb: 'Texas Water Development Board', cwms: 'U.S. Army Corps of Engineers (CWMS)' }[feed.type];
}
function wrap(lake, feed, e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new UpstreamError(`${agencyOf(feed)} gauge for ${lake.name} did not return data (${msg}). The upstream service may be down; try again in a few minutes. The last published reading is on ${lakeUrl(lake)}`);
}
async function usgs(fetchText, feed, days, nowMs, ttl) {
    const params = USGS_ELEV_PARAMS.join(',');
    const ivUrl = `https://waterservices.usgs.gov/nwis/iv/?format=rdb&sites=${feed.site}&parameterCd=${params}&siteStatus=all&period=P${days}D`;
    if (days > 32) {
        const dvUrl = `https://waterservices.usgs.gov/nwis/dv/?format=json&sites=${feed.site}&parameterCd=${params}&statCd=00003&startDT=${ymd(nowMs - days * 86400000)}&endDT=${ymd(nowMs)}`;
        try {
            const pts = parseUsgsDvJson(await fetchText(dvUrl, { timeoutMs: TIMEOUT, cacheTtl: ttl }), feed.param);
            if (pts.length)
                return { series: pts, dataUrl: dvUrl, param: 'daily mean reservoir elevation', kind: 'dv' };
        }
        catch { /* fall through to instantaneous values */ }
    }
    const pts = parseUsgsRdb(await fetchText(ivUrl, { accept: 'text/plain', timeoutMs: TIMEOUT, cacheTtl: ttl }), feed.param);
    return { series: pts, dataUrl: ivUrl, param: `${pts.param ?? feed.param} reservoir elevation`, kind: 'iv' };
}
/** Fetch a lake's series covering at least `days` days. Throws UpstreamError with a plain message. */
export async function fetchReading(fetchText, lake, days, nowMs = Date.now()) {
    const feed = lake.feed;
    if (!feed) {
        throw new LakeError(`${lake.name} has no public government gauge feed that this server can read. Reference data is on ${lakeUrl(lake)}`);
    }
    const ttl = days > 32 ? 3600 : 900;
    try {
        if (feed.type === 'usgs') {
            try {
                const r = await usgs(fetchText, feed, days, nowMs, ttl);
                if (!r.series.length)
                    throw new Error('empty series');
                // USGS keeps about 120 days of instantaneous values. When a long history had to come from
                // them (no daily means), a Texas lake's TWDB daily record covers the full year instead.
                if (days > 32 && r.kind === 'iv' && lake.twdbName && ms(r.series[0].t) > nowMs - (days - 3) * 86400000) {
                    try {
                        return await twdb(fetchText, lake.twdbName, days, ttl, null);
                    }
                    catch { /* keep the shorter USGS record */ }
                }
                return {
                    series: r.series, storage: [], pctFull: null, pctSource: null, agency: 'USGS', gaugeId: feed.site, param: r.param,
                    sourceUrl: `https://waterdata.usgs.gov/monitoring-location/USGS-${feed.site}/`, dataUrl: r.dataUrl,
                };
            }
            catch (e) {
                // Texas lakes on a USGS gauge also have a TWDB daily record; use it when USGS is down.
                if (!lake.twdbName)
                    throw e;
                return await twdb(fetchText, lake.twdbName, days, ttl, `USGS failed: ${e instanceof Error ? e.message : e}`);
            }
        }
        if (feed.type === 'twdb')
            return await twdb(fetchText, feed.site, days, ttl, null);
        if (feed.type === 'cdec') {
            const url = `https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=${feed.site}&SensorNums=6,15&dur_code=D&Start=${ymd(nowMs - (days + 2) * 86400000)}&End=${ymd(nowMs)}`;
            const { elev, storage } = parseCdecJson(await fetchText(url, { timeoutMs: 20000, cacheTtl: ttl }));
            if (!elev.length)
                throw new Error('no elevation readings in range');
            const lastSto = storage.length ? storage[storage.length - 1].v : null;
            const pct = lake.capacityAf && lastSto != null ? Math.round((lastSto / lake.capacityAf) * 1000) / 10 : null;
            return {
                series: elev, storage, pctFull: pct, pctSource: pct != null ? `CDEC storage / ${lake.capacityAf.toLocaleString('en-US')} acre-feet capacity` : null,
                agency: 'California DWR (CDEC)', gaugeId: feed.site, param: 'sensor 6 reservoir elevation',
                sourceUrl: `https://cdec.water.ca.gov/dynamicapp/QueryF?s=${feed.site}`, dataUrl: url,
            };
        }
        if (feed.type === 'usbr') {
            const after = ymd(nowMs - (days + 2) * 86400000);
            const u = (item) => `https://data.usbr.gov/rise/api/result?itemId=${item}&dateTime%5Bafter%5D=${after}&itemsPerPage=${Math.min(days + 10, 400)}`;
            const opts = { accept: 'application/vnd.api+json', timeoutMs: 20000, cacheTtl: ttl };
            const [elevTxt, stoTxt] = await Promise.all([fetchText(u(feed.elevItem), opts), fetchText(u(feed.storageItem), opts).catch(() => '')]);
            const elev = parseRiseJson(elevTxt);
            const storage = stoTxt ? parseRiseJson(stoTxt) : [];
            if (!elev.length)
                throw new Error('no elevation readings in range');
            const lastSto = storage.length ? storage[storage.length - 1].v : null;
            const pct = lake.capacityAf && lastSto != null ? Math.round((lastSto / lake.capacityAf) * 1000) / 10 : null;
            return {
                series: elev, storage, pctFull: pct, pctSource: pct != null ? `Reclamation storage / ${lake.capacityAf.toLocaleString('en-US')} acre-feet capacity` : null,
                agency: 'U.S. Bureau of Reclamation', gaugeId: `RISE item ${feed.elevItem}`, param: 'daily reservoir elevation',
                sourceUrl: `https://data.usbr.gov/rise/api/result?itemId=${feed.elevItem}`, dataUrl: u(feed.elevItem),
            };
        }
        // cwms
        const qs = new URLSearchParams({
            office: feed.office, name: feed.site, unit: 'EN', 'page-size': '10000',
            begin: new Date(nowMs - (days + 2) * 86400000).toISOString().slice(0, 13) + ':00:00Z',
            end: new Date(nowMs + 86400000).toISOString().slice(0, 13) + ':00:00Z',
        });
        const url = `https://cwms-data.usace.army.mil/cwms-data/timeseries?${qs}`;
        const pts = parseCwmsJson(await fetchText(url, { accept: 'application/json;version=2', timeoutMs: 20000, cacheTtl: ttl }), nowMs);
        if (!pts.length)
            throw new Error('no readings in range');
        return {
            series: pts, storage: [], pctFull: null, pctSource: null, agency: 'U.S. Army Corps of Engineers (CWMS)',
            gaugeId: `${feed.office} ${feed.site}`, param: 'pool elevation', sourceUrl: url, dataUrl: url,
        };
    }
    catch (e) {
        if (e instanceof LakeError)
            throw e;
        throw wrap(lake, feed, e);
    }
}
async function twdb(fetchText, name, days, ttl, note) {
    const url = `https://www.waterdatafortexas.org/reservoirs/individual/${name}-${days > 31 ? '1year' : '30day'}.csv`;
    const rows = parseTwdbCsv(await fetchText(url, { accept: 'text/csv,text/plain', timeoutMs: 30000, cacheTtl: ttl }));
    if (!rows.length)
        throw new Error(`TWDB ${name}: empty CSV${note ? `; ${note}` : ''}`);
    const last = rows[rows.length - 1];
    return {
        series: rows.map((r) => ({ t: r.t, v: r.v })),
        storage: rows.filter((r) => r.storage != null).map((r) => ({ t: r.t, v: r.storage })),
        pctFull: last.pct, pctSource: last.pct != null ? 'TWDB percent of conservation capacity' : null,
        agency: 'Texas Water Development Board', gaugeId: name, param: 'daily water level',
        sourceUrl: `https://www.waterdatafortexas.org/reservoirs/individual/${name}`, dataUrl: url,
    };
}
// ---------------------------------------------------------------- tool logic
const fmt = (x, d = 2) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (x) => `${x > 0 ? '+' : x < 0 ? '-' : ''}${fmt(Math.abs(x))} ft`;
export function lakeSummaryRow(l) {
    return {
        slug: l.slug, name: l.name, state: l.state, river: l.river, operator: l.operator,
        full_pool_ft: l.fullPoolFt, live_feed: l.feed ? agencyOf(l.feed) : null,
        gauge_id: l.feed ? ('site' in l.feed ? l.feed.site : null) : null,
        almanac: l.almanac, more: lakeUrl(l),
    };
}
export function buildLevel(lake, r, nowMs) {
    const last = r.series[r.series.length - 1];
    const lastMs = ms(last.t);
    const ageH = Math.max(0, Math.round(((nowMs - lastMs) / 3600000) * 10) / 10);
    const fresh = ageH <= FRESH_DAYS * 24;
    const daily = downsampleDaily(r.series);
    const h24 = changeOver(r.series, 24, 12);
    const d7 = changeOver(daily, 7 * 24, 36);
    const d30 = changeOver(daily, 30 * 24, 72);
    const below = lake.fullPoolFt != null ? r2(lake.fullPoolFt - last.v) : null;
    let seasonal = null;
    if (lake.seasonal) {
        const target = seasonalTarget(lake.seasonal.points, lake.seasonal.interp, last.t);
        if (target != null)
            seasonal = { name: lake.seasonal.name, target_ft: target, ft_vs_target: r2(last.v - target), agency: lake.seasonal.agency, source: lake.seasonal.source };
    }
    const storage = r.storage.length ? r.storage[r.storage.length - 1].v : null;
    const parts = [];
    parts.push(`${lake.name} (${lake.state}) is at ${fmt(last.v)} ft above sea level per the ${r.agency} gauge, measured ${last.t}.`);
    if (below != null)
        parts.push(Math.abs(below) < 0.05 ? `That is at full pool (${fmt(lake.fullPoolFt, 1)} ft).` : `That is ${fmt(Math.abs(below))} ft ${below > 0 ? 'below' : 'above'} full pool (${fmt(lake.fullPoolFt, 1)} ft).`);
    if (seasonal)
        parts.push(`The ${seasonal.agency} ${seasonal.name} for this date is ${fmt(seasonal.target_ft)} ft, so the lake is ${signed(seasonal.ft_vs_target)} against its seasonal target.`);
    if (r.pctFull != null)
        parts.push(`It is ${r.pctFull}% full (${r.pctSource}).`);
    const ch = [h24 != null ? `${signed(h24)} in 24 h` : null, d7 != null ? `${signed(d7)} in 7 days` : null, d30 != null ? `${signed(d30)} in 30 days` : null].filter(Boolean);
    if (ch.length)
        parts.push(`Change: ${ch.join(', ')}.`);
    if (!fresh)
        parts.push(`Warning: this reading is ${Math.round(ageH / 24)} days old, so the gauge may be offline or delayed.`);
    return {
        lake: { slug: lake.slug, name: lake.name, state: lake.state, river: lake.river, operator: lake.operator },
        elevation_ft: last.v,
        measured_at: last.t,
        age_hours: ageH,
        fresh,
        change_ft: { h24, d7, d30 },
        full_pool_ft: lake.fullPoolFt,
        ft_below_full_pool: below,
        seasonal_target: seasonal,
        storage_af: storage,
        pct_full: r.pctFull,
        pct_full_basis: r.pctSource,
        gauge: { agency: r.agency, id: r.gaugeId, parameter: r.param, data_url: r.dataUrl },
        as_of: new Date(nowMs).toISOString(),
        source: r.sourceUrl,
        more: lakeUrl(lake),
        almanac: lake.almanac ? ALMANAC_URL : null,
        summary: parts.join(' '),
    };
}
export async function getLakeLevel(fetchText, input, nowMs = Date.now()) {
    const lake = resolveLake(input);
    const r = await fetchReading(fetchText, lake, 31, nowMs);
    return buildLevel(lake, r, nowMs);
}
export function buildHistory(lake, r, days, step, nowMs) {
    const cutoff = ymd(nowMs - days * 86400000);
    let daily = downsampleDaily(r.series).filter((p) => p.t >= cutoff);
    if (!daily.length)
        throw new UpstreamError(`${r.agency} returned no readings for ${lake.name} in the last ${days} days. See ${lakeUrl(lake)}`);
    if (step === 'weekly') {
        const lastIdx = daily.length - 1;
        daily = daily.filter((_, i) => (lastIdx - i) % 7 === 0);
    }
    const all = downsampleDaily(r.series).filter((p) => p.t >= cutoff);
    let min = all[0];
    let max = all[0];
    for (const p of all) {
        if (p.v < min.v)
            min = p;
        if (p.v > max.v)
            max = p;
    }
    const first = all[0];
    const last = all[all.length - 1];
    const mean = r2(all.reduce((s, p) => s + p.v, 0) / all.length);
    const coveredDays = Math.round((ms(last.t) - ms(first.t)) / 86400000);
    const shortNote = coveredDays < days - 3 ? ` The gauge record returned covers ${coveredDays} days, less than the ${days} requested.` : '';
    const summary = `${lake.name} daily elevation from ${first.t} to ${last.t} (${all.length} days, ${r.agency}): ` +
        `from ${fmt(first.v)} ft to ${fmt(last.v)} ft, a change of ${signed(r2(last.v - first.v))}. ` +
        `Low ${fmt(min.v)} ft on ${min.t}, high ${fmt(max.v)} ft on ${max.t}, mean ${fmt(mean)} ft.` +
        (lake.fullPoolFt != null ? ` Full pool is ${fmt(lake.fullPoolFt, 1)} ft.` : '') + shortNote +
        (lake.almanac ? ` Decades of daily record and day-of-year normals for this lake are in the Lake Level Almanac.` : '');
    return {
        lake: { slug: lake.slug, name: lake.name, state: lake.state },
        unit: 'ft above sea level',
        step,
        days_requested: days,
        days_covered: coveredDays,
        points: daily.map((p) => ({ date: p.t, elevation_ft: p.v })),
        stats: { first: { date: first.t, ft: first.v }, last: { date: last.t, ft: last.v }, change_ft: r2(last.v - first.v), min: { date: min.t, ft: min.v }, max: { date: max.t, ft: max.v }, mean_ft: mean },
        full_pool_ft: lake.fullPoolFt,
        gauge: { agency: r.agency, id: r.gaugeId, parameter: r.param, data_url: r.dataUrl },
        as_of: new Date(nowMs).toISOString(),
        source: r.sourceUrl,
        more: lakeUrl(lake),
        almanac: lake.almanac ? ALMANAC_URL : null,
        summary,
    };
}
export async function getLakeHistory(fetchText, input, days, step, nowMs = Date.now()) {
    if (!Number.isInteger(days) || days < 2 || days > MAX_HISTORY_DAYS)
        throw new LakeError(`days must be a whole number from 2 to ${MAX_HISTORY_DAYS}.`);
    const lake = resolveLake(input);
    const r = await fetchReading(fetchText, lake, days, nowMs);
    return buildHistory(lake, r, days, step, nowMs);
}
export async function compareLakes(fetchText, inputs, nowMs = Date.now()) {
    if (inputs.length < 2 || inputs.length > MAX_COMPARE)
        throw new LakeError(`Pass 2 to ${MAX_COMPARE} lakes.`);
    const lakes = inputs.map(resolveLake);
    const unique = [...new Map(lakes.map((l) => [l.slug, l])).values()];
    const rows = new Array(unique.length);
    let next = 0;
    const worker = async () => {
        while (next < unique.length) {
            const i = next++;
            const l = unique[i];
            try {
                const lv = buildLevel(l, await fetchReading(fetchText, l, 31, nowMs), nowMs);
                rows[i] = {
                    slug: l.slug, name: l.name, state: l.state, ok: true, elevation_ft: lv.elevation_ft, measured_at: lv.measured_at, fresh: lv.fresh,
                    full_pool_ft: lv.full_pool_ft, ft_below_full_pool: lv.ft_below_full_pool, pct_full: lv.pct_full,
                    ft_vs_seasonal_target: lv.seasonal_target?.ft_vs_target ?? null, change_ft: lv.change_ft,
                    gauge: `${lv.gauge.agency} ${lv.gauge.id}`, source: lv.source, more: lv.more,
                };
            }
            catch (e) {
                rows[i] = { slug: l.slug, name: l.name, state: l.state, ok: false, error: e instanceof Error ? e.message : String(e), more: lakeUrl(l) };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker));
    const ok = rows.filter((r) => r.ok && r.ft_below_full_pool != null);
    const ranked = [...ok].sort((a, b) => b.ft_below_full_pool - a.ft_below_full_pool);
    const parts = [`Compared ${unique.length} lakes; ${rows.filter((r) => r.ok).length} gauges answered.`];
    if (ranked.length >= 2) {
        const lo = ranked[0];
        const hi = ranked[ranked.length - 1];
        parts.push(`Farthest below full pool: ${lo.name} at ${fmt(lo.ft_below_full_pool)} ft below. Closest to full: ${hi.name} at ${fmt(Math.abs(hi.ft_below_full_pool))} ft ${hi.ft_below_full_pool >= 0 ? 'below' : 'above'}.`);
    }
    const failed = rows.filter((r) => !r.ok);
    if (failed.length)
        parts.push(`No data from: ${failed.map((r) => r.name).join(', ')}.`);
    return {
        lakes: rows,
        ranked_by_ft_below_full_pool: ranked.map((r) => r.slug),
        as_of: new Date(nowMs).toISOString(),
        source: 'https://waterservices.usgs.gov/ (and CDEC, USBR RISE, TWDB, USACE CWMS per lake; see each row)',
        more: `${SITE}/lakes/?${UTM}`,
        summary: parts.join(' '),
    };
}
