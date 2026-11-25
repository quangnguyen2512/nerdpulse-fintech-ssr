import type { AddressInfo } from 'node:net';
import type { MarketplaceComparisonResponse } from '../domain/banking.js';
import { createMarketplaceApp } from '../server/app.js';
import {
  auditMarketplaceResponse,
  AuditReport,
  formatAuditMarkdown,
} from './harness.js';

async function runCliAudit(): Promise<void> {
  const { server } = createMarketplaceApp();

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const apiRes = await fetch(
      `${baseUrl}/api/products?deposit=25000&months=12&sort=best_net_yield`,
    );
    if (!apiRes.ok) {
      throw new Error(`/api/products failed with HTTP ${apiRes.status}`);
    }
    const apiComparison = (await apiRes.json()) as MarketplaceComparisonResponse;

    const variants = ['hero_calc_above_fold', 'comparison_table_first'] as const;
    const reports: AuditReport[] = [];

    for (const variant of variants) {
      const ssrRes = await fetch(
        `${baseUrl}/?forceVariant=${encodeURIComponent(variant)}`,
      );
      if (!ssrRes.ok) {
        throw new Error(`GET / (${variant}) failed with HTTP ${ssrRes.status}`);
      }
      const html = await ssrRes.text();
      const headers: Record<string, string> = {};
      ssrRes.headers.forEach((value, key) => {
        headers[key] = value;
      });
      reports.push(
        auditMarketplaceResponse({
          html,
          headers,
          apiComparison,
        }),
      );
    }

    const sitemapRes = await fetch(`${baseUrl}/sitemap.xml`);
    const sitemapText = await sitemapRes.text();
    const robotsRes = await fetch(`${baseUrl}/robots.txt`);
    const robotsText = await robotsRes.text();

    const seoEndpointsOk =
      sitemapRes.status === 200 &&
      sitemapText.includes('<urlset') &&
      robotsRes.status === 200 &&
      robotsText.includes('Sitemap:');

    for (const report of reports) {
      console.log(formatAuditMarkdown(report));
    }

    const summary = {
      allPassed: reports.every((r) => r.passed) && seoEndpointsOk,
      seoEndpointsOk,
      variantsAudited: reports.map((r) => ({
        variantKey: r.variantKey,
        passed: r.passed,
        scorePct: r.scorePct,
        passedCount: r.passedCount,
        totalChecks: r.totalChecks,
        htmlBytes: r.htmlBytes,
      })),
    };

    console.log('--- JSON AUDIT SUMMARY ---');
    console.log(JSON.stringify(summary, null, 2));

    if (!summary.allPassed) {
      process.exitCode = 1;
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

runCliAudit().catch((err) => {
  console.error('[nerdpulse-audit] Fatal error:', err);
  process.exit(1);
});
