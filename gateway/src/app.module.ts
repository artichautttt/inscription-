import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { HealthController } from './health/health.controller';
import { ProxyService } from './proxy/proxy.service';
import { CoursesProxyController } from './proxy/courses.controller';
import { StudentsProxyController } from './proxy/students.controller';
import { EnrollmentsProxyController } from './proxy/enrollments.controller';
import { AuthProxyController } from './proxy/auth.controller';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HttpModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '12h' },
    }),
  ],
  controllers: [
    HealthController,
    AuthProxyController,
    CoursesProxyController,
    StudentsProxyController,
    EnrollmentsProxyController,
  ],
  providers: [ProxyService, JwtAuthGuard, RolesGuard],
})
export class AppModule {}
