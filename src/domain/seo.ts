import type { BankingProduct, RankedBankingProduct } from './banking.js';

export interface FaqEntry {
  question: string;
  answer: string;
}

export const BANKING_MARKETPLACE_FAQS: FaqEntry[] = [
  {
    question: 'How is Annual Percentage Yield (APY) compounded on High-Yield Savings Accounts?',
    answer:
      'Under Truth in Savings (Reg DD), APY reflects a full year of compounding. Our calculator converts each offer APY to its effective monthly compounding rate ((1 + APY)^(1/12) - 1), applies balance tiers and intro promo windows, and deducts non-waived monthly fees to project true net return.',
  },
  {
    question: 'Are High-Yield Savings Accounts and CDs FDIC or NCUA insured?',
    answer:
      'Eligible online bank accounts are insured by the FDIC and eligible credit union share accounts are insured by the NCUA, each up to $250,000 per depositor, per ownership category, per institution.',
  },
  {
    question: 'How does editorial independence work when partner banks appear in comparison tables?',
    answer:
      'Partner institutions are clearly labeled with a Partner badge and disclosure. Compensation never alters independent editorial star ratings or algorithmic sort orders such as Best Net Yield, Highest APY, or Editorial Pick.',
  },
  {
    question: 'Why does the marketplace enforce a 72-hour rate freshness guardrail?',
    answer:
      'Consumer deposit rates change rapidly around Federal Reserve policy shifts. Any product whose rate verification timestamp exceeds 72 hours is automatically flagged and excluded or demoted so consumers never see expired APYs.',
  },
];

/**
 * Escapes HTML special characters for safe SSR text interpolation.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serializes structured data for inline `<script type="application/ld+json">`
 * with strict XSS protection — eliminates `</script>`, HTML comment, and
 * Unicode line-separator breakout vectors.
 */
export function safeJsonLdSerialize(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export interface SeoHeadOptions {
  baseUrl: string;
  canonicalPath: string;
  title: string;
  description: string;
  experimentBucket: string;
}

export function buildCanonicalUrl(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

export function buildSeoMetaTags(options: SeoHeadOptions): string {
  const canonical = buildCanonicalUrl(options.baseUrl, options.canonicalPath);
  const title = escapeHtml(options.title);
  const description = escapeHtml(options.description);
  const canonicalEscaped = escapeHtml(canonical);
  const expEscaped = escapeHtml(options.experimentBucket);

  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">`,
    `<meta name="nw-experiment" content="${expEscaped}">`,
    `<link rel="canonical" href="${canonicalEscaped}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="NerdPulse Consumer Banking Demo">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${canonicalEscaped}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
  ].join('\n  ');
}

/**
 * Builds a Schema.org `@graph` JSON-LD payload combining:
 * - BreadcrumbList
 * - ItemList of FinancialProduct offers
 * - FAQPage
 */
export function buildMarketplaceJsonLd(
  ranked: RankedBankingProduct[],
  baseUrl: string,
  faqs: FaqEntry[] = BANKING_MARKETPLACE_FAQS,
): Record<string, unknown> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const pageUrl = `${cleanBase}/`;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        '@id': `${pageUrl}#breadcrumb`,
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Home',
            item: `${cleanBase}/`,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Consumer Banking',
            item: `${cleanBase}/?accountType=ALL`,
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: 'High-Yield Savings & CDs',
            item: `${cleanBase}/?accountType=HYSA`,
          },
        ],
      },
      {
        '@type': 'ItemList',
        '@id': `${pageUrl}#banking-comparison`,
        name: 'Best High-Yield Savings Accounts & CDs (Synthetic Demo Comparison)',
        numberOfItems: ranked.length,
        itemListOrder: 'https://schema.org/ItemListOrderDescending',
        itemListElement: ranked.map((entry) => ({
          '@type': 'ListItem',
          position: entry.rank,
          item: {
            '@type': 'FinancialProduct',
            '@id': `${cleanBase}/#product-${entry.product.slug}`,
            name: entry.product.productName,
            category:
              entry.product.accountType === 'HYSA'
                ? 'High-Yield Savings Account'
                : 'Certificate of Deposit',
            provider: {
              '@type': 'BankOrCreditUnion',
              name: entry.product.institutionName,
            },
            annualPercentageRate: {
              '@type': 'QuantitativeValue',
              value: entry.yieldSummary.headlineApyPct,
              unitText: 'PERCENT',
            },
            interestRate: entry.yieldSummary.headlineApyPct,
            feesAndCommissionsSpecification:
              entry.product.monthlyFeeUsd === 0
                ? '$0 monthly maintenance fee'
                : `$${entry.product.monthlyFeeUsd}/month fee${
                    entry.product.feeWaiverMinBalanceUsd
                      ? ` (waived at $${entry.product.feeWaiverMinBalanceUsd.toLocaleString('en-US')}+ balance)`
                      : ''
                  }`,
            url: entry.product.applyUrl,
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: entry.product.editorialRating,
              bestRating: 5,
              worstRating: 1,
              ratingCount: 1,
            },
          },
        })),
      },
      {
        '@type': 'FAQPage',
        '@id': `${pageUrl}#faq`,
        mainEntity: faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: faq.answer,
          },
        })),
      },
    ],
  };
}

/**
 * Standard CDN edge caching headers balancing freshness with fast TTFB.
 * Includes `Vary` partitioning for server-side A/B experimentation.
 */
export function buildSsrCacheHeaders(options: {
  experimentHeaderValue: string;
  serverTimingMs: number;
}): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
    Vary: 'Accept-Encoding, Cookie, X-Experiment-Variant',
    'X-Experiment-Bucket': options.experimentHeaderValue,
    'Server-Timing': `ssr;dur=${options.serverTimingMs.toFixed(2)};desc="SSR + A/B Bucket"`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  };
}

export function buildSitemapXml(
  baseUrl: string,
  products: BankingProduct[],
  lastmodDate: Date = new Date(),
): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const lastmod = lastmodDate.toISOString().slice(0, 10);

  const urls: Array<{ loc: string; changefreq: string; priority: string }> = [
    { loc: `${cleanBase}/`, changefreq: 'hourly', priority: '1.0' },
    {
      loc: `${cleanBase}/?accountType=HYSA&amp;sort=best_net_yield`,
      changefreq: 'hourly',
      priority: '0.9',
    },
    {
      loc: `${cleanBase}/?accountType=CD&amp;sort=highest_apy`,
      changefreq: 'daily',
      priority: '0.8',
    },
    {
      loc: `${cleanBase}/?noFeeOnly=true&amp;sort=no_min_balance`,
      changefreq: 'daily',
      priority: '0.8',
    },
    ...products.map((p) => ({
      loc: `${cleanBase}/#product-${encodeURIComponent(p.slug)}`,
      changefreq: 'daily',
      priority: '0.7',
    })),
  ];

  const entries = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

export function buildRobotsTxt(baseUrl: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/telemetry',
    `Sitemap: ${cleanBase}/sitemap.xml`,
    '',
  ].join('\n');
}
