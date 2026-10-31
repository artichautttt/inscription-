import { Controller, Get } from '@nestjs/common';
import { CanaryMetricsService } from './canary-metrics.service';

/**
 * Route INTERNE (hors /api) : n'est pas relayee par nginx, donc injoignable
 * depuis l'exterieur. Lue par le rollback-watcher en local.
 */
@Controller('internal')
export class CanaryController {
  constructor(private readonly metrics: CanaryMetricsService) {}

  @Get('canary-metrics')
  snapshot() {
    return this.metrics.snapshot();
  }
}
