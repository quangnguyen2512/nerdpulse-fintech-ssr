import { z } from 'zod';
import {
  DEFAULT_MARKETPLACE_EXPERIMENT,
  ExperimentConfig,
  ExperimentEventTypeSchema,
  ExperimentTracker,
} from '../domain/experiments.js';

export const VitalMetricNameSchema = z.enum(['LCP', 'INP', 'CLS', 'TTFB']);
export type VitalMetricName = z.infer<typeof VitalMetricNameSchema>;

export const VitalSampleSchema = z.object({
  name: VitalMetricNameSchema,
  value: z.number().min(0).max(600_000),
});

export const TelemetryIngestSchema = z
  .object({
    visitorId: z.string().min(1).max(128).default('anonymous'),
    experimentKey: z.string().min(1).max(128).default(DEFAULT_MARKETPLACE_EXPERIMENT.key),
    variantKey: z.string().min(1).max(128).optional(),
    path: z.string().max(256).default('/'),
    vitals: z.array(VitalSampleSchema).max(10).optional(),
    event: z
      .object({
        eventType: ExperimentEventTypeSchema,
        productId: z.string().max(128).optional(),
      })
      .optional(),
  })
  .refine(
    (payload) =>
      (payload.vitals && payload.vitals.length > 0) || payload.event !== undefined,
    { message: 'Payload must include at least one vital metric or experiment event' },
  );

export type TelemetryIngestPayload = z.infer<typeof TelemetryIngestSchema>;

export type VitalRating = 'good' | 'needs-improvement' | 'poor' | 'no_data';

export interface VitalAggregate {
  metric: VitalMetricName;
  unit: 'ms' | 'score';
  samples: number;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  goodThreshold: number;
  poorThreshold: number;
  rating: VitalRating;
}

const VITAL_THRESHOLDS: Record<
  VitalMetricName,
  { unit: 'ms' | 'score'; good: number; poor: number }
> = {
  LCP: { unit: 'ms', good: 2500, poor: 4000 },
  INP: { unit: 'ms', good: 200, poor: 500 },
  CLS: { unit: 'score', good: 0.1, poor: 0.25 },
  TTFB: { unit: 'ms', good: 800, poor: 1800 },
};

function computePercentile(sortedValues: number[], percentile: number): number | null {
  if (sortedValues.length === 0) return null;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedValues.length) - 1),
  );
  const val = sortedValues[idx]!;
  return Math.round(val * 1000) / 1000;
}

export function rateVitalP75(
  metric: VitalMetricName,
  p75: number | null,
): VitalRating {
  if (p75 === null) return 'no_data';
  const t = VITAL_THRESHOLDS[metric];
  if (p75 <= t.good) return 'good';
  if (p75 <= t.poor) return 'needs-improvement';
  return 'poor';
}

export class TelemetryStore {
  private readonly vitals: Record<VitalMetricName, number[]> = {
    LCP: [],
    INP: [],
    CLS: [],
    TTFB: [],
  };
  private readonly maxSamplesPerMetric: number;
  public readonly experiments: ExperimentTracker;

  constructor(
    experiment: ExperimentConfig = DEFAULT_MARKETPLACE_EXPERIMENT,
    maxSamplesPerMetric = 10_000,
  ) {
    this.maxSamplesPerMetric = maxSamplesPerMetric;
    this.experiments = new ExperimentTracker(experiment);
  }

  public ingest(payload: TelemetryIngestPayload): {
    vitalsRecorded: number;
    eventRecorded: boolean;
  } {
    let vitalsRecorded = 0;
    if (payload.vitals) {
      for (const sample of payload.vitals) {
        const bucket = this.vitals[sample.name];
        bucket.push(sample.value);
        if (bucket.length > this.maxSamplesPerMetric) {
          bucket.shift();
        }
        vitalsRecorded += 1;
      }
    }

    let eventRecorded = false;
    if (payload.event && payload.variantKey) {
      this.experiments.record({
        experimentKey: payload.experimentKey,
        variantKey: payload.variantKey,
        visitorId: payload.visitorId,
        eventType: payload.event.eventType,
        productId: payload.event.productId,
      });
      eventRecorded = true;
    }

    return { vitalsRecorded, eventRecorded };
  }

  public recordServerImpression(
    experimentKey: string,
    variantKey: string,
    visitorId: string,
  ): void {
    this.experiments.record({
      experimentKey,
      variantKey,
      visitorId,
      eventType: 'impression',
    });
  }

  public getSummary(srmOptions?: { alpha?: number; minSampleSize?: number }) {
    const metrics: VitalMetricName[] = ['LCP', 'INP', 'CLS', 'TTFB'];
    const webVitals = {} as Record<VitalMetricName, VitalAggregate>;

    for (const metric of metrics) {
      const sorted = [...this.vitals[metric]].sort((a, b) => a - b);
      const p50 = computePercentile(sorted, 50);
      const p75 = computePercentile(sorted, 75);
      const p95 = computePercentile(sorted, 95);
      const threshold = VITAL_THRESHOLDS[metric];
      webVitals[metric] = {
        metric,
        unit: threshold.unit,
        samples: sorted.length,
        p50,
        p75,
        p95,
        goodThreshold: threshold.good,
        poorThreshold: threshold.poor,
        rating: rateVitalP75(metric, p75),
      };
    }

    const experimentSummary = this.experiments.summarize(srmOptions);

    return {
      generatedAt: new Date().toISOString(),
      webVitals,
      experiment: experimentSummary,
    };
  }
}
