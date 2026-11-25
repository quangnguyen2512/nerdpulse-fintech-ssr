import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditMarketplaceResponse, formatAuditMarkdown } from '../src/audit/harness.js';
import {
  getDefaultBankingCatalog,
  MarketplaceComparisonResponse,
  rankBankingProducts,
} from '../src/domain/banking.js';
import {
  buildMarketplaceJsonLd,
  safeJsonLdSerialize,
} from '../src/domain/seo.js';
import { createMarketplaceApp } from '../src/server/app.js';

describe('technical SEO, JSON-LD XSS safety & spec-driven audit harness', () => {
  it('escapes </script> and angle brackets in JSON-LD to block XSS breakouts', () => {
    const catalog = getDefaultBankingCatalog();
    catalog[0]!.productName = 'Malicious Bank </script><script>alert("xss")</script>';
    const ranked = rankBankingProducts(catalog, {
      depositUsd: 25_000,
      months: 12,
      sort: 'best_net_yield',
    });

    const jsonLd = buildMarketplaceJsonLd(ranked.results, 'https://demo.nerdpulse.example');
    const serialized = safeJsonLdSerialize(jsonLd);

    expect(serialized).not.toContain('</script>');
    expect(serialized).not.toContain('<');
    expect(serialized).toContain('\\u003c/script\\u003e');

    // Escaped JSON-LD remains 100% valid JSON and decodes cleanly
    const parsed = JSON.parse(serialized) as { '@graph': Array<Record<string, unknown>> };
    expect(Array.isArray(parsed['@graph'])).toBe(true);
    const itemList = parsed['@graph'].find((n) => n['@type'] === 'ItemList');
    expect(itemList).toBeDefined();
  });

  it('audit harness catches HTML budget breaches, blocking scripts, and missing disclosures', () => {
    const badHtml = `<!DOCTYPE html><html><head><title>Hi</title><script src="https://cdn.example.com/blocking.js"></script></head><body><h1>One</h1><h1>Two</h1><img src="x.png">STALE RATE</body></html>`;
    const report = auditMarketplaceResponse({
      html: badHtml,
      headers: {},
      htmlBudgetBytes: 50, // force budget fail
    });

    expect(report.passed).toBe(false);
    expect(report.failedCount).toBeGreaterThanOrEqual(8);
    expect(report.checks.find((c) => c.id === 'cwv_html_payload_budget')?.status).toBe('fail');
    expect(report.checks.find((c) => c.id === 'cwv_zero_render_blocking')?.status).toBe('fail');
    expect(report.checks.find((c) => c.id === 'a11y_landmarks_single_h1')?.status).toBe('fail');
    expect(report.checks.find((c) => c.id === 'compliance_zero_stale_rates')?.status).toBe('fail');
  });
});

