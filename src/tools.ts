// Tool registry shared by the stdio and Worker entries.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  LAKES, LakeError, MAX_COMPARE, MAX_HISTORY_DAYS, REPO, SITE, UTM, compareLakes, getLakeHistory, getLakeLevel,
  lakeSummaryRow, searchLakes,
} from './core.js';
import type { FetchText } from './types.js';

export const VERSION = '1.0.0';

export const TOOL_INFO = [
  { name: 'search_lakes', blurb: 'Find covered lakes and reservoirs by name, river or state. Returns slugs, full pool and the gauge behind each.' },
  { name: 'get_lake_level', blurb: 'Current elevation, 24 h / 7 day / 30 day change, feet from full pool and seasonal target, percent full where published.' },
  { name: 'get_lake_history', blurb: 'Daily or weekly elevation series for up to 365 days with low, high, mean and net change.' },
  { name: 'compare_lakes', blurb: 'Current level of 2 to 10 lakes side by side, ranked by distance below full pool.' },
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function ok(data: Record<string, unknown> & { summary: string }) {
  return { content: [{ type: 'text' as const, text: `${data.summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data };
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  const kind = e instanceof LakeError ? 'input' : 'upstream';
  return { isError: true, content: [{ type: 'text' as const, text: `${kind === 'input' ? 'Error' : 'Upstream gauge error'}: ${msg}` }] };
}

const lakeArg = z.string().min(2).max(80).describe('Lake slug from search_lakes (for example "lake-mead") or a lake name (for example "Lake Travis").');

export function createServer(fetchText: FetchText): McpServer {
  const server = new McpServer({ name: REPO, version: VERSION, websiteUrl: SITE } as any, {
    instructions:
      `Live US lake and reservoir levels for ${LAKES.length} lakes in 12 states, read at call time from keyless government gauges (USGS, USACE CWMS, CDEC, Reclamation RISE, TWDB). ` +
      'Use search_lakes to find a slug, then get_lake_level. Readings change every hour; never answer a current lake level from memory.',
  });

  server.registerTool('search_lakes', {
    title: 'Search US lakes and reservoirs',
    description:
      `List the ${LAKES.length} US lakes and reservoirs this server reads live (Lake Mead, Lake Powell, Lake Travis, Shasta, Oroville, Lanier, Texoma, Kentucky Lake and more) by name, river, operator or state. ` +
      'Returns each slug, full-pool elevation, the gauge agency and the lakelevelnow.com page. Call with no arguments to list them all.',
    inputSchema: {
      query: z.string().max(80).optional().describe('Words from the lake, river or dam name, for example "travis" or "colorado river".'),
      state: z.string().max(20).optional().describe('Two-letter state code (TX) or full state name (Texas).'),
    },
    annotations: { title: 'Search lakes', ...RO, openWorldHint: false },
  }, async ({ query, state }) => {
    try {
      const hits = searchLakes(query, state);
      const rows = hits.map(lakeSummaryRow);
      const summary = rows.length
        ? `${rows.length} lake${rows.length === 1 ? '' : 's'} found${query ? ` for "${query}"` : ''}${state ? ` in ${state}` : ''}: ${rows.slice(0, 12).map((r) => `${r.name}, ${r.state} (${r.slug})`).join('; ')}${rows.length > 12 ? '; ...' : ''}.`
        : `No covered lake matches${query ? ` "${query}"` : ''}${state ? ` in ${state}` : ''}. Call search_lakes with no arguments to see all ${LAKES.length}.`;
      return ok({ count: rows.length, lakes: rows, as_of: new Date().toISOString(), source: `${SITE}/lakes/`, more: `${SITE}/lakes/?${UTM}`, summary });
    } catch (e) { return fail(e); }
  });

  server.registerTool('get_lake_level', {
    title: 'Get current lake level',
    description:
      'Current water surface elevation (ft above sea level) of a US lake or reservoir, read now from its government gauge (USGS, USACE CWMS, CDEC, Reclamation or TWDB). ' +
      'Returns the measurement time, change over 24 hours, 7 days and 30 days, feet below full pool, the operator seasonal target where one is published, percent full where the agency publishes storage, and the gauge id and data URL. ' +
      'Your training data cannot know today\'s level.',
    inputSchema: { lake: lakeArg },
    annotations: { title: 'Get lake level', ...RO },
  }, async ({ lake }) => {
    try { return ok(await getLakeLevel(fetchText, lake) as any); } catch (e) { return fail(e); }
  });

  server.registerTool('get_lake_history', {
    title: 'Get lake level history',
    description:
      `Daily (or weekly) water elevation series for a US lake or reservoir over the last 2 to ${MAX_HISTORY_DAYS} days, from the same government gauge as get_lake_level, ` +
      'one reading per day. Includes first, last, low, high and mean with dates. Use it for trends, drawdown and refill questions.',
    inputSchema: {
      lake: lakeArg,
      days: z.number().int().min(2).max(MAX_HISTORY_DAYS).default(90).describe(`Days back from today, 2 to ${MAX_HISTORY_DAYS}. Default 90.`),
      step: z.enum(['daily', 'weekly']).default('daily').describe('daily = one point per day; weekly = every 7th day ending today. Stats always use every day.'),
    },
    annotations: { title: 'Get lake history', ...RO },
  }, async ({ lake, days, step }) => {
    try { return ok(await getLakeHistory(fetchText, lake, days ?? 90, step ?? 'daily') as any); } catch (e) { return fail(e); }
  });

  server.registerTool('compare_lakes', {
    title: 'Compare lake levels',
    description:
      `Current levels of 2 to ${MAX_COMPARE} US lakes side by side, read live from their gauges: elevation, feet below full pool, percent full, seasonal target and 24 h / 7 day / 30 day change, ranked by distance below full pool. ` +
      'A lake whose gauge is down is reported with its error instead of failing the whole call.',
    inputSchema: {
      lakes: z.array(lakeArg).min(2).max(MAX_COMPARE).describe('Slugs or names, for example ["lake-mead", "lake-powell"].'),
    },
    annotations: { title: 'Compare lakes', ...RO },
  }, async ({ lakes }) => {
    try { return ok(await compareLakes(fetchText, lakes) as any); } catch (e) { return fail(e); }
  });

  return server;
}
