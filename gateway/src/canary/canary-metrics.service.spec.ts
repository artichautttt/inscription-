import { CanaryMetricsService } from './canary-metrics.service';

describe('CanaryMetricsService', () => {
  let svc: CanaryMetricsService;
  beforeEach(() => {
    svc = new CanaryMetricsService();
  });

  it('renvoie des statistiques vides sans requete', () => {
    const s = svc.snapshot(1000);
    expect(s.v1).toEqual({ requests: 0, errors: 0, errorRate: 0, avgMs: 0, p95Ms: 0 });
    expect(s.v2.requests).toBe(0);
  });

  it('compte requetes, erreurs et taux par version', () => {
    svc.record('v2', true, 10, 1000);
    svc.record('v2', false, 30, 1100);
    svc.record('v1', true, 5, 1200);
    const s = svc.snapshot(1500);
    expect(s.v2).toMatchObject({ requests: 2, errors: 1, errorRate: 0.5, avgMs: 20 });
    expect(s.v1).toMatchObject({ requests: 1, errors: 0, errorRate: 0 });
  });

  it('calcule le p95', () => {
    for (let i = 1; i <= 100; i++) svc.record('v1', true, i, 1000);
    expect(svc.snapshot(1000).v1.p95Ms).toBe(95);
  });

  it('oublie les echantillons plus vieux que la fenetre (30 s par defaut)', () => {
    svc.record('v2', false, 10, 1000);
    expect(svc.snapshot(1000 + 29000).v2.requests).toBe(1);
    expect(svc.snapshot(1000 + 31000).v2.requests).toBe(0);
  });
});
