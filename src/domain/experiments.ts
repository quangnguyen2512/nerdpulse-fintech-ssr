import { createHash } from 'node:crypto';
import { z } from 'zod';

export const ExperimentVariantConfigSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  weightPct: z.number().gt(0).lte(100),
});

export const ExperimentConfigSchema = z
  .object({
    key: z.string().min(1),
    salt: z.string().default('v1'),
    holdoutPct: z.number().min(0).lt(100).default(0),
    holdoutVariantKey: z.string().default('holdout'),
    variants: z.array(ExperimentVariantConfigSchema).min(2),
  })
  .refine(
    (cfg) => {
      const sum = cfg.variants.reduce((acc, v) => acc + v.weightPct, 0);
      return Math.abs(sum - 100) < 0.001;
    },
    { message: 'Active experiment variant weights must sum to exactly 100%' },
  );

export type ExperimentVariantConfig = z.infer<typeof ExperimentVariantConfigSchema>;
export type ExperimentConfig = z.infer<typeof ExperimentConfigSchema>;

export interface BucketAssignment {
  experimentKey: string;
  visitorId: string;
  variantKey: string;
  variantLabel: string;
  isHoldout: boolean;
  /** Deterministic percentile in [0, 100) derived from SHA-256 hash. */
  hashBucketPct: number;
  assignedOnServer: true;
  expectedClientClsImpact: 0;
}

export const MarketplaceVariantKeySchema = z.enum([
  'hero_calc_above_fold',
  'comparison_table_first',
  'holdout',
]);
export type MarketplaceVariantKey = z.infer<typeof MarketplaceVariantKeySchema>;

export const DEFAULT_MARKETPLACE_EXPERIMENT: ExperimentConfig = {
  key: 'hysa_layout_v1',
  salt: '2026-q4-consumer-banking',
  holdoutPct: 0,
  holdoutVariantKey: 'holdout',
  variants: [
    {
      key: 'hero_calc_above_fold',
      label: 'Hero + Yield Calculator Above Fold (Control)',
      weightPct: 50,
    },
    {
      key: 'comparison_table_first',
      label: 'High-Intent Comparison Table First (Treatment)',
      weightPct: 50,
    },
  ],
};

/**
 * Deterministic SHA-256 hash mapping `(experimentKey, salt, visitorId)` to `[0, 100)`.
 * Runs strictly server-side before first byte so layout variants cause 0ms CLS.
 */
export function computeDeterministicBucketPct(
  experimentKey: string,
  visitorId: string,
  salt = 'v1',
): number {
  const digest = createHash('sha256')
    .update(`${experimentKey}:${salt}:${visitorId}`, 'utf8')
    .digest();
  // Use unsigned 32-bit integer from first 4 bytes for uniform [0, 1) projection
  const uint32 = digest.readUInt32BE(0);
  const ratio = uint32 / 0x1_0000_0000;
  return Math.floor(ratio * 10_000) / 100; // 0.00 .. 99.99
}

/**
 * Assigns a visitor deterministically to either the holdout group or one of the
 * configured treatment/control variants.
 */
export function assignExperimentBucket(
  experiment: ExperimentConfig,
  visitorId: string,
  forcedVariantKey?: string,
): BucketAssignment {
  const parsed = ExperimentConfigSchema.parse(experiment);
  const hashBucketPct = computeDeterministicBucketPct(
    parsed.key,
    visitorId,
    parsed.salt,
  );

  if (forcedVariantKey) {
    if (forcedVariantKey === parsed.holdoutVariantKey) {
      return {
        experimentKey: parsed.key,
        visitorId,
        variantKey: parsed.holdoutVariantKey,
        variantLabel: 'Holdout (Forced Preview)',
        isHoldout: true,
        hashBucketPct,
        assignedOnServer: true,
        expectedClientClsImpact: 0,
      };
    }
    const match = parsed.variants.find((v) => v.key === forcedVariantKey);
    if (match) {
      return {
        experimentKey: parsed.key,
        visitorId,
        variantKey: match.key,
        variantLabel: `${match.label} (Preview)`,
        isHoldout: false,
        hashBucketPct,
        assignedOnServer: true,
        expectedClientClsImpact: 0,
      };
    }
  }

  if (parsed.holdoutPct > 0 && hashBucketPct < parsed.holdoutPct) {
    return {
      experimentKey: parsed.key,
      visitorId,
      variantKey: parsed.holdoutVariantKey,
      variantLabel: 'Holdout Group',
      isHoldout: true,
      hashBucketPct,
      assignedOnServer: true,
      expectedClientClsImpact: 0,
    };
  }

  // Re-project remaining non-holdout space [holdoutPct, 100) into [0, 100)
  const activeSpace = 100 - parsed.holdoutPct;
  const normalizedPct = ((hashBucketPct - parsed.holdoutPct) / activeSpace) * 100;

  let cumulative = 0;
  for (const variant of parsed.variants) {
    cumulative += variant.weightPct;
    if (normalizedPct < cumulative) {
      return {
        experimentKey: parsed.key,
        visitorId,
        variantKey: variant.key,
        variantLabel: variant.label,
        isHoldout: false,
        hashBucketPct,
        assignedOnServer: true,
        expectedClientClsImpact: 0,
      };
    }
  }

  const fallback = parsed.variants[parsed.variants.length - 1]!;
  return {
    experimentKey: parsed.key,
    visitorId,
    variantKey: fallback.key,
    variantLabel: fallback.label,
    isHoldout: false,
    hashBucketPct,
    assignedOnServer: true,
    expectedClientClsImpact: 0,
  };
}

