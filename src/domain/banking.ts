import { z } from 'zod';

export const SYNTHETIC_DEMO_DISCLAIMER =
  'Synthetic Demo Data: All bank names, APY figures, editorial star ratings, and partner flags in this reference application are illustrative synthetic fixtures created for engineering demonstration and are not live banking offers or financial advice.';

export const EDITORIAL_INDEPENDENCE_STATEMENT =
  'Advertiser Disclosure: Some listed institutions are compensated partners ("Partner" badge). Compensation may influence which products appear in sponsored callouts, but strictly never alters our independent editorial star rating or algorithmic net-yield / APY ranking order.';

export const FDIC_NCUA_GLOBAL_DISCLOSURE =
  'Deposit Insurance Disclosure: Eligible deposit accounts listed in this comparison are FDIC-insured (banks) or NCUA-insured (credit unions) up to $250,000 per depositor, per ownership category, per institution.';

export const DEFAULT_MAX_STALE_HOURS = 72;

export const AccountTypeSchema = z.enum(['HYSA', 'CD']);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const SortModeSchema = z.enum([
  'best_net_yield',
  'highest_apy',
  'no_min_balance',
  'editorial_pick',
]);
export type SortMode = z.infer<typeof SortModeSchema>;

export interface BalanceTier {
  minBalanceUsd: number;
  maxBalanceUsd: number | null;
  apyPct: number;
}

export interface BankingProduct {
  id: string;
  slug: string;
  institutionName: string;
  productName: string;
  accountType: AccountType;
  /** Standard annual percentage yield (Reg DD APY, %). */
  baseApyPct: number;
  /** Optional introductory promotional APY (%). */
  promoApyPct?: number;
  /** Months the introductory promo APY applies before reverting to base/tiered APY. */
  promoDurationMonths?: number;
  /** Optional balance tiers; supports blended marginal tiers or balance-threshold tiers. */
  balanceTiers?: BalanceTier[];
  tierMode?: 'blended' | 'threshold';
  minDepositUsd: number;
  monthlyFeeUsd: number;
  /** If defined, monthly fee is waived whenever account balance >= this threshold. */
  feeWaiverMinBalanceUsd?: number;
  /** Applicable term for CDs (in months). */
  cdTermMonths?: number;
  insuranceType: 'FDIC' | 'NCUA';
  insuranceLimitUsd: number;
  /** Independent editorial rating (1.0 - 5.0). */
  editorialRating: number;
  /** Transparent partner / affiliate disclosure flag. */
  isPartner: boolean;
  partnerDisclosureText: string;
  highlights: string[];
  applyUrl: string;
  /** ISO-8601 UTC timestamp when rate was last verified against institution source. */
  rateVerifiedAt: string;
  /** Maximum allowed staleness in hours before compliance guardrail flags/demotes product. */
  maxStaleHours: number;
}

export type RateFreshnessStatus = 'fresh' | 'expiring_soon' | 'stale';

export interface RateFreshnessEvaluation {
  status: RateFreshnessStatus;
  isStale: boolean;
  ageHours: number;
  maxStaleHours: number;
  staleByHours: number;
  verifiedAtIso: string;
  complianceMessage: string;
}

export interface YieldCalculationInput {
  depositUsd: number;
  months: number;
}

export interface MonthlyBreakdownPoint {
  month: number;
  appliedApyPct: number;
  interestEarnedUsd: number;
  feeChargedUsd: number;
  endingBalanceUsd: number;
}

export interface YieldCalculationResult {
  depositUsd: number;
  months: number;
  meetsMinimumDeposit: boolean;
  headlineApyPct: number;
  effectiveAnnualizedNetYieldPct: number;
  grossInterestUsd: number;
  totalFeesUsd: number;
  netReturnUsd: number;
  endingBalanceUsd: number;
  promoAppliedMonths: number;
  promoExpiredDuringTerm: boolean;
  promoExpiryNotice: string | null;
  feeDragPctOfInterest: number;
  schedule: MonthlyBreakdownPoint[];
}

