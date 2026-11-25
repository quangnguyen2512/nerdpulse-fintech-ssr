import { describe, expect, it } from 'vitest';
import {
  BankingProduct,
  calculateCompoundYield,
  createStaleFixtureProduct,
  evaluateRateFreshness,
  getDefaultBankingCatalog,
  rankBankingProducts,
} from '../src/domain/banking.js';

const FIXED_NOW = new Date('2026-11-25T15:00:00.000Z');

describe('banking domain — compound APY, fee drag, promo expiry & balance tiers', () => {
  it('computes exact Reg DD monthly compounding APY over 12 and 24 months', () => {
    const cleanAccount: BankingProduct = {
      id: 'test-flat-5',
      slug: 'test-flat-5',
      institutionName: 'Test Bank',
      productName: 'Flat 5% HYSA',
      accountType: 'HYSA',
      baseApyPct: 5.0,
      minDepositUsd: 0,
      monthlyFeeUsd: 0,
      insuranceType: 'FDIC',
      insuranceLimitUsd: 250_000,
      editorialRating: 4.8,
      isPartner: false,
      partnerDisclosureText: 'Independent',
      highlights: [],
      applyUrl: 'https://example.com/flat-5',
      rateVerifiedAt: FIXED_NOW.toISOString(),
      maxStaleHours: 72,
    };

    const oneYear = calculateCompoundYield(cleanAccount, {
      depositUsd: 10_000,
      months: 12,
    });
    expect(oneYear.endingBalanceUsd).toBe(10_500);
    expect(oneYear.netReturnUsd).toBe(500);
    expect(oneYear.grossInterestUsd).toBe(500);
    expect(oneYear.totalFeesUsd).toBe(0);
    expect(oneYear.effectiveAnnualizedNetYieldPct).toBe(5.0);
    expect(oneYear.schedule).toHaveLength(12);

    const twoYears = calculateCompoundYield(cleanAccount, {
      depositUsd: 10_000,
      months: 24,
    });
    expect(twoYears.endingBalanceUsd).toBe(11_025);
    expect(twoYears.netReturnUsd).toBe(1_025);
  });

  it('models monthly fee drag below waiver threshold and waives fee at/above threshold', () => {
    const catalog = getDefaultBankingCatalog(FIXED_NOW);
    const cedar = catalog.find((p) => p.id === 'hysa-cedar-relationship')!;
    expect(cedar).toBeDefined();

    // $5,000 is below $15,000 fee waiver threshold -> pays $12/mo ($144/yr)
    const smallDeposit = calculateCompoundYield(cedar, {
      depositUsd: 5_000,
      months: 12,
    });
    expect(smallDeposit.totalFeesUsd).toBe(144);
    expect(smallDeposit.netReturnUsd).toBeLessThan(smallDeposit.grossInterestUsd);
    expect(smallDeposit.effectiveAnnualizedNetYieldPct).toBeLessThan(2.0);
    expect(smallDeposit.feeDragPctOfInterest).toBeGreaterThan(60);

    // $25,000 exceeds $15,000 fee waiver -> $0 fees
    const waivedDeposit = calculateCompoundYield(cedar, {
      depositUsd: 25_000,
      months: 12,
    });
    expect(waivedDeposit.totalFeesUsd).toBe(0);
    expect(waivedDeposit.effectiveAnnualizedNetYieldPct).toBe(4.4);
  });

  it('handles promotional APY window and reverts to standard base APY upon expiry', () => {
    const catalog = getDefaultBankingCatalog(FIXED_NOW);
    const apex = catalog.find((p) => p.id === 'hysa-apex-boost')!;
    expect(apex).toBeDefined();

    const fullYear = calculateCompoundYield(apex, {
      depositUsd: 20_000,
      months: 12,
    });
    expect(fullYear.promoAppliedMonths).toBe(3);
    expect(fullYear.promoExpiredDuringTerm).toBe(true);
    expect(fullYear.promoExpiryNotice).toContain('expires after month 3');
    expect(fullYear.schedule[0]?.appliedApyPct).toBe(5.25);
    expect(fullYear.schedule[2]?.appliedApyPct).toBe(5.25);
    expect(fullYear.schedule[3]?.appliedApyPct).toBe(4.1);
    expect(fullYear.effectiveAnnualizedNetYieldPct).toBeGreaterThan(4.1);
    expect(fullYear.effectiveAnnualizedNetYieldPct).toBeLessThan(5.25);
  });

  it('evaluates blended marginal tiers and threshold balance tiers accurately', () => {
    const catalog = getDefaultBankingCatalog(FIXED_NOW);
    const summit = catalog.find((p) => p.id === 'hysa-summit-credit-union')!;
    const meridian = catalog.find((p) => p.id === 'hysa-meridian-jumbo')!;

    // Summit: 5.10% on first $10k, 4.20% above $10k -> at $20k initial blended APY is 4.65%
    const summit20k = calculateCompoundYield(summit, {
      depositUsd: 20_000,
      months: 12,
    });
    expect(summit20k.headlineApyPct).toBe(4.65);

    // Meridian: threshold $25k unlocks 4.70% vs 3.40% below $25k
    const meridian10k = calculateCompoundYield(meridian, {
      depositUsd: 10_000,
      months: 12,
    });
    const meridian25k = calculateCompoundYield(meridian, {
      depositUsd: 25_000,
      months: 12,
    });
    expect(meridian10k.headlineApyPct).toBe(3.4);
    expect(meridian25k.headlineApyPct).toBe(4.7);
  });
});

