import type { MarketplaceComparisonResponse } from '../domain/banking.js';

export type AuditCategory = 'cwv' | 'seo' | 'a11y' | 'compliance' | 'experimentation';

export interface AuditCheckResult {
  id: string;
  category: AuditCategory;
  name: string;
  status: 'pass' | 'fail';
  measured: string;
  budget: string;
  message: string;
}

export interface AuditReport {
  passed: boolean;
  scorePct: number;
  passedCount: number;
  failedCount: number;
  totalChecks: number;
  htmlBytes: number;
  htmlBudgetBytes: number;
  variantKey: string | null;
  generatedAt: string;
  checks: AuditCheckResult[];
}

export interface AuditInput {
  html: string;
  headers: Record<string, string | string[] | undefined>;
  apiComparison?: MarketplaceComparisonResponse;
  htmlBudgetBytes?: number;
}

export const DEFAULT_HTML_BUDGET_BYTES = 51_200; // 50 KB uncompressed

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower && v !== undefined) {
      return Array.isArray(v) ? v.join(', ') : v;
    }
  }
  return '';
}

function extractJsonLdBlocks(html: string): string[] {
  const matches: string[] = [];
  const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    matches.push(match[1] ?? '');
  }
  return matches;
}

/**
 * Spec-driven programmatic audit harness validating SSR HTML + API output against
 * strict Core Web Vitals, Technical SEO, WCAG AA Accessibility, FinTech Compliance,
 * and Zero-CLS Server-Side Experimentation budgets.
 */
