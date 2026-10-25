import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Unleash } from 'unleash-client';
import { BackendVersion } from './canary-metrics.service';

export const CANARY_FLAG = process.env.CANARY_FLAG ?? 'courses-v2-canary';

/**
 * Decide, par utilisateur, si la requete va vers courses v1 (stable) ou v2 (canary),
 * a partir du feature flag Unleash. Evaluation LOCALE (le SDK telecharge la config
 * puis evalue en memoire) : pas d'appel reseau a Unleash par requete.
 *
 * Regle de securite : tant que le SDK n'est pas pret, ou si Unleash n'est pas
 * configure / injoignable au demarrage, on sert v1. Il n'y a volontairement
 * AUCUN repli par requete de v2 vers v1 : un echec de v2 doit rester visible
 * pour que le rollback automatique puisse le detecter.
 */
@Injectable()
export class CanaryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CanaryService.name);
  private unleash?: Unleash;
  private ready = false;

  onModuleInit(): void {
    const url = process.env.UNLEASH_URL;
    const token = process.env.UNLEASH_CLIENT_TOKEN;
    if (!url || !token) {
      this.logger.warn('Unleash non configure (UNLEASH_URL / UNLEASH_CLIENT_TOKEN) : tout le trafic va vers v1');
      return;
    }
    this.unleash = new Unleash({
      url,
      appName: 'api-gateway',
      instanceId: 'gateway-1',
      customHeaders: { Authorization: token },
      refreshInterval: Number(process.env.UNLEASH_REFRESH_MS ?? 2000),
      metricsInterval: 0,
    });
    this.unleash.on('ready', () => {
      this.ready = true;
      this.logger.log('SDK Unleash pret');
    });
    this.unleash.on('error', (err: unknown) => {
      this.logger.warn(`Unleash : ${(err as Error)?.message ?? err}`);
    });
  }

  onModuleDestroy(): void {
    this.unleash?.destroy();
  }

  /** Version choisie pour cet utilisateur. */
  pick(userId: string): BackendVersion {
    if (!this.unleash || !this.ready) return 'v1';
    try {
      return this.unleash.isEnabled(CANARY_FLAG, { userId }) ? 'v2' : 'v1';
    } catch {
      return 'v1';
    }
  }
}
