export type Feed =
  | { type: 'usgs'; site: string; param: string }
  | { type: 'cdec'; site: string }
  | { type: 'usbr'; site: string; elevItem: number; storageItem: number }
  | { type: 'twdb'; site: string }
  | { type: 'cwms'; office: string; site: string };

export interface SeasonalCurve {
  name: string;
  agency: string;
  interp: 'linear' | 'step' | string;
  points: [string, number][];
  source: string | null;
}

export interface Lake {
  slug: string;
  name: string;
  state: string;
  river: string | null;
  operator: string | null;
  fullPoolFt: number | null;
  capacityAf: number | null;
  feed: Feed | null;
  twdbName: string | null;
  seasonal: SeasonalCurve | null;
  almanac: boolean;
}

/** One reading. t is an ISO 8601 instant or a YYYY-MM-DD day. */
export interface Point {
  t: string;
  v: number;
}

export interface FetchOpts {
  accept?: string;
  timeoutMs?: number;
  /** Seconds the edge or memory cache may reuse the answer. */
  cacheTtl?: number;
}

export type FetchText = (url: string, opts?: FetchOpts) => Promise<string>;
