import { Controller, Get, Param } from '@nestjs/common';
import { ProxyService } from './proxy.service';

@Controller('api/courses')
export class CoursesProxyController {
  private readonly baseUrl = process.env.COURSES_SERVICE_URL ?? 'http://localhost:3002';

  constructor(private readonly proxy: ProxyService) {}

  /** GET /api/courses -> GET {COURSES}/courses (liste du catalogue) */
  @Get()
  findAll() {
    return this.proxy.forward(this.baseUrl, '/courses', 'GET');
  }

  /** GET /api/courses/:id -> GET {COURSES}/courses/:id (un cours) */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.proxy.forward(this.baseUrl, `/courses/${id}`, 'GET');
  }
}
