import { randomUUID } from 'node:crypto';
import http, { IncomingMessage, ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import {
  BankingProduct,
  ComparisonQuerySchema,
  getDefaultBankingCatalog,
  rankBankingProducts,
} from '../domain/banking.js';
import {
  assignExperimentBucket,
  DEFAULT_MARKETPLACE_EXPERIMENT,
  ExperimentConfig,
} from '../domain/experiments.js';
import {
  buildRobotsTxt,
  buildSitemapXml,
  buildSsrCacheHeaders,
} from '../domain/seo.js';
import { auditMarketplaceResponse, formatAuditMarkdown } from '../audit/harness.js';
import { renderMarketplaceHtml } from './render.js';
import { TelemetryIngestSchema, TelemetryStore } from './telemetry.js';

export interface MarketplaceAppOptions {
  baseUrl?: string;
  catalogProvider?: () => BankingProduct[];
  experiment?: ExperimentConfig;
  telemetry?: TelemetryStore;
}

export interface MarketplaceAppInstance {
  server: http.Server;
  telemetry: TelemetryStore;
  experiment: ExperimentConfig;
}

const MAX_POST_BODY_BYTES = 64 * 1024;

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_POST_BODY_BYTES) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(payload, 'utf8')),
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(payload);
}

function resolveRequestBaseUrl(req: IncomingMessage, fallbackBaseUrl?: string): string {
  if (fallbackBaseUrl) return fallbackBaseUrl;
  const host = req.headers.host ?? 'localhost:3000';
  return `http://${host}`;
}

