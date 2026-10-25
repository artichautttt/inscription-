import { Injectable } from '@nestjs/common';

export type BackendVersion = 'v1' | 'v2';

interface Sample {
  at: number;
  ok: boolean;
  ms: number;
}

export interface VersionStats {
  requests: number;
  errors: number;
  errorRate: number;
  avgMs: number;
  p95Ms: number;
}

export interface CanarySnapshot {
  windowMs: number;
  timestamp: string;
  v1: VersionStats;
  v2: VersionStats;
}

/**
 * Metriques en fenetre glissante (en memoire) par version du service courses.
 * Une requete est comptee en erreur si la reponse est >= 500 ou si le service
 * est injoignable / trop lent (502). Les 4xx sont des reponses valides.
 */
@Injectable()
export class CanaryMetricsService {
  private readonly windowMs = Number(process.env.CANARY_WINDOW_MS ?? 30000);
  private readonly samples: Record<BackendVersion, Sample[]> = { v1: [], v2: [] };

  record(version: BackendVersion, ok: boolean, ms: number, now = Date.now()): void {
    this.samples[version].push({ at: now, ok, ms });
    this.prune(version, now);
  }

  snapshot(now = Date.now()): CanarySnapshot {
    this.prune('v1', now);
    this.prune('v2', now);
    return {
      windowMs: this.windowMs,
      timestamp: new Date(now).toISOString(),
      v1: this.stats(this.samples.v1),
      v2: this.stats(this.samples.v2),
    };
  }

  private prune(version: BackendVersion, now: number): void {
    const limit = now - this.windowMs;
    const list = this.samples[version];
    let i = 0;
    while (i < list.length && list[i].at < limit) i++;
    if (i > 0) list.splice(0, i);
  }

  private stats(list: Sample[]): VersionStats {
    const requests = list.length;
    if (requests === 0) return { requests: 0, errors: 0, errorRate: 0, avgMs: 0, p95Ms: 0 };
    const errors = list.filter((s) => !s.ok).length;
    const sorted = list.map((s) => s.ms).sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / requests;
    const p95 = sorted[Math.min(requests - 1, Math.ceil(requests * 0.95) - 1)];
    return {
      requests,
      errors,
      errorRate: errors / requests,
      avgMs: Math.round(avg),
      p95Ms: Math.round(p95),
    };
  }
}
