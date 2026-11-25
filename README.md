# NerdPulse Banking Marketplace — High-Performance Consumer Banking SSR, Zero-CLS A/B & SEO/CWV Harness

> **Synthetic Data Disclaimer:** All bank names, APY percentages, editorial star ratings, and partner flags in this project are **illustrative synthetic demo fixtures** — never live financial offers or financial advice.

---

## Architecture Overview

```text
+-------------------------------------------------------------------------------+
|               Node.js + TypeScript Zero-Bloat SSR Application                 |
|  GET /                      True SSR HYSA & CD Marketplace (< 44 KB HTML)     |
|  GET /api/products          Personalized Compound APY + Fee-Drag API          |
|  POST /api/telemetry/vitals RUM Core Web Vitals (LCP/INP/CLS/TTFB) + Events   |
|  GET /api/telemetry/summary Live p75 CWV Status + Variant Funnel + SRM Health |
|  GET /api/audit             Live Spec-Driven SEO/CWV/WCAG/Compliance Audit    |
|  GET /sitemap.xml & /robots.txt  Production Technical SEO Endpoints           |
+-----------------------------+-------------------------------+-----------------+
                              |                               |
                              v                               v
+----------------------------------------+      +-------------------------------+
|       Core Domain & Compliance         |      |   Zero-CLS A/B & SEO Engine   |
|  - src/domain/banking.ts               |      |  - src/domain/experiments.ts  |
|    * Reg DD monthly APY compounding    |      |    * SHA-256 server bucketing |
|    * Blended & threshold balance tiers |      |    * Configurable holdouts    |
|    * Promo APY cliffs & fee waivers    |      |    * Exposure deduplication   |
|    * 72h Rate Freshness Guardrail      |      |    * Pearson Chi-Square SRM   |
|    * Editorial Independence invariants |      |  - src/domain/seo.ts          |
+----------------------------------------+      |    * XSS-safe JSON-LD @graph  |
                                                |    * Cache-Control SWR + Vary |
                                                +---------------+---------------+
                                                                |
                                                                v
                                                +-------------------------------+
                                                |  Spec-Driven Audit Harness    |
                                                |  - src/audit/harness.ts       |
                                                |  - src/audit/cli.ts           |
                                                |  14 automated CWV/SEO/A11y/   |
                                                |  FinTech compliance gates     |
                                                +-------------------------------+
```

---

## Core Engineering Highlights

1. **Reg DD Compound APY & Net Return Personalization (`src/domain/banking.ts`)**
   - Converts annual APY to exact Reg DD monthly compounding rate `(1 + APY)^(1/12) - 1`.
   - Models **monthly fee drag & minimum-balance fee waivers** (e.g., `$12/mo` waived at `$15,000+`), **promotional intro APY cliffs** (e.g., `5.25%` for 3 months reverting to `4.10%`), and both **blended marginal** and **balance-threshold** APY tiers.
   - **72-Hour Rate Freshness Guardrail:** Automatically flags rates older than `maxStaleHours` (`72h`) and either excludes (`stalePolicy: 'exclude'`, default public safety mode) or strictly demotes (`stalePolicy: 'demote'`) them so consumer financial pages never advertise expired yields.
   - **Editorial Independence Invariant:** Paid partner status (`isPartner`) renders explicit disclosure badges (`Partner` vs `Independent`) and **never** inflates `editorialRating` or algorithmic rankings (`best_net_yield`, `highest_apy`, `no_min_balance`, `editorial_pick`).

2. **Zero-CLS Server-Side A/B Experimentation & SRM Detection (`src/domain/experiments.ts`)**
   - Deterministic `SHA-256(experimentKey:salt:visitorId)` bucketing runs **before the first HTML byte**, eliminating client-side layout flicker (`CLS = 0`).
   - Ships with two live server-rendered marketplace layouts under `hysa_layout_v1`:
     - `hero_calc_above_fold` (50% Control): Hero + full interactive Yield Calculator above the fold, followed by the ranked comparison table.
     - `comparison_table_first` (50% Treatment): High-intent comparison table immediately above the fold with compact calculator controls.
   - Tracks deduplicated unique visitor exposures (`impression`) and conversions (`calculator_interact`, `partner_click`), and runs an exact **Pearson chi-square Sample Ratio Mismatch (SRM)** goodness-of-fit test (`p < 0.001`) using an upper regularized incomplete gamma function supporting arbitrary variant counts + holdout groups.