describe('SSR marketplace & REST API end-to-end verification', () => {
  const { server } = createMarketplaceApp();
  let baseUrl = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('GET / renders both A/B layout variants server-side and passes 100% of SEO/CWV/A11y/Compliance audits', async () => {
    const apiRes = await fetch(`${baseUrl}/api/products?deposit=25000&months=12&sort=best_net_yield`);
    const apiData = (await apiRes.json()) as MarketplaceComparisonResponse;

    // Variant A: hero_calc_above_fold -> calculator appears before comparison table
    const resA = await fetch(`${baseUrl}/?forceVariant=hero_calc_above_fold`);
    expect(resA.status).toBe(200);
    const htmlA = await resA.text();
    const headersA: Record<string, string> = {};
    resA.headers.forEach((v, k) => {
      headersA[k] = v;
    });

    expect(headersA['cache-control']).toContain('s-maxage=300');
    expect(headersA['cache-control']).toContain('stale-while-revalidate=3600');
    expect(headersA['x-experiment-bucket']).toBe('hysa_layout_v1:hero_calc_above_fold');
    expect(htmlA.indexOf('id="calc-heading"')).toBeLessThan(
      htmlA.indexOf('id="table-heading"'),
    );

    const auditA = auditMarketplaceResponse({
      html: htmlA,
      headers: headersA,
      apiComparison: apiData,
    });
    expect(auditA.passed).toBe(true);
    expect(auditA.scorePct).toBe(100);
    expect(auditA.htmlBytes).toBeLessThan(51_200);

    // Variant B: comparison_table_first -> comparison table appears before calculator
    const resB = await fetch(`${baseUrl}/?forceVariant=comparison_table_first`);
    expect(resB.status).toBe(200);
    const htmlB = await resB.text();
    const headersB: Record<string, string> = {};
    resB.headers.forEach((v, k) => {
      headersB[k] = v;
    });

    expect(headersB['x-experiment-bucket']).toBe('hysa_layout_v1:comparison_table_first');
    expect(htmlB.indexOf('id="table-heading"')).toBeLessThan(
      htmlB.indexOf('id="calc-heading"'),
    );

    const auditB = auditMarketplaceResponse({
      html: htmlB,
      headers: headersB,
      apiComparison: apiData,
    });
    expect(auditB.passed).toBe(true);
    expect(auditB.scorePct).toBe(100);
    expect(formatAuditMarkdown(auditB)).toContain('PASS');
  });

  it('GET /api/products filters, ranks dynamically, and rejects invalid inputs with 400', async () => {
    const res = await fetch(
      `${baseUrl}/api/products?deposit=25000&months=12&sort=best_net_yield&noFeeOnly=true`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as MarketplaceComparisonResponse;
    expect(body.query.depositUsd).toBe(25_000);
    expect(body.query.noFeeOnly).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.every((r) => r.product.monthlyFeeUsd === 0)).toBe(true);
    expect(body.results.every((r) => !r.freshness.isStale)).toBe(true);

    // Verify descending netReturnUsd order among eligible products
    for (let i = 1; i < body.results.length; i += 1) {
      expect(body.results[i - 1]!.yieldSummary.netReturnUsd).toBeGreaterThanOrEqual(
        body.results[i]!.yieldSummary.netReturnUsd,
      );
    }

    const badRes = await fetch(`${baseUrl}/api/products?deposit=-500&months=999`);
    expect(badRes.status).toBe(400);
  });

  it('POST /api/telemetry/vitals + GET /api/telemetry/summary computes p75 CWV & SRM stats', async () => {
    const samples = [
      { visitorId: 'u1', variantKey: 'hero_calc_above_fold', lcp: 920, inp: 45, cls: 0.0, ttfb: 80 },
      { visitorId: 'u2', variantKey: 'hero_calc_above_fold', lcp: 1180, inp: 62, cls: 0.002, ttfb: 110 },
      { visitorId: 'u3', variantKey: 'comparison_table_first', lcp: 850, inp: 38, cls: 0.0, ttfb: 75 },
      { visitorId: 'u4', variantKey: 'comparison_table_first', lcp: 1340, inp: 88, cls: 0.005, ttfb: 140 },
    ];

    for (const s of samples) {
      const postRes = await fetch(`${baseUrl}/api/telemetry/vitals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId: s.visitorId,
          experimentKey: 'hysa_layout_v1',
          variantKey: s.variantKey,
          vitals: [
            { name: 'LCP', value: s.lcp },
            { name: 'INP', value: s.inp },
            { name: 'CLS', value: s.cls },
            { name: 'TTFB', value: s.ttfb },
          ],
          event: { eventType: 'calculator_interact' },
        }),
      });
      expect(postRes.status).toBe(202);
    }

    const sumRes = await fetch(`${baseUrl}/api/telemetry/summary?minSampleSize=4`);
    expect(sumRes.status).toBe(200);
    const summary = (await sumRes.json()) as {
      webVitals: Record<string, { p75: number; rating: string; samples: number }>;
      experiment: { srm: { status: string; srmDetected: boolean } };
    };

    expect(summary.webVitals.LCP?.samples).toBe(4);
    expect(summary.webVitals.LCP?.rating).toBe('good');
    expect(summary.webVitals.CLS?.p75).toBeLessThanOrEqual(0.01);
    expect(summary.webVitals.CLS?.rating).toBe('good');
    expect(summary.webVitals.INP?.rating).toBe('good');
    expect(summary.webVitals.TTFB?.rating).toBe('good');
    expect(summary.experiment.srm.status).toBe('healthy');
    expect(summary.experiment.srm.srmDetected).toBe(false);
  });

  it('GET /api/audit, /sitemap.xml, /robots.txt, /healthz, and 404 behave per spec', async () => {
    const auditJsonRes = await fetch(`${baseUrl}/api/audit`);
    expect(auditJsonRes.status).toBe(200);
    const auditJson = (await auditJsonRes.json()) as { passed: boolean; scorePct: number };
    expect(auditJson.passed).toBe(true);
    expect(auditJson.scorePct).toBe(100);

    const auditMdRes = await fetch(`${baseUrl}/api/audit?format=markdown`);
    expect(auditMdRes.status).toBe(200);
    expect(await auditMdRes.text()).toContain('# NerdPulse Spec-Driven Audit Scorecard — PASS');

    const sitemapRes = await fetch(`${baseUrl}/sitemap.xml`);
    expect(sitemapRes.status).toBe(200);
    expect(sitemapRes.headers.get('content-type')).toContain('application/xml');
    expect(await sitemapRes.text()).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

    const robotsRes = await fetch(`${baseUrl}/robots.txt`);
    expect(robotsRes.status).toBe(200);
    expect(await robotsRes.text()).toContain('Sitemap:');

    const healthRes = await fetch(`${baseUrl}/healthz`);
    expect(healthRes.status).toBe(200);

    const missingRes = await fetch(`${baseUrl}/does-not-exist`);
    expect(missingRes.status).toBe(404);
  });
});
