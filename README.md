# lake-level-mcp

Live US lake and reservoir water levels for AI assistants, read at call time from USGS, USACE, CDEC, Reclamation and TWDB gauges.

This is a Model Context Protocol (MCP) server. It covers 44 lakes in 12 states, including Lake Mead, Lake Powell, Lake Travis, Shasta, Oroville, Folsom, Lake Lanier, Lake Texoma and Kentucky Lake. It needs no API key.

## Tools

| Tool | What it returns |
| --- | --- |
| `search_lakes` | Covered lakes by name, river, operator or state, with slug, full pool and gauge. |
| `get_lake_level` | Current elevation, measurement time, change over 24 hours, 7 days and 30 days, feet below full pool, the operator seasonal target where one is published, percent full where the agency publishes storage, gauge id and data URL. |
| `get_lake_history` | Daily or weekly elevation series for up to 365 days, with first, last, low, high and mean. |
| `compare_lakes` | 2 to 10 lakes side by side, ranked by feet below full pool. A lake whose gauge is down is reported, not fatal. |

Every result has structured JSON, a one-paragraph summary, `as_of`, `source` (the agency URL) and `more` (the lake page on [lakelevelnow.com](https://lakelevelnow.com)).

## What it knows that your model does not

- Today's water level. Lakes move every hour and a model's training data is months old.
- Which gauge to read for each lake. The bindings (USGS site and parameter, CDEC station, Reclamation RISE item, TWDB reservoir, USACE CWMS time series) are the verified set lakelevelnow.com uses.
- Full-pool elevations and published seasonal guide curves (USACE, TVA, Alabama Power), so "8 ft low" can be read against the winter target, not only against summer full pool.
- How to handle feed quirks: unpadded CDEC dates, CWMS loggers that stamp local time as UTC, USGS 15-minute data collapsed to one reading per day.

## Install

### Hosted (Claude.ai custom connector, ChatGPT developer mode)

Paste this URL. No token, no sign-up.

```
https://lake-level-mcp.lipmichal.workers.dev/mcp
```

### Claude Code

```
claude mcp add --transport http lake-level https://lake-level-mcp.lipmichal.workers.dev/mcp
```

Or run it locally over stdio:

```
claude mcp add lake-level -- npx -y github:theluckystrike/lake-level-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lake-level": { "command": "npx", "args": ["-y", "github:theluckystrike/lake-level-mcp"] }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "lake-level": { "url": "https://lake-level-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "lake-level": { "type": "http", "url": "https://lake-level-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

Node 20 or newer is needed for the local stdio version.

## Example prompts

- "What is the Lake Mead water level today, and how far below full pool is it?"
- "Is Lake Lanier above or below its winter guide curve right now?"
- "Show Lake Powell's level over the last year, weekly."
- "Compare Shasta, Oroville and Folsom: which is fullest?"
- "Which Texas lakes do you cover?"

## Data sources

All public and keyless. Full list with fetch dates in [DATA_SOURCES.md](DATA_SOURCES.md).

- USGS Water Services, instantaneous and daily values (waterservices.usgs.gov)
- California Department of Water Resources, CDEC (cdec.water.ca.gov)
- U.S. Bureau of Reclamation RISE API (data.usbr.gov)
- Texas Water Development Board, Water Data for Texas (waterdatafortexas.org)
- U.S. Army Corps of Engineers CWMS Data API (cwms-data.usace.army.mil)

Upstream answers are cached for 15 minutes (current level) or 1 hour (history) to respect the agencies' services.

## Limitations

- 44 lakes, the same set as lakelevelnow.com. High Rock Lake (NC) has no public government feed and returns a clear error.
- Readings are provisional agency data. CDEC, TWDB and Reclamation publish daily values, so their latest reading is usually yesterday's.
- USGS keeps about 120 days of 15-minute data. For longer history the server uses USGS daily means where the site publishes them, and TWDB's daily record for Texas lakes. Some gauges return less than 365 days; the result says how many days it covers.
- Percent full is shown only where the agency publishes storage (CDEC, Reclamation, TWDB).
- When an agency service is down, the tool returns an error that names the agency and links the lake page, which keeps the last published reading.

## More

Charts, boat ramp context and the paid Lake Level Almanac (decades of daily record and day-of-year normals per lake) are on [lakelevelnow.com](https://lakelevelnow.com/?utm_source=mcp&utm_medium=lake-level-mcp). The almanac covers 19 of these lakes: [lakelevelnow.com/almanac](https://lakelevelnow.com/almanac/?utm_source=mcp&utm_medium=lake-level-mcp).

Part of the Zovo MCP collection: https://mcp.zovo.one

## Development

```
npm install
npm test            # builds, then runs the fixture tests against saved agency payloads
node scripts/smoke-stdio.mjs   # live stdio check, one real call per tool
npx wrangler deploy            # Cloudflare Worker, Streamable HTTP at /mcp
```

`src/lakes.data.ts` is generated from the lakelevelnow.com data by `scripts/build-lakes.mjs`.

## License

MIT

<!-- data-servers:start -->
## More data servers from the same author

Each one is free, needs no API key and has a hosted URL you can paste into Claude or ChatGPT.

| server | tools | hosted URL |
|---|---|---|
| [cups-to-grams-mcp](https://github.com/theluckystrike/cups-to-grams-mcp) | convert_ingredient, search_ingredients, scale_recipe, convert_oven_temperature | `https://cups-to-grams-mcp.lipmichal.workers.dev/mcp` |
| [dscr-loan-calculator-mcp](https://github.com/theluckystrike/dscr-loan-calculator-mcp) | calculate_dscr, max_loan_for_target_dscr, rent_needed_for_target_dscr, compare_scenarios, amortization_summary | `https://dscr-loan-calculator-mcp.lipmichal.workers.dev/mcp` |
| [gold-price-per-gram-mcp](https://github.com/theluckystrike/gold-price-per-gram-mcp) | get_gold_price_per_gram, get_metal_prices, calculate_jewelry_value, convert_gold_units | `https://gold-price-per-gram-mcp.lipmichal.workers.dev/mcp` |
| [minimum-wage-mcp](https://github.com/theluckystrike/minimum-wage-mcp) | get_minimum_wage, list_upcoming_increases, compare_states, annual_income_at_minimum_wage | `https://minimum-wage-mcp.lipmichal.workers.dev/mcp` |
| [no-tax-on-overtime-mcp](https://github.com/theluckystrike/no-tax-on-overtime-mcp) | calculate_overtime_deduction, calculate_tips_deduction, calculate_senior_deduction, estimate_tax_savings, explain_eligibility | `https://no-tax-on-overtime-mcp.lipmichal.workers.dev/mcp` |
| [paycheck-calculator-mcp](https://github.com/theluckystrike/paycheck-calculator-mcp) | calculate_take_home_pay, compare_states_take_home, salary_to_hourly, hourly_to_salary, get_federal_tax_brackets | `https://paycheck-calculator-mcp.lipmichal.workers.dev/mcp` |
| [uk-income-tax-salary-mcp](https://github.com/theluckystrike/uk-income-tax-salary-mcp) | calculate_uk_take_home, get_uk_tax_bands, compare_salaries, marginal_rate_at_income | `https://uk-income-tax-salary-mcp.lipmichal.workers.dev/mcp` |
| [us-federal-holidays-business-days-mcp](https://github.com/theluckystrike/us-federal-holidays-business-days-mcp) | list_federal_holidays, is_business_day, add_business_days, count_business_days, invoice_due_date | `https://us-federal-holidays-business-days-mcp.lipmichal.workers.dev/mcp` |

The paid back-office collection (invoices, VAT, PDFs, spreadsheets) is at https://mcp.zovo.one
<!-- data-servers:end -->
