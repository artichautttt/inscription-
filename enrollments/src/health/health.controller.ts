import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      service: 'enrollments',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