export const ExperimentEventTypeSchema = z.enum([
  'impression',
  'calculator_interact',
  'partner_click',
]);
export type ExperimentEventType = z.infer<typeof ExperimentEventTypeSchema>;

export interface ExperimentEvent {
  experimentKey: string;
  variantKey: string;
  visitorId: string;
  eventType: ExperimentEventType;
  productId?: string;
  timestamp: string;
}

export interface VariantFunnelStats {
  variantKey: string;
  expectedTrafficSharePct: number;
  observedTrafficSharePct: number;
  uniqueExposedVisitors: number;
  impressions: number;
  calculatorInteracts: number;
  partnerClicks: number;
  calculatorInteractRatePct: number;
  partnerClickCtrPct: number;
}

export interface SrmCheckResult {
  status: 'healthy' | 'srm_detected' | 'insufficient_data';
  srmDetected: boolean;
  totalObserved: number;
  degreesOfFreedom: number;
  chiSquare: number;
  pValue: number;
  alpha: number;
  minSampleSize: number;
  breakdown: Array<{
    variantKey: string;
    observed: number;
    expected: number;
    deviationPct: number;
  }>;
}

/** Lanczos approximation for ln(Gamma(z)) accurate to ~1e-13. */
function logGamma(z: number): number {
  const coeffs = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.001208650973866179,
    -0.000005395239384953,
  ];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < coeffs.length; j += 1) {
    y += 1;
    ser += coeffs[j]! / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Upper regularized incomplete gamma Q(a, x) for exact chi-square p-values. */
function regularizedGammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const gln = logGamma(a);
  if (x < a + 1) {
    // Series representation for P(a, x), return 1 - P
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= 200; n += 1) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    const p = sum * Math.exp(-x + a * Math.log(x) - gln);
    return Math.max(0, Math.min(1, 1 - p));
  }

  // Lentz's continued fraction for Q(a, x)
  const fpmin = 1e-30;
  let b = x + 1 - a;
  let c = 1 / fpmin;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 200; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = b + an / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - gln) * h;
  return Math.max(0, Math.min(1, q));
}

export function chiSquarePValue(chiSquare: number, df: number): number {
  if (df <= 0 || chiSquare <= 0) return 1;
  return regularizedGammaQ(df / 2, chiSquare / 2);
}

/**
 * Performs Pearson's chi-square Sample Ratio Mismatch (SRM) goodness-of-fit test.
 * Flags telemetry/bucketing corruption when p-value < alpha (default 0.001).
 */
export function checkSampleRatioMismatch(
  observedCounts: Record<string, number>,
  expectedWeightsPct: Record<string, number>,
  options?: { alpha?: number; minSampleSize?: number },
): SrmCheckResult {
  const alpha = options?.alpha ?? 0.001;
  const minSampleSize = options?.minSampleSize ?? 100;
  const variantKeys = Object.keys(expectedWeightsPct);
  const weightSum = variantKeys.reduce(
    (acc, k) => acc + (expectedWeightsPct[k] ?? 0),
    0,
  );
  const totalObserved = variantKeys.reduce(
    (acc, k) => acc + Math.max(0, observedCounts[k] ?? 0),
    0,
  );
  const df = Math.max(1, variantKeys.length - 1);

  const breakdown = variantKeys.map((variantKey) => {
    const observed = Math.max(0, observedCounts[variantKey] ?? 0);
    const expectedShare = weightSum > 0 ? (expectedWeightsPct[variantKey] ?? 0) / weightSum : 0;
    const expected = totalObserved * expectedShare;
    const deviationPct =
      expected > 0
        ? Math.round(((observed - expected) / expected) * 10000) / 100
        : 0;
    return {
      variantKey,
      observed,
      expected: Math.round(expected * 100) / 100,
      deviationPct,
    };
  });

  if (totalObserved < minSampleSize || weightSum <= 0) {
    return {
      status: 'insufficient_data',
      srmDetected: false,
      totalObserved,
      degreesOfFreedom: df,
      chiSquare: 0,
      pValue: 1,
      alpha,
      minSampleSize,
      breakdown,
    };
  }

  let chiSquare = 0;
  for (const row of breakdown) {
    if (row.expected > 0) {
      chiSquare += Math.pow(row.observed - row.expected, 2) / row.expected;
    }
  }

  const pValue = chiSquarePValue(chiSquare, df);
  const srmDetected = pValue < alpha;

  return {
    status: srmDetected ? 'srm_detected' : 'healthy',
    srmDetected,
    totalObserved,
    degreesOfFreedom: df,
    chiSquare: Math.round(chiSquare * 10000) / 10000,
    pValue: Number(pValue.toExponential(4)),
    alpha,
    minSampleSize,
    breakdown,
  };
}

