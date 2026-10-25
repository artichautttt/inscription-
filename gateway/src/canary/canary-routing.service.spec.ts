import { HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CanaryRoutingService } from './canary-routing.service';
import { CanaryMetricsService } from './canary-metrics.service';
import { CanaryService } from './canary.service';
import { ProxyService } from '../proxy/proxy.service';

describe('CanaryRoutingService', () => {
  const jwt = new JwtService({ secret: 'x' });
  let proxy: { forward: jest.Mock };
  let canary: { pick: jest.Mock };
  let metrics: CanaryMetricsService;
  let svc: CanaryRoutingService;
  const res = () => ({ setHeader: jest.fn() }) as any;
  const req = (headers: Record<string, string> = {}) => ({ headers, ip: '1.2.3.4' }) as any;

  beforeEach(() => {
    proxy = { forward: jest.fn() };
    canary = { pick: jest.fn().mockReturnValue('v1') };
    metrics = new CanaryMetricsService();
    svc = new CanaryRoutingService(
      proxy as unknown as ProxyService,
      canary as unknown as CanaryService,
      metrics,
      jwt,
    );
  });

  it('utilise le sub du JWT comme identifiant utilisateur', () => {
    const token = jwt.sign({ sub: 42 });
    expect(svc.userIdOf(req({ authorization: `Bearer ${token}` }))).toBe('42');
  });

  it('retombe sur X-User-Id puis sur l IP', () => {
    expect(svc.userIdOf(req({ 'x-user-id': 'u7' }))).toBe('u7');
    expect(svc.userIdOf(req())).toBe('1.2.3.4');
  });

  it('route vers v1 et pose l en-tete X-Backend-Version', async () => {
    proxy.forward.mockResolvedValue([{ id: 1 }]);
    const r = res();
    const data = await svc.get(req({ 'x-user-id': 'u1' }), r, '/courses');
    expect(data).toEqual([{ id: 1 }]);
    expect(r.setHeader).toHaveBeenCalledWith('X-Backend-Version', 'v1');
    expect(proxy.forward).toHaveBeenCalledWith('http://localhost:3002', '/courses', 'GET');
    expect(metrics.snapshot().v1.requests).toBe(1);
  });

  it('route vers v2 quand le flag est actif', async () => {
    canary.pick.mockReturnValue('v2');
    proxy.forward.mockResolvedValue([]);
    const r = res();
    await svc.get(req({ 'x-user-id': 'u1' }), r, '/courses');
    expect(r.setHeader).toHaveBeenCalledWith('X-Backend-Version', 'v2');
    expect(proxy.forward.mock.calls[0][0]).toBe('http://localhost:3012');
    expect(metrics.snapshot().v2.requests).toBe(1);
  });

  it('compte un 502 de v2 comme erreur, sans repli sur v1', async () => {
    canary.pick.mockReturnValue('v2');
    proxy.forward.mockRejectedValue(new HttpException('down', 502));
    await expect(svc.get(req(), res(), '/courses')).rejects.toThrow(HttpException);
    expect(proxy.forward).toHaveBeenCalledTimes(1);
    expect(metrics.snapshot().v2).toMatchObject({ requests: 1, errors: 1 });
  });

  it('ne compte pas un 404 comme erreur', async () => {
    proxy.forward.mockRejectedValue(new HttpException('nf', 404));
    await expect(svc.get(req(), res(), '/courses/9')).rejects.toThrow(HttpException);
    expect(metrics.snapshot().v1).toMatchObject({ requests: 1, errors: 0 });
  });
});