3. **Technical SEO & XSS-Hardened Structured Data (`src/domain/seo.ts`)**
   - Emits a single valid Schema.org `@graph` containing `BreadcrumbList`, `ItemList` of `FinancialProduct` offers (`BankOrCreditUnion`, `annualPercentageRate`, `feesAndCommissionsSpecification`, `AggregateRating`), and `FAQPage`.
   - `safeJsonLdSerialize()` escapes `<`, `>`, `&`, `\u2028`, and `\u2029` to eliminate `</script>` breakout XSS vectors while keeping JSON 100% parser-compliant.
   - Configures CDN edge headers (`Cache-Control: public, s-maxage=300, stale-while-revalidate=3600`, `Vary: Accept-Encoding, Cookie, X-Experiment-Variant`, `Server-Timing`, `X-Experiment-Bucket`) plus `/sitemap.xml` and `/robots.txt`.

4. **Spec-Driven CWV, SEO, WCAG AA & FinTech Compliance Audit Harness (`src/audit/harness.ts` + `src/audit/cli.ts`)**
   - Programmatically enforces **14 automated budgets** across both A/B variants:
     - **CWV:** `< 50 KB` uncompressed SSR HTML (`43.75 KB` / `43.78 KB` verified), `0` render-blocking external scripts/stylesheets, explicit media dimensions & CSS `aspect-ratio`/`min-height` reservations, CDN SWR + `Vary` headers.
     - **SEO:** Canonical URL, meta description length, OpenGraph tags, valid JSON-LD `@graph`, zero raw `<` in JSON-LD, crawlable no-JS SSR table with visible APYs.
     - **WCAG AA:** Single `<h1>`, semantic `<header>`/`<nav>`/`<main id="main-content">`/`<footer>`, skip-to-content link, `<table aria-label>` + `<caption>` + `<th scope="col">`, `100%` `<label for>` bindings, and `aria-live="polite"` calculator updates.
     - **FinTech Compliance:** FDIC/NCUA `$250,000` disclosure, Advertiser/Editorial Independence disclosure, Synthetic Demo disclaimer, and `0` stale (>72h) rates.
     - **Experimentation:** Server-side `X-Experiment-Bucket` header + `data-experiment-variant` SSR marker.

---

## Quick Start & Verification

```bash
npm install
npm run typecheck   # Strict TypeScript (`tsc --noEmit`) — 0 errors
npm test            # Vitest suite — 3/3 files, 17/17 tests passing
npm run audit       # Live Spec-Driven Audit CLI across both A/B variants — 14/14 (100%) PASS
npm run start       # Start local SSR server at http://127.0.0.1:3000
```

### Live Endpoints to Inspect (`http://127.0.0.1:3000`)

| Endpoint | Purpose |
| :--- | :--- |
| `GET /` | SSR Marketplace (auto-assigns `np_vid` cookie + server A/B bucket; preview overrides via `?forceVariant=hero_calc_above_fold` or `?forceVariant=comparison_table_first`) |
| `GET /api/products?deposit=25000&months=12&sort=best_net_yield&noFeeOnly=true` | Dynamic personalized Reg DD comparison API with Zod validation |
| `POST /api/telemetry/vitals` | Ingests RUM `LCP`, `INP`, `CLS`, `TTFB` samples + experiment funnel events |
| `GET /api/telemetry/summary` | Returns p75 Web Vitals ratings, per-variant CTR/interaction funnel, and Pearson chi-square SRM health |
| `GET /api/audit` / `GET /api/audit?format=markdown` | Live 14-check spec-driven CWV/SEO/WCAG/Compliance scorecard |
| `GET /sitemap.xml` & `GET /robots.txt` | Technical SEO crawl directives |

---

## Verified Build Metrics

- **TypeScript (`npx tsc --noEmit`):** `0` errors (strict mode + `noUncheckedIndexedAccess`)
- **Vitest (`npm test`):** `3/3` test files passed, `17/17` tests passed (`banking.test.ts`: 6, `experiments.test.ts`: 5, `seo-audit.test.ts`: 6)
- **Spec-Driven Audit CLI (`npm run audit`):**
  - Variant `hero_calc_above_fold`: **14/14 PASS (100%)**, uncompressed SSR HTML = **44,802 bytes (43.75 KB / 50.00 KB budget)**
  - Variant `comparison_table_first`: **14/14 PASS (100%)**, uncompressed SSR HTML = **44,833 bytes (43.78 KB / 50.00 KB budget)**
  - Technical SEO endpoints (`/sitemap.xml`, `/robots.txt`): **PASS**
