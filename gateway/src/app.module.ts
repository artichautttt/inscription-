import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health/health.controller';
import { ProxyService } from './proxy/proxy.service';
import { CoursesProxyController } from './proxy/courses.controller';
import { StudentsProxyController } from './proxy/students.controller';
import { EnrollmentsProxyController } from './proxy/enrollments.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HttpModule, // fournit HttpService (appels HTTP sortants via axios)
  ],
  controllers: [
    HealthController,
    CoursesProxyController,
    StudentsProxyController,
    EnrollmentsProxyController,
  ],
  providers: [ProxyService],
})
export class AppModule {}
