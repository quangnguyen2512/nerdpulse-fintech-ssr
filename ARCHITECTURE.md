# ARCHITECTURE — NerdPulse Consumer Banking Marketplace

High-performance **TypeScript + Node.js SSR** reference architecture for consumer banking comparisons (High-Yield Savings Accounts & CDs), combining **Zero-CLS server-side A/B experimentation**, **Reg DD compound yield modeling**, **72-hour rate freshness compliance guardrails**, **Technical SEO (JSON-LD)**, and a **spec-driven CWV/SEO/WCAG audit harness**.

## Core Invariants
1. **Zero-CLS Experimentation:** Variant assignment (`SHA-256(key:salt:visitorId)`) executes on the server before the first HTML byte is streamed, with explicit `aspect-ratio` / `min-height` layout reservations and `Vary` edge cache partitioning (`0ms` client flicker).
2. **Editorial Independence & Rate Freshness SLA:** Paid partner status (`isPartner`) never boosts independent `editorialRating` or algorithmic sort rank; any offer with `rateVerifiedAt > maxStaleHours` (72h) is automatically excluded or demoted.
3. **Spec-Driven Quality Gate:** Every SSR render must pass 100% of automated budgets (`< 50KB` uncompressed HTML, `0` render-blocking external resources, XSS-escaped Schema.org JSON-LD, WCAG AA landmarks/labels, and FDIC/NCUA/partner/synthetic disclosures).
4. **Synthetic Data Honesty:** All institutions, APYs, and partner flags are synthetic illustrative fixtures clearly labeled in both API JSON and rendered SSR HTML.

## Directory Boundaries
```text
jobicy_dc7b3545f061_nerdwallet/
├── ARCHITECTURE.md            # Project system map & invariants
├── README.md                  # Setup, architecture, U.S. Remote HITL caveat & dual-value guide
├── APPLY_PITCH_AND_AUDIT.md   # Anti-slop pitch + verified audit scorecard + eligibility note
├── src/
│   ├── domain/
│   │   ├── banking.ts         # Synthetic HYSA/CD catalog, Reg DD compounding, fee drag, promo expiry, 72h guardrail, ranking
│   │   ├── experiments.ts     # SHA-256 server bucketing, holdouts, exposure/conversion tracker, SRM chi-square test
│   │   └── seo.ts             # XSS-safe JSON-LD (@graph), canonical/OG tags, Cache-Control/Vary headers, sitemap/robots
│   ├── audit/
│   │   ├── harness.ts         # 14-check programmatic CWV, SEO, WCAG AA, FinTech compliance & A/B audit engine
│   │   └── cli.ts             # Executable `npm run audit` verification runner across both A/B variants
│   └── server/
│       ├── telemetry.ts       # RUM Core Web Vitals (LCP/INP/CLS/TTFB) p75 aggregator + SRM summary
│       ├── render.ts          # Zero-bloat SSR HTML renderer + progressive-enhancement RUM/calculator drawer
│       ├── app.ts             # Node `http` server factory (GET /, /api/products, /api/telemetry/*, /api/audit, SEO routes)
│       └── index.ts           # Server bootstrap entrypoint
└── tests/
    ├── banking.test.ts        # Compound APY, fee drag, promo cliff, tiers, 72h stale guardrail, editorial independence
    ├── experiments.test.ts    # SHA-256 determinism, 10k split uniformity, holdouts, SRM chi-square skew detection
    └── seo-audit.test.ts      # JSON-LD XSS defense, harness regression guards, full live HTTP endpoint integration tests
```

## Execution DAG
```text
Incoming HTTP Request -> app.ts (Cookie/VisitorId + Zod Validation)
  ├─> experiments.ts (SHA-256 Server Bucket -> 0ms CLS)
  ├─> banking.ts     (72h Freshness Guardrail + Reg DD Compound Yield + Independent Ranking)
  ├─> seo.ts         (XSS-Safe Schema.org JSON-LD + Canonical/OG + Cache-Control/Vary)
  └─> render.ts      (Semantic WCAG AA SSR HTML < 50KB + RUM PerformanceObserver Beacon)
         └─> POST /api/telemetry/vitals -> telemetry.ts (p75 CWV + SRM Chi-Square)
         └─> GET /api/audit & `npm run audit` -> harness.ts (14-Check Spec Gate)
```

<!-- AUTO-KG-STATS:START -->
- **Knowledge Graph Live Sync:** `2026-11-25 16:02 UTC` | Nodes: **21** | Edges: **12** | Layers: **5** | Languages: `markdown, typescript`
- **Top Connected Hubs:** `src/audit/cli.ts` (1), `src/audit/harness.ts` (1), `src/domain/banking.ts` (1), `src/domain/experiments.ts` (1), `src/domain/seo.ts` (1)
<!-- AUTO-KG-STATS:END -->