export class ExperimentTracker {
  private readonly experiment: ExperimentConfig;
  private readonly events: ExperimentEvent[] = [];
  private readonly maxEvents: number;

  constructor(experiment: ExperimentConfig = DEFAULT_MARKETPLACE_EXPERIMENT, maxEvents = 50_000) {
    this.experiment = ExperimentConfigSchema.parse(experiment);
    this.maxEvents = maxEvents;
  }

  public getExperimentConfig(): ExperimentConfig {
    return this.experiment;
  }

  public record(event: Omit<ExperimentEvent, 'timestamp'> & { timestamp?: string }): void {
    const entry: ExperimentEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    this.events.push(entry);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  public getExpectedWeightMap(): Record<string, number> {
    const map: Record<string, number> = {};
    if (this.experiment.holdoutPct > 0) {
      map[this.experiment.holdoutVariantKey] = this.experiment.holdoutPct;
    }
    const activeFactor = (100 - this.experiment.holdoutPct) / 100;
    for (const v of this.experiment.variants) {
      map[v.key] = Math.round(v.weightPct * activeFactor * 1000) / 1000;
    }
    return map;
  }

  public summarize(srmOptions?: { alpha?: number; minSampleSize?: number }): {
    experimentKey: string;
    totalEvents: number;
    variants: VariantFunnelStats[];
    srm: SrmCheckResult;
  } {
    const expectedMap = this.getExpectedWeightMap();
    const variantKeys = Object.keys(expectedMap);

    const exposedByVariant = new Map<string, Set<string>>();
    const interactedByVariant = new Map<string, Set<string>>();
    const clickedByVariant = new Map<string, Set<string>>();
    const countsByVariant = new Map<
      string,
      { impressions: number; calculatorInteracts: number; partnerClicks: number }
    >();

    for (const key of variantKeys) {
      exposedByVariant.set(key, new Set());
      interactedByVariant.set(key, new Set());
      clickedByVariant.set(key, new Set());
      countsByVariant.set(key, {
        impressions: 0,
        calculatorInteracts: 0,
        partnerClicks: 0,
      });
    }

    for (const ev of this.events) {
      if (ev.experimentKey !== this.experiment.key) continue;
      if (!countsByVariant.has(ev.variantKey)) continue;
      const counters = countsByVariant.get(ev.variantKey)!;

      if (ev.eventType === 'impression') {
        counters.impressions += 1;
        exposedByVariant.get(ev.variantKey)!.add(ev.visitorId);
      } else if (ev.eventType === 'calculator_interact') {
        counters.calculatorInteracts += 1;
        interactedByVariant.get(ev.variantKey)!.add(ev.visitorId);
        exposedByVariant.get(ev.variantKey)!.add(ev.visitorId);
      } else if (ev.eventType === 'partner_click') {
        counters.partnerClicks += 1;
        clickedByVariant.get(ev.variantKey)!.add(ev.visitorId);
        exposedByVariant.get(ev.variantKey)!.add(ev.visitorId);
      }
    }

    const observedCounts: Record<string, number> = {};
    let totalUniqueExposed = 0;
    for (const key of variantKeys) {
      const uniqueCount = exposedByVariant.get(key)!.size;
      observedCounts[key] = uniqueCount;
      totalUniqueExposed += uniqueCount;
    }

    const variants: VariantFunnelStats[] = variantKeys.map((key) => {
      const uniqueExposed = exposedByVariant.get(key)!.size;
      const counters = countsByVariant.get(key)!;
      const uniqueInteracted = interactedByVariant.get(key)!.size;
      const uniqueClicked = clickedByVariant.get(key)!.size;

      return {
        variantKey: key,
        expectedTrafficSharePct: expectedMap[key] ?? 0,
        observedTrafficSharePct:
          totalUniqueExposed > 0
            ? Math.round((uniqueExposed / totalUniqueExposed) * 10_000) / 100
            : 0,
        uniqueExposedVisitors: uniqueExposed,
        impressions: counters.impressions,
        calculatorInteracts: counters.calculatorInteracts,
        partnerClicks: counters.partnerClicks,
        calculatorInteractRatePct:
          uniqueExposed > 0
            ? Math.round((uniqueInteracted / uniqueExposed) * 10_000) / 100
            : 0,
        partnerClickCtrPct:
          uniqueExposed > 0
            ? Math.round((uniqueClicked / uniqueExposed) * 10_000) / 100
            : 0,
      };
    });

    const srm = checkSampleRatioMismatch(observedCounts, expectedMap, srmOptions);

    return {
      experimentKey: this.experiment.key,
      totalEvents: this.events.length,
      variants,
      srm,
    };
  }
}
