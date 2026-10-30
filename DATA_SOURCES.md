# Data sources

Every number this server returns is read at call time from the agency below, or copied from the
lakelevelnow.com data files. Fetch dates are the dates each source was fetched and checked for this build.

## Live gauge feeds (keyless, public)

| Agency | Endpoint | Used for | Fetched |
| --- | --- | --- | --- |
| USGS | https://waterservices.usgs.gov/nwis/iv/?format=rdb&sites=08154500&parameterCd=62614,00062&period=P31D | Instantaneous reservoir elevation (parameters 62614 and 00062, the bound one preferred) for 14 lakes | 2026-10-30 |
| USGS | https://waterservices.usgs.gov/nwis/dv/?format=json&sites=09379900&parameterCd=62614&statCd=00003 | Daily mean elevation for history beyond 32 days | 2026-10-30 |
| California DWR CDEC | https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=SHA&SensorNums=6,15&dur_code=D | Daily elevation (sensor 6) and storage (sensor 15) for 12 California reservoirs | 2026-10-30 (fetched through Cloudflare's network; it timed out from the build machine) |
| U.S. Bureau of Reclamation RISE | https://data.usbr.gov/rise/api/result?itemId=6123 | Daily elevation and storage for Lake Mead (6123/6124), Lake Mohave (6133/6134), Lake Havasu (6128/6129) | 2026-10-30 |
| Texas Water Development Board | https://www.waterdatafortexas.org/reservoirs/individual/amistad-30day.csv (and -1year.csv) | Daily water level and percent full for 7 Texas reservoirs; fallback for 8 USGS-gauged Texas lakes | 2026-10-30 |
| USACE CWMS Data API | https://cwms-data.usace.army.mil/cwms-data/timeseries?office=SWT&name=DENI.Elev.Inst.1Hour.0.Ccp-Rev | Hourly pool elevation for 7 Corps, TVA and Alabama Power reservoirs | 2026-10-30 |

The USGS replacement API (api.waterdata.usgs.gov/ogcapi/v0) was checked on 2026-10-30. It returned no
data for the LCRA gauge at Lake Travis (08154500), so this build stays on waterservices.usgs.gov, the
same service lakelevelnow.com uses.

## Reference data copied from lakelevelnow.com

Read from the site source (`src/data/`) on 2026-10-30 by `scripts/build-lakes.mjs`:

- `lakes.seed.json`: lake names, slugs, states, rivers, operators, full-pool elevations, storage capacities.
- `sources.json`: the verified feed binding for each lake (site comments say bindings were verified 2026-06-22 and 2026-10-26).
- `seasonal-pools.json`: seasonal target curves read by the site from the USACE CWMS Data API on 2026-10-26
  (Kentucky Lake, Lake Lanier, Lewis Smith Lake, Wappapello Lake, Lake Allatoona, Nolin River Lake, Lake Texoma).
  Each curve's own CWMS URL is returned in `seasonal_target.source`.
- `almanac.json`: the 19 lakes covered by the Lake Level Almanac.

## Test fixtures

`test/fixtures/` holds agency payloads saved on 2026-10-30:

- `usgs-iv-travis-08154500.rdb`: USGS IV, Lake Travis, 31 days. Reduced to the on-the-hour rows of the 5-minute record to keep it small; all other bytes are as served.
- `usgs-dv-powell-09379900.json`: USGS daily values, Lake Powell, 365 days.
- `cdec-shasta-SHA.json`: CDEC daily, Shasta, sensors 6 and 15.
- `rise-mead-elev-6123.json`, `rise-mead-storage-6124.json`: Reclamation RISE, Lake Mead.
- `twdb-amistad-30day.csv`: TWDB, Amistad Reservoir.
- `cwms-texoma-deni.json`: USACE CWMS, Lake Texoma (Denison Dam), 7 days hourly.
- `usgs-iv-allatoona-02393500.rdb`: USGS IV, Lake Allatoona, 8 days (the gauge publishes 00062, the binding names 62614).
- `twdb-travis-1year.csv`: TWDB, Lake Travis, 1 year.
