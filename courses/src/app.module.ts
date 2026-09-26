import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { CoursesModule } from './courses/courses.module';

@Module({
  controllers: [AppController, HealthController],
  providers: [AppService],
  imports: [CoursesModule],
})
export class AppModule {}
