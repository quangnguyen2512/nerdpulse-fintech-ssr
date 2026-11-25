import { describe, expect, it } from 'vitest';
import {
  assignExperimentBucket,
  checkSampleRatioMismatch,
  DEFAULT_MARKETPLACE_EXPERIMENT,
  ExperimentConfig,
  ExperimentTracker,
} from '../src/domain/experiments.js';

describe('zero-CLS server-side A/B experimentation engine', () => {
  it('assigns deterministic buckets stably across repeated runs for the same visitor', () => {
    const visitorId = 'visitor-abc-99421';
    const first = assignExperimentBucket(DEFAULT_MARKETPLACE_EXPERIMENT, visitorId);

    for (let i = 0; i < 20; i += 1) {
      const repeat = assignExperimentBucket(DEFAULT_MARKETPLACE_EXPERIMENT, visitorId);
      expect(repeat.variantKey).toBe(first.variantKey);
      expect(repeat.hashBucketPct).toBe(first.hashBucketPct);
      expect(repeat.assignedOnServer).toBe(true);
      expect(repeat.expectedClientClsImpact).toBe(0);
    }
  });

  it('distributes 10,000 visitors uniformly (~50/50) and passes SRM health check', () => {
    const counts: Record<string, number> = {
      hero_calc_above_fold: 0,
      comparison_table_first: 0,
    };

    for (let i = 0; i < 10_000; i += 1) {
      const assignment = assignExperimentBucket(
        DEFAULT_MARKETPLACE_EXPERIMENT,
        `user-sim-${i}`,
      );
      counts[assignment.variantKey] = (counts[assignment.variantKey] ?? 0) + 1;
    }

    const shareA = counts.hero_calc_above_fold! / 10_000;
    const shareB = counts.comparison_table_first! / 10_000;

    expect(shareA).toBeGreaterThan(0.48);
    expect(shareA).toBeLessThan(0.52);
    expect(shareB).toBeGreaterThan(0.48);
    expect(shareB).toBeLessThan(0.52);

    const srm = checkSampleRatioMismatch(counts, {
      hero_calc_above_fold: 50,
      comparison_table_first: 50,
    });
    expect(srm.status).toBe('healthy');
    expect(srm.srmDetected).toBe(false);
    expect(srm.pValue).toBeGreaterThan(0.01);
  });

  it('supports configurable holdout groups with accurate split ratios', () => {
    const holdoutExp: ExperimentConfig = {
      key: 'hysa_holdout_test',
      salt: 'salt-holdout',
      holdoutPct: 10,
      holdoutVariantKey: 'holdout',
      variants: [
        { key: 'control', label: 'Control', weightPct: 50 },
        { key: 'treatment', label: 'Treatment', weightPct: 50 },
      ],
    };

    const counts: Record<string, number> = {
      holdout: 0,
      control: 0,
      treatment: 0,
    };

    for (let i = 0; i < 10_000; i += 1) {
      const bucket = assignExperimentBucket(holdoutExp, `holdout-user-${i}`);
      counts[bucket.variantKey] = (counts[bucket.variantKey] ?? 0) + 1;
    }

    expect(counts.holdout! / 10_000).toBeGreaterThan(0.085);
    expect(counts.holdout! / 10_000).toBeLessThan(0.115);

    const srm = checkSampleRatioMismatch(counts, {
      holdout: 10,
      control: 45,
      treatment: 45,
    });
    expect(srm.degreesOfFreedom).toBe(2);
    expect(srm.status).toBe('healthy');
    expect(srm.srmDetected).toBe(false);
  });

  it('detects Sample Ratio Mismatch (SRM) via Pearson chi-square on skewed traffic', () => {
    // 54/46 skew across 10,000 users on an expected 50/50 split -> chi2 = 64, p << 0.001
    const skewed = checkSampleRatioMismatch(
      { hero_calc_above_fold: 5400, comparison_table_first: 4600 },
      { hero_calc_above_fold: 50, comparison_table_first: 50 },
    );
    expect(skewed.status).toBe('srm_detected');
    expect(skewed.srmDetected).toBe(true);
    expect(skewed.chiSquare).toBeCloseTo(64, 2);
    expect(skewed.pValue).toBeLessThan(0.001);

    // Low sample size does not fire false alerts
    const small = checkSampleRatioMismatch(
      { hero_calc_above_fold: 14, comparison_table_first: 6 },
      { hero_calc_above_fold: 50, comparison_table_first: 50 },
      { minSampleSize: 100 },
    );
    expect(small.status).toBe('insufficient_data');
    expect(small.srmDetected).toBe(false);
  });

  it('tracks deduplicated exposures and conversion attribution per variant', () => {
    const tracker = new ExperimentTracker(DEFAULT_MARKETPLACE_EXPERIMENT);

    for (let i = 0; i < 60; i += 1) {
      const vid = `vA-${i}`;
      tracker.record({
        experimentKey: DEFAULT_MARKETPLACE_EXPERIMENT.key,
        variantKey: 'hero_calc_above_fold',
        visitorId: vid,
        eventType: 'impression',
      });
      // Duplicate reload impression by same visitor should not inflate unique exposure count
      tracker.record({
        experimentKey: DEFAULT_MARKETPLACE_EXPERIMENT.key,
        variantKey: 'hero_calc_above_fold',
        visitorId: vid,
        eventType: 'impression',
      });
      if (i < 24) {
        tracker.record({
          experimentKey: DEFAULT_MARKETPLACE_EXPERIMENT.key,
          variantKey: 'hero_calc_above_fold',
          visitorId: vid,
          eventType: 'calculator_interact',
        });
      }
      if (i < 6) {
        tracker.record({
          experimentKey: DEFAULT_MARKETPLACE_EXPERIMENT.key,
          variantKey: 'hero_calc_above_fold',
          visitorId: vid,
          eventType: 'partner_click',
          productId: 'hysa-apex-boost',
        });
      }
    }

    for (let i = 0; i < 60; i += 1) {
      const vid = `vB-${i}`;
      tracker.record({
        experimentKey: DEFAULT_MARKETPLACE_EXPERIMENT.key,
        variantKey: 'comparison_table_first',
        visitorId: vid,
        eventType: 'impression',
      });
      if (i < 12) {
        tracker.record({
          experimentKey: DEFAULT_MARKETPLACE_EXPERIMENT.key,
          variantKey: 'comparison_table_first',
          visitorId: vid,
          eventType: 'partner_click',
          productId: 'cd-beacon-12m',
        });
      }
    }

    const summary = tracker.summarize({ minSampleSize: 100 });
    expect(summary.srm.status).toBe('healthy');
    const vA = summary.variants.find((v) => v.variantKey === 'hero_calc_above_fold')!;
    const vB = summary.variants.find((v) => v.variantKey === 'comparison_table_first')!;
    expect(vA.uniqueExposedVisitors).toBe(60);
    expect(vA.impressions).toBe(120);
    expect(vA.calculatorInteractRatePct).toBe(40);
    expect(vA.partnerClickCtrPct).toBe(10);
    expect(vB.uniqueExposedVisitors).toBe(60);
    expect(vB.partnerClickCtrPct).toBe(20);
  });
});