export function auditMarketplaceResponse(input: AuditInput): AuditReport {
  const { html, headers, apiComparison } = input;
  const htmlBudgetBytes = input.htmlBudgetBytes ?? DEFAULT_HTML_BUDGET_BYTES;
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  const checks: AuditCheckResult[] = [];

  // 1. HTML payload size budget (< 50KB uncompressed)
  checks.push({
    id: 'cwv_html_payload_budget',
    category: 'cwv',
    name: 'Uncompressed SSR HTML Payload Budget',
    status: htmlBytes < htmlBudgetBytes ? 'pass' : 'fail',
    measured: `${htmlBytes} bytes (${(htmlBytes / 1024).toFixed(2)} KB)`,
    budget: `< ${htmlBudgetBytes} bytes (50.00 KB)`,
    message:
      htmlBytes < htmlBudgetBytes
        ? 'SSR document fits comfortably inside 50KB uncompressed budget for fast TTFB/FCP.'
        : `SSR HTML exceeds 50KB budget by ${htmlBytes - htmlBudgetBytes} bytes.`,
  });

  // 2. Zero render-blocking external scripts or stylesheets
  const externalBlockingScripts = [
    ...html.matchAll(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi),
  ].filter((m) => !/\b(async|defer|type=["']module["'])\b/i.test(m[0]));
  const externalStylesheets = [
    ...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi),
  ];
  const blockingCount = externalBlockingScripts.length + externalStylesheets.length;
  checks.push({
    id: 'cwv_zero_render_blocking',
    category: 'cwv',
    name: 'Zero Render-Blocking External Scripts & Stylesheets',
    status: blockingCount === 0 ? 'pass' : 'fail',
    measured: `${blockingCount} blocking external resource(s)`,
    budget: '0 blocking external resources',
    message:
      blockingCount === 0
        ? 'Critical CSS is inlined and zero render-blocking external scripts/CSS stall First Paint.'
        : `Detected ${blockingCount} render-blocking external resource tag(s).`,
  });

  // 3. Explicit dimensions / CLS prevention
  const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)];
  const undimensionedImgs = imgTags.filter(
    (m) => !(/\bwidth=/i.test(m[0]) && /\bheight=/i.test(m[0])),
  );
  const svgTags = [...html.matchAll(/<svg\b[^>]*>/gi)];
  const undimensionedSvgs = svgTags.filter(
    (m) => !(/\bwidth=/i.test(m[0]) && /\bheight=/i.test(m[0])),
  );
  const hasReservedCss =
    /aspect-ratio\s*:/i.test(html) && /min-height\s*:/i.test(html);
  const clsPass =
    undimensionedImgs.length === 0 &&
    undimensionedSvgs.length === 0 &&
    hasReservedCss;
  checks.push({
    id: 'cwv_cls_reserved_dimensions',
    category: 'cwv',
    name: 'CLS Prevention (Explicit Dimensions & Aspect-Ratio Reservations)',
    status: clsPass ? 'pass' : 'fail',
    measured: `${undimensionedImgs.length} un-sized <img>, ${undimensionedSvgs.length} un-sized <svg>, reservedCSS=${hasReservedCss}`,
    budget: '0 un-sized media elements + explicit aspect-ratio & min-height reservations',
    message: clsPass
      ? 'All media/SVG icons carry explicit dimensions and hero/card containers reserve layout height.'
      : 'Found un-dimensioned media or missing layout reservation CSS (CLS risk).',
  });

  // 4. Edge caching headers (Cache-Control + Vary)
  const cacheControl = getHeader(headers, 'cache-control');
  const vary = getHeader(headers, 'vary');
  const cachePass =
    /s-maxage=\d+/i.test(cacheControl) &&
    /stale-while-revalidate=\d+/i.test(cacheControl) &&
    vary.length > 0;
  checks.push({
    id: 'cwv_cdn_caching_headers',
    category: 'cwv',
    name: 'CDN Cache-Control (s-maxage + SWR) & Vary Headers',
    status: cachePass ? 'pass' : 'fail',
    measured: `Cache-Control="${cacheControl || 'missing'}", Vary="${vary || 'missing'}"`,
    budget: 's-maxage + stale-while-revalidate + Vary header',
    message: cachePass
      ? 'Edge caching with stale-while-revalidate and variant-aware Vary partitioning configured.'
      : 'Missing or incomplete CDN Cache-Control / Vary headers.',
  });

  // 5. Canonical URL, Title, Description & OpenGraph
  const hasTitle = /<title>[^<]{10,}<\/title>/i.test(html);
  const descMatch = html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  const descLen = descMatch?.[1]?.length ?? 0;
  const hasCanonical = /<link\b[^>]*rel=["']canonical["'][^>]*href=["']https?:\/\/[^"']+["']/i.test(html);
  const hasOg = /property=["']og:title["']/i.test(html) && /property=["']og:url["']/i.test(html);
  const metaPass = hasTitle && descLen >= 50 && descLen <= 170 && hasCanonical && hasOg;
  checks.push({
    id: 'seo_canonical_meta_og',
    category: 'seo',
    name: 'Canonical Link, Meta Description & OpenGraph Tags',
    status: metaPass ? 'pass' : 'fail',
    measured: `title=${hasTitle}, descLen=${descLen}, canonical=${hasCanonical}, og=${hasOg}`,
    budget: 'Valid title, 50-170 char description, absolute canonical URL, OG tags',
    message: metaPass
      ? 'Canonical URL, SEO meta description, and OpenGraph social tags verified.'
      : 'Missing or out-of-range title, meta description, canonical link, or OpenGraph tags.',
  });

  // 6. Valid Schema.org JSON-LD (ItemList, FinancialProduct, FAQPage, BreadcrumbList)
  const jsonLdBlocks = extractJsonLdBlocks(html);
  let jsonLdValid = false;
  let foundTypes: string[] = [];
  let financialProductCount = 0;
  let rawJsonLdUnsafe = false;

  for (const raw of jsonLdBlocks) {
    if (/<\/script/i.test(raw) || raw.includes('<')) {
      rawJsonLdUnsafe = true;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const graph = Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed];
      for (const node of graph) {
        if (node && typeof node === 'object') {
          const rec = node as Record<string, unknown>;
          if (typeof rec['@type'] === 'string') {
            foundTypes.push(rec['@type']);
          }
          if (rec['@type'] === 'ItemList' && Array.isArray(rec.itemListElement)) {
            for (const el of rec.itemListElement) {
              if (
                el &&
                typeof el === 'object' &&
                (el as Record<string, unknown>).item &&
                ((el as Record<string, unknown>).item as Record<string, unknown>)['@type'] ===
                  'FinancialProduct'
              ) {
                financialProductCount += 1;
              }
            }
          }
        }
      }
      jsonLdValid =
        foundTypes.includes('ItemList') &&
        foundTypes.includes('FAQPage') &&
        foundTypes.includes('BreadcrumbList') &&
        financialProductCount > 0;
    } catch {
      jsonLdValid = false;
    }
  }

  checks.push({
    id: 'seo_jsonld_schema',
    category: 'seo',
    name: 'Valid Schema.org JSON-LD (ItemList + FinancialProduct + FAQPage + BreadcrumbList)',
    status: jsonLdValid ? 'pass' : 'fail',
    measured: `types=[${foundTypes.join(', ')}], FinancialProducts=${financialProductCount}`,
    budget: 'ItemList + FinancialProduct (>=1) + FAQPage + BreadcrumbList',
    message: jsonLdValid
      ? `Validated JSON-LD @graph with ${financialProductCount} FinancialProduct entries, FAQPage, and BreadcrumbList.`
      : 'JSON-LD structured data missing required Schema.org types or failed JSON parsing.',
  });

  // 7. JSON-LD XSS safety
  const xssPass = jsonLdBlocks.length > 0 && !rawJsonLdUnsafe;
  checks.push({
    id: 'seo_jsonld_xss_safety',
    category: 'seo',
    name: 'JSON-LD XSS Breakout Escaping',
    status: xssPass ? 'pass' : 'fail',
    measured: rawJsonLdUnsafe ? 'Unescaped < or </script detected' : 'Zero raw < characters in JSON-LD',
    budget: 'Zero raw < or </script sequences in serialized JSON-LD',
    message: xssPass
      ? 'JSON-LD payload strictly escapes HTML angle brackets against </script> XSS injection.'
      : 'Unescaped angle brackets detected inside JSON-LD script block.',
  });

  // 8. Crawlable SSR Comparison Table
  const ssrRows = [...html.matchAll(/<tr\b[^>]*data-product-id=/gi)].length;
  const hasApyPercent = /\d+\.\d{2}%/.test(html);
  const crawlablePass = ssrRows > 0 && hasApyPercent;
  checks.push({
    id: 'seo_crawlable_ssr_table',
    category: 'seo',
    name: 'Crawlable Server-Rendered Comparison Table (No-JS Indexable)',
    status: crawlablePass ? 'pass' : 'fail',
    measured: `${ssrRows} SSR product row(s), apyVisible=${hasApyPercent}`,
    budget: '>= 1 server-rendered product row with visible APY figures',
    message: crawlablePass
      ? `Search crawlers receive ${ssrRows} complete product rows and APY figures in initial HTML.`
      : 'Comparison table is empty or relies on client-side JS to render rates.',
  });

  // 9. WCAG AA: Single H1 & Semantic Landmarks
  const h1Count = [...html.matchAll(/<h1\b[^>]*>/gi)].length;
  const hasHeader = /<header\b/i.test(html);
  const hasNav = /<nav\b[^>]*aria-label=/i.test(html);
  const hasMain = /<main\b[^>]*id=["']main-content["']/i.test(html);
  const hasFooter = /<footer\b/i.test(html);
  const landmarksPass = h1Count === 1 && hasHeader && hasNav && hasMain && hasFooter;
  checks.push({
    id: 'a11y_landmarks_single_h1',
    category: 'a11y',
    name: 'WCAG AA Single <h1> & Semantic Landmarks',
    status: landmarksPass ? 'pass' : 'fail',
    measured: `h1=${h1Count}, header=${hasHeader}, nav=${hasNav}, main=${hasMain}, footer=${hasFooter}`,
    budget: 'Exactly 1 <h1> + <header>, <nav aria-label>, <main id="main-content">, <footer>',
    message: landmarksPass
      ? 'Document outline has a single <h1> and full landmark navigation structure.'
      : 'Document landmark hierarchy or heading structure fails WCAG AA.',
  });

  // 10. WCAG AA: Skip-to-Content Link
  const hasSkipLink = /<a\b[^>]*href=["']#main-content["'][^>]*>Skip to main content<\/a>/i.test(
    html,
  );
  checks.push({
    id: 'a11y_skip_to_content',
    category: 'a11y',
    name: 'Keyboard Skip-to-Content Link',
    status: hasSkipLink ? 'pass' : 'fail',
    measured: hasSkipLink ? 'Present (#main-content)' : 'Missing',
    budget: 'Focusable skip link targeting #main-content',
    message: hasSkipLink
      ? 'Keyboard users can bypass header navigation directly to #main-content.'
      : 'Missing skip-to-content link targeting #main-content.',
  });

  // 11. WCAG AA: Accessible Data Table & Form Label Bindings
  const hasTableCaptionOrLabel =
    /<table\b[^>]*aria-label=/i.test(html) && /<caption\b/i.test(html);
  const thScopeCount = [...html.matchAll(/<th\b[^>]*scope=["']col["']/gi)].length;
  const controlIds = [
    ...html.matchAll(/<(?:input|select)\b[^>]*id=["']([^"']+)["'][^>]*>/gi),
  ].map((m) => m[1]!);
  const missingLabels = controlIds.filter(
    (id) => !new RegExp(`<label\\b[^>]*for=["']${id}["']`, 'i').test(html),
  );
  const hasAriaLive = /aria-live=["']polite["']/i.test(html);
  const controlsPass =
    hasTableCaptionOrLabel &&
    thScopeCount >= 4 &&
    controlIds.length >= 4 &&
    missingLabels.length === 0 &&
    hasAriaLive;
  checks.push({
    id: 'a11y_table_and_form_labels',
    category: 'a11y',
    name: 'WCAG AA Table Scopes, Form <label for> Bindings & aria-live',
    status: controlsPass ? 'pass' : 'fail',
    measured: `th[scope=col]=${thScopeCount}, controls=${controlIds.length}, missingLabels=${missingLabels.length}, ariaLive=${hasAriaLive}`,
    budget: 'Caption/aria-label + >=4 th[scope=col] + 0 unlabeled inputs + aria-live=polite',
    message: controlsPass
      ? 'All comparison table headers, form inputs, and live calculator updates are screen-reader accessible.'
      : `Accessibility defect: missingLabels=[${missingLabels.join(', ')}], thScopeCount=${thScopeCount}.`,
  });

  // 12. FinTech Compliance: FDIC/NCUA & Advertiser Disclosures + Synthetic Disclaimer
  const hasFdicNcua = /FDIC/i.test(html) && /NCUA/i.test(html) && /\$250,000/.test(html);
  const hasAdvertiserDisclosure =
    /Advertiser Disclosure/i.test(html) && /editorial/i.test(html);
  const hasSyntheticDisclaimer = /Synthetic Demo Data/i.test(html);
  const disclosuresPass =
    hasFdicNcua && hasAdvertiserDisclosure && hasSyntheticDisclaimer;
  checks.push({
    id: 'compliance_fintech_disclosures',
    category: 'compliance',
    name: 'FDIC/NCUA, Editorial Independence & Synthetic Demo Disclosures',
    status: disclosuresPass ? 'pass' : 'fail',
    measured: `FDIC/NCUA=${hasFdicNcua}, AdvertiserDisclosure=${hasAdvertiserDisclosure}, SyntheticDisclaimer=${hasSyntheticDisclaimer}`,
    budget: 'All 3 regulated consumer-banking & demo disclosures visible in SSR HTML',
    message: disclosuresPass
      ? 'FDIC/NCUA insurance cap, editorial independence/partner disclosure, and synthetic demo notice verified.'
      : 'Missing required consumer banking or synthetic data compliance disclosure.',
  });

  // 13. FinTech Compliance: Zero Stale Rates (>72h)
  const staleHtmlMarker = /STALE RATE|Rate verification expired/i.test(html);
  const staleInApi = apiComparison
    ? apiComparison.results.filter((r) => r.freshness.isStale).length
    : 0;
  const zeroStalePass = !staleHtmlMarker && staleInApi === 0;
  checks.push({
    id: 'compliance_zero_stale_rates',
    category: 'compliance',
    name: 'Zero Stale Rates (>72h Rate Freshness Guardrail)',
    status: zeroStalePass ? 'pass' : 'fail',
    measured: `staleHtmlMarker=${staleHtmlMarker}, staleApiProducts=${staleInApi}`,
    budget: '0 stale rates (>72h) exposed in active marketplace comparison',
    message: zeroStalePass
      ? 'All published banking offers pass the 72-hour rate verification SLA.'
      : 'Stale unverified APY rate detected in rendered marketplace output.',
  });

  // 14. Zero-CLS Server-Side Experimentation Integrity
  const expHeader = getHeader(headers, 'x-experiment-bucket');
  const variantAttrMatch = html.match(/data-experiment-variant=["']([^"']+)["']/i);
  const variantKey = variantAttrMatch?.[1] ?? null;
  const expPass = expHeader.length > 0 && variantKey !== null;
  checks.push({
    id: 'exp_server_side_zero_cls',
    category: 'experimentation',
    name: 'Server-Side A/B Bucketing Header & Pre-Render Variant Marker',
    status: expPass ? 'pass' : 'fail',
    measured: `X-Experiment-Bucket="${expHeader || 'missing'}", data-experiment-variant="${variantKey ?? 'missing'}"`,
    budget: 'Both server response header and SSR DOM variant marker present',
    message: expPass
      ? `Variant "${variantKey}" rendered directly on server prior to first byte (0ms client layout shift).`
      : 'Missing server-side experiment header or SSR DOM variant marker.',
  });

  const passedCount = checks.filter((c) => c.status === 'pass').length;
  const failedCount = checks.length - passedCount;
  const scorePct = Math.round((passedCount / checks.length) * 1000) / 10;

  return {
    passed: failedCount === 0,
    scorePct,
    passedCount,
    failedCount,
    totalChecks: checks.length,
    htmlBytes,
    htmlBudgetBytes,
    variantKey,
    generatedAt: new Date().toISOString(),
    checks,
  };
}

export function formatAuditMarkdown(report: AuditReport): string {
  const statusIcon = report.passed ? 'PASS' : 'FAIL';
  const lines: string[] = [
    `# NerdPulse Spec-Driven Audit Scorecard — ${statusIcon} (${report.passedCount}/${report.totalChecks} | ${report.scorePct}%)`,
    '',
    `- **Generated At:** \`${report.generatedAt}\``,
    `- **Server-Rendered Variant:** \`${report.variantKey ?? 'unknown'}\``,
    `- **SSR HTML Payload:** \`${report.htmlBytes} bytes\` (\`${(report.htmlBytes / 1024).toFixed(2)} KB\` / \`${(report.htmlBudgetBytes / 1024).toFixed(2)} KB\` budget)`,
    '',
    '| Status | Category | Check | Measured | Budget |',
    '| :---: | :--- | :--- | :--- | :--- |',
  ];

  for (const c of report.checks) {
    const badge = c.status === 'pass' ? 'PASS' : 'FAIL';
    lines.push(
      `| **${badge}** | \`${c.category}\` | ${c.name} | \`${c.measured}\` | ${c.budget} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}