export interface RankedBankingProduct {
  rank: number;
  product: BankingProduct;
  yieldSummary: YieldCalculationResult;
  freshness: RateFreshnessEvaluation;
  demotedForStaleness: boolean;
  disclosureBadge: 'Partner' | 'Independent';
  insuranceBadge: string;
  eligibilityWarning: string | null;
}

export interface RankingOptions {
  depositUsd: number;
  months: number;
  sort: SortMode;
  accountType?: 'ALL' | AccountType;
  noFeeOnly?: boolean;
  /**
   * Compliance policy for stale rates (> maxStaleHours):
   * - 'exclude': omits stale rates from public comparison tables (default safe mode)
   * - 'demote': retains stale rates strictly at the bottom with explicit compliance warning
   */
  stalePolicy?: 'exclude' | 'demote';
  now?: Date;
}

export interface MarketplaceComparisonResponse {
  disclaimer: string;
  editorialIndependenceStatement: string;
  insuranceDisclosure: string;
  generatedAt: string;
  query: {
    depositUsd: number;
    months: number;
    sort: SortMode;
    accountType: 'ALL' | AccountType;
    noFeeOnly: boolean;
    stalePolicy: 'exclude' | 'demote';
  };
  freshnessSummary: {
    totalCatalogProducts: number;
    freshCount: number;
    expiringSoonCount: number;
    staleDetectedCount: number;
    staleExcludedCount: number;
    staleDemotedCount: number;
    maxAllowedStaleHours: number;
  };
  results: RankedBankingProduct[];
}