describe('banking domain — rate freshness guardrail & editorial independence ranking', () => {
  it('flags rates verified > 72h ago as stale and excludes or demotes them', () => {
    const freshCatalog = getDefaultBankingCatalog(FIXED_NOW);
    const staleHighApy = createStaleFixtureProduct(FIXED_NOW, 96); // 5.95% APY but 96h old
    const mixedCatalog = [...freshCatalog, staleHighApy];

    const freshness = evaluateRateFreshness(staleHighApy, FIXED_NOW);
    expect(freshness.status).toBe('stale');
    expect(freshness.isStale).toBe(true);
    expect(freshness.staleByHours).toBe(24);

    // Default exclude policy completely hides stale high-APY offer from public table
    const excluded = rankBankingProducts(mixedCatalog, {
      depositUsd: 25_000,
      months: 12,
      sort: 'highest_apy',
      stalePolicy: 'exclude',
      now: FIXED_NOW,
    });
    expect(excluded.freshnessSummary.staleDetectedCount).toBe(1);
    expect(excluded.freshnessSummary.staleExcludedCount).toBe(1);
    expect(excluded.results.some((r) => r.product.id === staleHighApy.id)).toBe(false);

    // Demote policy pushes stale 5.95% APY offer strictly to last place with compliance flag
    const demoted = rankBankingProducts(mixedCatalog, {
      depositUsd: 25_000,
      months: 12,
      sort: 'highest_apy',
      stalePolicy: 'demote',
      now: FIXED_NOW,
    });
    expect(demoted.freshnessSummary.staleDemotedCount).toBe(1);
    const last = demoted.results[demoted.results.length - 1]!;
    expect(last.product.id).toBe(staleHighApy.id);
    expect(last.demotedForStaleness).toBe(true);
  });

  it('enforces editorial independence and transparent sort/filter modes', () => {
    const catalog = getDefaultBankingCatalog(FIXED_NOW);

    // Under editorial_pick, highest-rated non-partner (Harborline 4.9) beats every paid partner
    const editorial = rankBankingProducts(catalog, {
      depositUsd: 25_000,
      months: 12,
      sort: 'editorial_pick',
      now: FIXED_NOW,
    });
    expect(editorial.results[0]!.product.id).toBe('hysa-harborline-premier');
    expect(editorial.results[0]!.product.isPartner).toBe(false);
    expect(editorial.results[0]!.disclosureBadge).toBe('Independent');

    // noFeeOnly excludes Cedar ($12/mo fee)
    const noFee = rankBankingProducts(catalog, {
      depositUsd: 5_000,
      months: 12,
      sort: 'best_net_yield',
      noFeeOnly: true,
      now: FIXED_NOW,
    });
    expect(noFee.results.every((r) => r.product.monthlyFeeUsd === 0)).toBe(true);
    expect(noFee.results.some((r) => r.product.id === 'hysa-cedar-relationship')).toBe(false);

    // accountType=CD returns only CDs
    const cdsOnly = rankBankingProducts(catalog, {
      depositUsd: 10_000,
      months: 12,
      sort: 'highest_apy',
      accountType: 'CD',
      now: FIXED_NOW,
    });
    expect(cdsOnly.results.length).toBe(2);
    expect(cdsOnly.results.every((r) => r.product.accountType === 'CD')).toBe(true);
    expect(cdsOnly.results[0]!.product.id).toBe('cd-beacon-12m');

    // no_min_balance puts $0 minimum accounts first
    const noMin = rankBankingProducts(catalog, {
      depositUsd: 500,
      months: 12,
      sort: 'no_min_balance',
      now: FIXED_NOW,
    });
    expect(noMin.results[0]!.product.minDepositUsd).toBe(0);
    expect(noMin.results[1]!.product.minDepositUsd).toBe(0);
  });
});
