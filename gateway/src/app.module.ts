import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { HealthController } from './health/health.controller';
import { ProxyService } from './proxy/proxy.service';
import { CoursesProxyController } from './proxy/courses.controller';
import { StudentsProxyController } from './proxy/students.controller';
import { EnrollmentsProxyController } from './proxy/enrollments.controller';
import { WaitlistProxyController } from './proxy/waitlist.controller';
import { AuthProxyController } from './proxy/auth.controller';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { CanaryService } from './canary/canary.service';
import { CanaryMetricsService } from './canary/canary-metrics.service';
import { CanaryRoutingService } from './canary/canary-routing.service';
import { CanaryController } from './canary/canary.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Delai max vers un service en aval (0 = aucun, comportement historique). Utile pour detecter un v2 fige.
    HttpModule.register({ timeout: Number(process.env.UPSTREAM_TIMEOUT_MS ?? 0) }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '12h' },
    }),
  ],
  controllers: [
    HealthController,
    CanaryController,
    AuthProxyController,
    CoursesProxyController,
    StudentsProxyController,
    EnrollmentsProxyController,
    WaitlistProxyController,
  ],
  providers: [
    ProxyService,
    JwtAuthGuard,
    RolesGuard,
    CanaryService,
    CanaryMetricsService,
    CanaryRoutingService,
  ],
})
export class AppModule {}