export const ComparisonQuerySchema = z.object({
  deposit: z.coerce.number().min(100).max(10_000_000).default(25_000),
  months: z.coerce.number().int().min(1).max(120).default(12),
  sort: SortModeSchema.default('best_net_yield'),
  accountType: z.enum(['ALL', 'HYSA', 'CD']).default('ALL'),
  noFeeOnly: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (typeof val === 'boolean') return val;
      if (typeof val === 'string') {
        return val === 'true' || val === '1' || val === 'on';
      }
      return false;
    }),
  includeStale: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (typeof val === 'boolean') return val;
      if (typeof val === 'string') {
        return val === 'true' || val === '1';
      }
      return false;
    }),
});

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPct(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Computes the effective annual APY (%) for a given balance under a product's
 * standard or tiered rate schedule (excluding temporary promo override).
 */
export function resolveStandardApyForBalance(
  product: BankingProduct,
  balanceUsd: number,
): number {
  const tiers = product.balanceTiers;
  if (!tiers || tiers.length === 0 || balanceUsd <= 0) {
    return product.baseApyPct;
  }

  const sortedTiers = [...tiers].sort(
    (a, b) => a.minBalanceUsd - b.minBalanceUsd,
  );

  if (product.tierMode === 'blended') {
    let weightedSum = 0;
    let coveredBalance = 0;

    for (const tier of sortedTiers) {
      if (balanceUsd <= tier.minBalanceUsd) continue;
      const upper =
        tier.maxBalanceUsd === null
          ? balanceUsd
          : Math.min(balanceUsd, tier.maxBalanceUsd);
      const slice = Math.max(0, upper - tier.minBalanceUsd);
      if (slice > 0) {
        weightedSum += slice * tier.apyPct;
        coveredBalance += slice;
      }
    }

    if (coveredBalance <= 0) {
      return product.baseApyPct;
    }
    return weightedSum / coveredBalance;
  }

  // Default 'threshold' mode: highest matching balance tier wins for full balance
  let matchedApy = product.baseApyPct;
  for (const tier of sortedTiers) {
    const aboveMin = balanceUsd >= tier.minBalanceUsd;
    const belowMax =
      tier.maxBalanceUsd === null || balanceUsd <= tier.maxBalanceUsd;
    if (aboveMin && belowMax) {
      matchedApy = tier.apyPct;
    }
  }
  return matchedApy;
}

/**
 * Reg DD compliant monthly compounding yield & net return simulator.
 * Converts annual APY to effective monthly compounding rate: (1 + APY)^(1/12) - 1,
 * handles promo APY duration & expiry, balance tiers, and monthly fee drag/waivers.
 */
export function calculateCompoundYield(
  product: BankingProduct,
  input: YieldCalculationInput,
): YieldCalculationResult {
  const depositUsd = Math.max(0, input.depositUsd);
  const months = Math.max(1, Math.floor(input.months));
  const meetsMinimumDeposit = depositUsd >= product.minDepositUsd;

  let balance = depositUsd;
  let grossInterest = 0;
  let totalFees = 0;
  let promoAppliedMonths = 0;
  const schedule: MonthlyBreakdownPoint[] = [];

  const promoDuration =
    product.promoApyPct !== undefined && product.promoDurationMonths
      ? Math.max(0, product.promoDurationMonths)
      : 0;

  for (let m = 1; m <= months; m += 1) {
    const inPromoWindow =
      product.promoApyPct !== undefined && m <= promoDuration;
    const appliedApyPct = inPromoWindow
      ? product.promoApyPct!
      : resolveStandardApyForBalance(product, balance);

    if (inPromoWindow) {
      promoAppliedMonths += 1;
    }

    const monthlyRate = Math.pow(1 + appliedApyPct / 100, 1 / 12) - 1;
    const interest = balance * monthlyRate;

    const feeWaived =
      product.monthlyFeeUsd <= 0 ||
      (product.feeWaiverMinBalanceUsd !== undefined &&
        balance >= product.feeWaiverMinBalanceUsd);
    const fee = feeWaived ? 0 : product.monthlyFeeUsd;

    balance = Math.max(0, balance + interest - fee);
    grossInterest += interest;
    totalFees += fee;

    schedule.push({
      month: m,
      appliedApyPct: roundPct(appliedApyPct),
      interestEarnedUsd: roundCurrency(interest),
      feeChargedUsd: roundCurrency(fee),
      endingBalanceUsd: roundCurrency(balance),
    });
  }

  const netReturnUsd = roundCurrency(balance - depositUsd);
  const grossInterestUsd = roundCurrency(grossInterest);
  const totalFeesUsd = roundCurrency(totalFees);
  const endingBalanceUsd = roundCurrency(balance);

  const effectiveAnnualizedNetYieldPct =
    depositUsd > 0
      ? roundPct((Math.pow(balance / depositUsd, 12 / months) - 1) * 100)
      : 0;

  const initialApy =
    promoDuration > 0 && product.promoApyPct !== undefined
      ? product.promoApyPct
      : resolveStandardApyForBalance(product, depositUsd);

  const promoExpiredDuringTerm =
    promoDuration > 0 &&
    product.promoApyPct !== undefined &&
    months > promoDuration;

  const promoExpiryNotice =
    promoDuration > 0 && product.promoApyPct !== undefined
      ? promoExpiredDuringTerm
        ? `Intro ${product.promoApyPct.toFixed(2)}% APY expires after month ${promoDuration}; reverts to ${product.baseApyPct.toFixed(2)}% standard APY.`
        : `Intro ${product.promoApyPct.toFixed(2)}% APY active for full ${months}-month window (reverts to ${product.baseApyPct.toFixed(2)}% after month ${promoDuration}).`
      : null;

  const feeDragPctOfInterest =
    grossInterest > 0 ? roundPct((totalFees / grossInterest) * 100) : totalFees > 0 ? 100 : 0;

  return {
    depositUsd: roundCurrency(depositUsd),
    months,
    meetsMinimumDeposit,
    headlineApyPct: roundPct(initialApy),
    effectiveAnnualizedNetYieldPct,
    grossInterestUsd,
    totalFeesUsd,
    netReturnUsd,
    endingBalanceUsd,
    promoAppliedMonths,
    promoExpiredDuringTerm,
    promoExpiryNotice,
    feeDragPctOfInterest,
    schedule,
  };
}

/**
 * Compliance guardrail enforcing rate freshness so consumer banking pages
 * never promote expired or unverified APYs beyond `maxStaleHours` (default 72h).
 */
export function evaluateRateFreshness(
  product: BankingProduct,
  now: Date = new Date(),
): RateFreshnessEvaluation {
  const verifiedMs = Date.parse(product.rateVerifiedAt);
  const maxStaleHours = product.maxStaleHours || DEFAULT_MAX_STALE_HOURS;

  if (Number.isNaN(verifiedMs)) {
    return {
      status: 'stale',
      isStale: true,
      ageHours: Number.POSITIVE_INFINITY,
      maxStaleHours,
      staleByHours: Number.POSITIVE_INFINITY,
      verifiedAtIso: product.rateVerifiedAt,
      complianceMessage: 'Invalid rate verification timestamp — blocked by compliance guardrail.',
    };
  }

  const rawAgeHours = Math.max(0, (now.getTime() - verifiedMs) / 3_600_000);
  const ageHours = Math.round(rawAgeHours * 10) / 10;

  if (rawAgeHours > maxStaleHours) {
    const staleByHours = Math.round((rawAgeHours - maxStaleHours) * 10) / 10;
    return {
      status: 'stale',
      isStale: true,
      ageHours,
      maxStaleHours,
      staleByHours,
      verifiedAtIso: new Date(verifiedMs).toISOString(),
      complianceMessage: `STALE RATE: verified ${ageHours}h ago (exceeds ${maxStaleHours}h policy by ${staleByHours}h).`,
    };
  }

  if (rawAgeHours >= maxStaleHours * 0.75) {
    return {
      status: 'expiring_soon',
      isStale: false,
      ageHours,
      maxStaleHours,
      staleByHours: 0,
      verifiedAtIso: new Date(verifiedMs).toISOString(),
      complianceMessage: `Verified ${ageHours}h ago (re-verification recommended before ${maxStaleHours}h limit).`,
    };
  }

  return {
    status: 'fresh',
    isStale: false,
    ageHours,
    maxStaleHours,
    staleByHours: 0,
    verifiedAtIso: new Date(verifiedMs).toISOString(),
    complianceMessage: `Verified ${ageHours}h ago (within ${maxStaleHours}h SLA).`,
  };
}

function hoursAgoIso(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}

/**
 * Returns the curated synthetic Consumer Banking HYSA & CD marketplace catalog.
 * Rate timestamps default relative to `now` so live audit verification always
 * validates fresh verified fixtures while tests can inject historical dates.
 */
export function getDefaultBankingCatalog(now: Date = new Date()): BankingProduct[] {
  return [
    {
      id: 'hysa-harborline-premier',
      slug: 'harborline-premier-savings',
      institutionName: 'Harborline Digital Bank (Demo)',
      productName: 'Harborline Premier High-Yield Savings',
      accountType: 'HYSA',
      baseApyPct: 4.55,
      minDepositUsd: 0,
      monthlyFeeUsd: 0,
      insuranceType: 'FDIC',
      insuranceLimitUsd: 250_000,
      editorialRating: 4.9,
      isPartner: false,
      partnerDisclosureText:
        'Non-partner — independently reviewed; no referral fee received.',
      highlights: [
        'No minimum opening deposit or monthly maintenance fee',
        'Same-day ACH transfers and automated savings buckets',
        'Consistently top-decile APY with zero promo cliff',
      ],
      applyUrl: 'https://example.com/demo/harborline-premier-savings',
      rateVerifiedAt: hoursAgoIso(now, 3),
      maxStaleHours: 72,
    },
    {
      id: 'hysa-apex-boost',
      slug: 'apex-boost-savings',
      institutionName: 'Apex Direct Bank (Demo)',
      productName: 'Apex Boost Promo Savings',
      accountType: 'HYSA',
      baseApyPct: 4.10,
      promoApyPct: 5.25,
      promoDurationMonths: 3,
      minDepositUsd: 500,
      monthlyFeeUsd: 0,
      insuranceType: 'FDIC',
      insuranceLimitUsd: 250_000,
      editorialRating: 4.5,
      isPartner: true,
      partnerDisclosureText:
        'Paid Partner — compensation does not influence editorial rating or net-yield rank.',
      highlights: [
        '5.25% intro APY for first 3 months, then 4.10% standard APY',
        '$0 monthly fee; $500 minimum opening deposit',
        '24/7 U.S.-based phone support and mobile check deposit',
      ],
      applyUrl: 'https://example.com/demo/apex-boost-savings',
      rateVerifiedAt: hoursAgoIso(now, 6),
      maxStaleHours: 72,
    },
    {
      id: 'hysa-summit-credit-union',
      slug: 'summit-horizon-hysa',
      institutionName: 'Summit Horizon Credit Union (Demo)',
      productName: 'Horizon Tiered High-Yield Share Savings',
      accountType: 'HYSA',
      baseApyPct: 3.90,
      balanceTiers: [
        { minBalanceUsd: 0, maxBalanceUsd: 10_000, apyPct: 5.10 },
        { minBalanceUsd: 10_000, maxBalanceUsd: null, apyPct: 4.20 },
      ],
      tierMode: 'blended',
      minDepositUsd: 0,
      monthlyFeeUsd: 0,
      insuranceType: 'NCUA',
      insuranceLimitUsd: 250_000,
      editorialRating: 4.8,
      isPartner: false,
      partnerDisclosureText:
        'Non-partner credit union — independently reviewed by editorial team.',
      highlights: [
        '5.10% APY on first $10,000; 4.20% APY on balances above $10,000',
        'NCUA federally insured up to $250,000',
        'Zero monthly fees and nationwide co-op ATM access',
      ],
      applyUrl: 'https://example.com/demo/summit-horizon-hysa',
      rateVerifiedAt: hoursAgoIso(now, 11),
      maxStaleHours: 72,
    },
    {
      id: 'hysa-cedar-relationship',
      slug: 'cedar-national-preferred',
      institutionName: 'Cedar National Bank (Demo)',
      productName: 'Cedar Preferred Relationship Savings',
      accountType: 'HYSA',
      baseApyPct: 4.40,
      minDepositUsd: 1_000,
      monthlyFeeUsd: 12,
      feeWaiverMinBalanceUsd: 15_000,
      insuranceType: 'FDIC',
      insuranceLimitUsd: 250_000,
      editorialRating: 4.1,
      isPartner: true,
      partnerDisclosureText:
        'Paid Partner — compensation does not influence editorial rating or net-yield rank.',
      highlights: [
        '4.40% standard APY across all qualifying balances',
        '$12/mo maintenance fee waived at $15,000+ balance',
        'Branch + online hybrid banking access',
      ],
      applyUrl: 'https://example.com/demo/cedar-national-preferred',
      rateVerifiedAt: hoursAgoIso(now, 18),
      maxStaleHours: 72,
    },
    {
      id: 'cd-beacon-12m',
      slug: 'beacon-reserve-12-month-cd',
      institutionName: 'Beacon Reserve Bank (Demo)',
      productName: 'Beacon Reserve 12-Month Fixed CD',
      accountType: 'CD',
      baseApyPct: 4.80,
      cdTermMonths: 12,
      minDepositUsd: 1_000,
      monthlyFeeUsd: 0,
      insuranceType: 'FDIC',
      insuranceLimitUsd: 250_000,
      editorialRating: 4.7,
      isPartner: true,
      partnerDisclosureText:
        'Paid Partner — compensation does not influence editorial rating or net-yield rank.',
      highlights: [
        'Locked 4.80% APY guaranteed for 12-month CD term',
        '$1,000 minimum opening deposit, $0 monthly maintenance fee',
        '10-day maturity grace period with automatic rate-lock option',
      ],
      applyUrl: 'https://example.com/demo/beacon-reserve-12-month-cd',
      rateVerifiedAt: hoursAgoIso(now, 8),
      maxStaleHours: 72,
    },
    {
      id: 'cd-clearwater-no-penalty',
      slug: 'clearwater-no-penalty-cd',
      institutionName: 'Clearwater Online Bank (Demo)',
      productName: 'Clearwater 11-Month No-Penalty CD',
      accountType: 'CD',
      baseApyPct: 4.45,
      cdTermMonths: 11,
      minDepositUsd: 500,
      monthlyFeeUsd: 0,
      insuranceType: 'FDIC',
      insuranceLimitUsd: 250_000,
      editorialRating: 4.6,
      isPartner: false,
      partnerDisclosureText:
        'Non-partner — independently reviewed by editorial team.',
      highlights: [
        'Withdraw full balance + interest penalty-free after 7 days',
        '$500 minimum deposit with zero monthly fees',
        'Strong downside rate protection if market rates decline',
      ],
      applyUrl: 'https://example.com/demo/clearwater-no-penalty-cd',
      rateVerifiedAt: hoursAgoIso(now, 22),
      maxStaleHours: 72,
    },
    {
      id: 'hysa-meridian-jumbo',
      slug: 'meridian-jumbo-tier-savings',
      institutionName: 'Meridian Coast Bank (Demo)',
      productName: 'Meridian High-Balance Tier Savings',
      accountType: 'HYSA',
      baseApyPct: 3.40,
      balanceTiers: [
        { minBalanceUsd: 0, maxBalanceUsd: 24_999.99, apyPct: 3.40 },
        { minBalanceUsd: 25_000, maxBalanceUsd: null, apyPct: 4.70 },
      ],
      tierMode: 'threshold',
      minDepositUsd: 100,
      monthlyFeeUsd: 0,
      insuranceType: 'FDIC',
      insuranceLimitUsd: 250_000,
      editorialRating: 4.4,
      isPartner: true,
      partnerDisclosureText:
        'Paid Partner — compensation does not influence editorial rating or net-yield rank.',
      highlights: [
        '4.70% APY unlocked automatically on balances of $25,000+',
        '3.40% APY on balances below $25,000; $0 monthly fee',
        'Free incoming domestic wire transfers',
      ],
      applyUrl: 'https://example.com/demo/meridian-jumbo-tier-savings',
      rateVerifiedAt: hoursAgoIso(now, 30),
      maxStaleHours: 72,
    },
  ];
}

/**
 * Creates a stale-rate product fixture (>72h unverified) for compliance testing.
 */
export function createStaleFixtureProduct(
  now: Date = new Date(),
  ageHours = 96,
): BankingProduct {
  return {
    id: 'hysa-expired-stale-demo',
    slug: 'expired-stale-savings-demo',
    institutionName: 'Legacy Stale Rate Bank (Demo)',
    productName: 'Unverified High-APY Promo Account',
    accountType: 'HYSA',
    baseApyPct: 5.95,
    minDepositUsd: 0,
    monthlyFeeUsd: 0,
    insuranceType: 'FDIC',
    insuranceLimitUsd: 250_000,
    editorialRating: 4.9,
    isPartner: true,
    partnerDisclosureText:
      'Paid Partner — held from active ranking when rate verification expires.',
    highlights: ['Fixture representing an expired >72h unverified rate feed'],
    applyUrl: 'https://example.com/demo/expired-stale-savings',
    rateVerifiedAt: hoursAgoIso(now, ageHours),
    maxStaleHours: 72,
  };
}

/**
 * Ranks and filters banking products using strict editorial independence
 * (paid partner status NEVER boosts ranking) and rate freshness compliance.
 */
export function rankBankingProducts(
  catalog: BankingProduct[],
  options: RankingOptions,
): MarketplaceComparisonResponse {
  const now = options.now ?? new Date();
  const accountType = options.accountType ?? 'ALL';
  const noFeeOnly = options.noFeeOnly ?? false;
  const stalePolicy = options.stalePolicy ?? 'exclude';

  let freshCount = 0;
  let expiringSoonCount = 0;
  let staleDetectedCount = 0;
  let staleExcludedCount = 0;
  let staleDemotedCount = 0;

  const evaluated = catalog
    .filter((p) => accountType === 'ALL' || p.accountType === accountType)
    .filter((p) => !noFeeOnly || p.monthlyFeeUsd === 0)
    .map((product) => {
      const freshness = evaluateRateFreshness(product, now);
      if (freshness.status === 'fresh') freshCount += 1;
      else if (freshness.status === 'expiring_soon') expiringSoonCount += 1;
      else staleDetectedCount += 1;

      const yieldSummary = calculateCompoundYield(product, {
        depositUsd: options.depositUsd,
        months: options.months,
      });

      const eligibilityWarning = !yieldSummary.meetsMinimumDeposit
        ? `Requires $${product.minDepositUsd.toLocaleString('en-US')} minimum opening deposit (current input: $${options.depositUsd.toLocaleString('en-US')}).`
        : null;

      return {
        product,
        yieldSummary,
        freshness,
        demotedForStaleness: freshness.isStale,
        disclosureBadge: product.isPartner
          ? ('Partner' as const)
          : ('Independent' as const),
        insuranceBadge: `${product.insuranceType} Insured up to $${product.insuranceLimitUsd.toLocaleString('en-US')}`,
        eligibilityWarning,
      };
    });

  const filtered = evaluated.filter((item) => {
    if (item.freshness.isStale && stalePolicy === 'exclude') {
      staleExcludedCount += 1;
      return false;
    }
    if (item.freshness.isStale && stalePolicy === 'demote') {
      staleDemotedCount += 1;
    }
    return true;
  });

  filtered.sort((a, b) => {
    // Compliance invariant: stale products are ALWAYS pushed strictly below fresh offers
    if (a.demotedForStaleness !== b.demotedForStaleness) {
      return a.demotedForStaleness ? 1 : -1;
    }

    // Eligibility invariant: eligible offers rank ahead of offers where deposit < minDeposit
    if (a.yieldSummary.meetsMinimumDeposit !== b.yieldSummary.meetsMinimumDeposit) {
      return a.yieldSummary.meetsMinimumDeposit ? -1 : 1;
    }

    switch (options.sort) {
      case 'highest_apy': {
        const apyDiff = b.yieldSummary.headlineApyPct - a.yieldSummary.headlineApyPct;
        if (apyDiff !== 0) return apyDiff;
        return b.yieldSummary.netReturnUsd - a.yieldSummary.netReturnUsd;
      }
      case 'no_min_balance': {
        const aNoMin = a.product.minDepositUsd === 0 ? 1 : 0;
        const bNoMin = b.product.minDepositUsd === 0 ? 1 : 0;
        if (bNoMin !== aNoMin) return bNoMin - aNoMin;
        const minDiff = a.product.minDepositUsd - b.product.minDepositUsd;
        if (minDiff !== 0) return minDiff;
        return b.yieldSummary.netReturnUsd - a.yieldSummary.netReturnUsd;
      }
      case 'editorial_pick': {
        // Editorial independence invariant: strictly sorted by editorialRating, NEVER isPartner
        const ratingDiff = b.product.editorialRating - a.product.editorialRating;
        if (ratingDiff !== 0) return ratingDiff;
        return b.yieldSummary.netReturnUsd - a.yieldSummary.netReturnUsd;
      }
      case 'best_net_yield':
      default: {
        const netDiff = b.yieldSummary.netReturnUsd - a.yieldSummary.netReturnUsd;
        if (netDiff !== 0) return netDiff;
        return b.product.editorialRating - a.product.editorialRating;
      }
    }
  });

  const results: RankedBankingProduct[] = filtered.map((item, idx) => ({
    rank: idx + 1,
    ...item,
  }));

  return {
    disclaimer: SYNTHETIC_DEMO_DISCLAIMER,
    editorialIndependenceStatement: EDITORIAL_INDEPENDENCE_STATEMENT,
    insuranceDisclosure: FDIC_NCUA_GLOBAL_DISCLOSURE,
    generatedAt: now.toISOString(),
    query: {
      depositUsd: roundCurrency(options.depositUsd),
      months: options.months,
      sort: options.sort,
      accountType,
      noFeeOnly,
      stalePolicy,
    },
    freshnessSummary: {
      totalCatalogProducts: catalog.length,
      freshCount,
      expiringSoonCount,
      staleDetectedCount,
      staleExcludedCount,
      staleDemotedCount,
      maxAllowedStaleHours: DEFAULT_MAX_STALE_HOURS,
    },
    results,
  };
}
