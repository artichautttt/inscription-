import { Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { CanaryService } from './canary.service';
import { BackendVersion, CanaryMetricsService } from './canary-metrics.service';
import { ProxyService } from '../proxy/proxy.service';

/**
 * Relaie une lecture du catalogue vers courses v1 ou v2 selon le flag,
 * et enregistre succes / echec / latence par version.
 */
@Injectable()
export class CanaryRoutingService {
  private readonly v1Url = process.env.COURSES_SERVICE_URL ?? 'http://localhost:3002';
  private readonly v2Url = process.env.COURSES_V2_SERVICE_URL ?? 'http://localhost:3012';

  constructor(
    private readonly proxy: ProxyService,
    private readonly canary: CanaryService,
    private readonly metrics: CanaryMetricsService,
    private readonly jwt: JwtService,
  ) {}

  /** Identifiant stable de l'utilisateur : sub du JWT, sinon X-User-Id (simulation), sinon IP. */
  userIdOf(req: Request): string {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const payload = this.jwt.decode(auth.slice(7)) as { sub?: string | number } | null;
      if (payload?.sub !== undefined) return String(payload.sub);
    }
    const header = req.headers['x-user-id'];
    if (typeof header === 'string' && header) return header;
    return req.ip ?? 'anonymous';
  }

  async get(req: Request, res: Response, path: string): Promise<unknown> {
    const version = this.canary.pick(this.userIdOf(req));
    // Pose l'en-tete AVANT l'appel : il est donc present aussi sur les reponses d'erreur.
    res.setHeader('X-Backend-Version', version);
    const base = version === 'v2' ? this.v2Url : this.v1Url;
    const started = Date.now();
    try {
      const data = await this.proxy.forward(base, path, 'GET');
      this.metrics.record(version, true, Date.now() - started);
      return data;
    } catch (err) {
      const status = (err as { getStatus?: () => number }).getStatus?.() ?? 502;
      // Un 4xx (ex. 404) est une reponse valide du service ; seuls les 5xx comptent.
      this.metrics.record(version, status < 500, Date.now() - started);
      throw err;
    }
  }
}
