import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { StudentsModule } from './students/students.module';
import { AuthModule } from './auth/auth.module';

@Module({
  controllers: [AppController, HealthController],
  providers: [AppService],
  imports: [StudentsModule, AuthModule],
})
export class AppModule {}