export function createMarketplaceApp(
  options: MarketplaceAppOptions = {},
): MarketplaceAppInstance {
  const experiment = options.experiment ?? DEFAULT_MARKETPLACE_EXPERIMENT;
  const telemetry = options.telemetry ?? new TelemetryStore(experiment);
  const catalogProvider = options.catalogProvider ?? (() => getDefaultBankingCatalog());

  const server = http.createServer(async (req, res) => {
    const started = performance.now();
    const method = req.method ?? 'GET';
    const baseUrl = resolveRequestBaseUrl(req, options.baseUrl);
    const url = new URL(req.url ?? '/', baseUrl);
    const pathname = url.pathname;

    try {
      if (method === 'GET' && pathname === '/healthz') {
        sendJson(res, 200, { status: 'ok', service: 'nerdpulse-banking-marketplace' });
        return;
      }

      if (method === 'GET' && pathname === '/robots.txt') {
        const txt = buildRobotsTxt(baseUrl);
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
          'Content-Length': String(Buffer.byteLength(txt, 'utf8')),
        });
        res.end(txt);
        return;
      }

      if (method === 'GET' && pathname === '/sitemap.xml') {
        const xml = buildSitemapXml(baseUrl, catalogProvider());
        res.writeHead(200, {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
          'Content-Length': String(Buffer.byteLength(xml, 'utf8')),
        });
        res.end(xml);
        return;
      }

      if (method === 'GET' && pathname === '/api/products') {
        const rawQuery = Object.fromEntries(url.searchParams.entries());
        const parsed = ComparisonQuerySchema.safeParse(rawQuery);
        if (!parsed.success) {
          sendJson(res, 400, {
            error: 'INVALID_QUERY_PARAMETERS',
            details: parsed.error.flatten(),
          });
          return;
        }

        const q = parsed.data;
        const comparison = rankBankingProducts(catalogProvider(), {
          depositUsd: q.deposit,
          months: q.months,
          sort: q.sort,
          accountType: q.accountType,
          noFeeOnly: q.noFeeOnly,
          stalePolicy: q.includeStale ? 'demote' : 'exclude',
        });

        sendJson(res, 200, comparison, {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
          Vary: 'Accept-Encoding',
        });
        return;
      }

      if (method === 'POST' && pathname === '/api/telemetry/vitals') {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          const code = err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
          sendJson(res, code, {
            error: code === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
          });
          return;
        }

        const parsed = TelemetryIngestSchema.safeParse(body);
        if (!parsed.success) {
          sendJson(res, 400, {
            error: 'INVALID_TELEMETRY_PAYLOAD',
            details: parsed.error.flatten(),
          });
          return;
        }

        const result = telemetry.ingest(parsed.data);
        sendJson(res, 202, {
          status: 'accepted',
          ...result,
        });
        return;
      }

      if (method === 'GET' && pathname === '/api/telemetry/summary') {
        const minSampleParam = url.searchParams.get('minSampleSize');
        const minSampleSize = minSampleParam ? Number(minSampleParam) : undefined;
        const summary = telemetry.getSummary(
          minSampleSize && Number.isFinite(minSampleSize)
            ? { minSampleSize }
            : undefined,
        );
        sendJson(res, 200, summary, {
          'Cache-Control': 'no-store',
        });
        return;
      }

      if (method === 'GET' && pathname === '/api/audit') {
        const forceVariant = url.searchParams.get('variant') ?? undefined;
        const visitorId = url.searchParams.get('visitorId') ?? 'audit-probe-visitor';
        const comparison = rankBankingProducts(catalogProvider(), {
          depositUsd: 25_000,
          months: 12,
          sort: 'best_net_yield',
          accountType: 'ALL',
          noFeeOnly: false,
          stalePolicy: 'exclude',
        });
        const bucket = assignExperimentBucket(experiment, visitorId, forceVariant);
        const html = renderMarketplaceHtml({ baseUrl, comparison, bucket });
        const headers = buildSsrCacheHeaders({
          experimentHeaderValue: `${bucket.experimentKey}:${bucket.variantKey}`,
          serverTimingMs: performance.now() - started,
        });
        const report = auditMarketplaceResponse({
          html,
          headers,
          apiComparison: comparison,
        });

        if (url.searchParams.get('format') === 'markdown') {
          const md = formatAuditMarkdown(report);
          res.writeHead(200, {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Length': String(Buffer.byteLength(md, 'utf8')),
          });
          res.end(md);
          return;
        }

        sendJson(res, 200, report, { 'Cache-Control': 'no-store' });
        return;
      }

      if (method === 'GET' && pathname === '/') {
        const rawQuery = Object.fromEntries(url.searchParams.entries());
        const parsed = ComparisonQuerySchema.safeParse(rawQuery);
        const q = parsed.success
          ? parsed.data
          : ComparisonQuerySchema.parse({});

        const cookies = parseCookies(req.headers.cookie);
        const queryVisitorId = url.searchParams.get('visitorId');
        const existingVisitorId = queryVisitorId || cookies.np_vid;
        const visitorId = existingVisitorId || randomUUID();
        const shouldSetCookie = !existingVisitorId;

        const forceVariant =
          url.searchParams.get('forceVariant') ||
          (typeof req.headers['x-experiment-variant'] === 'string'
            ? req.headers['x-experiment-variant']
            : undefined);

        const bucket = assignExperimentBucket(experiment, visitorId, forceVariant);
        if (!forceVariant) {
          telemetry.recordServerImpression(
            bucket.experimentKey,
            bucket.variantKey,
            visitorId,
          );
        }

        const comparison = rankBankingProducts(catalogProvider(), {
          depositUsd: q.deposit,
          months: q.months,
          sort: q.sort,
          accountType: q.accountType,
          noFeeOnly: q.noFeeOnly,
          stalePolicy: q.includeStale ? 'demote' : 'exclude',
        });

        const html = renderMarketplaceHtml({ baseUrl, comparison, bucket });
        const durationMs = performance.now() - started;
        const headers: Record<string, string | string[]> = {
          ...buildSsrCacheHeaders({
            experimentHeaderValue: `${bucket.experimentKey}:${bucket.variantKey}`,
            serverTimingMs: durationMs,
          }),
          'Content-Length': String(Buffer.byteLength(html, 'utf8')),
        };
        if (shouldSetCookie) {
          headers['Set-Cookie'] =
            `np_vid=${encodeURIComponent(visitorId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
        }

        res.writeHead(200, headers);
        res.end(html);
        return;
      }

      sendJson(res, 404, { error: 'NOT_FOUND', path: pathname });
    } catch (error) {
      sendJson(res, 500, {
        error: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Unexpected server error',
      });
    }
  });

  return { server, telemetry, experiment };
}
