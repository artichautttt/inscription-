import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ProxyService } from './proxy.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/courses')
export class CoursesProxyController {
  private readonly baseUrl = process.env.COURSES_SERVICE_URL ?? 'http://localhost:3002';

  constructor(private readonly proxy: ProxyService) {}

  /** GET /api/courses -> GET {COURSES}/courses (liste du catalogue) — public */
  @Get()
  findAll() {
    return this.proxy.forward(this.baseUrl, '/courses', 'GET');
  }

  /** GET /api/courses/:id — public */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.proxy.forward(this.baseUrl, `/courses/${id}`, 'GET');
  }

  /** POST /api/courses — ADMIN uniquement */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  create(@Body() body: unknown) {
    return this.proxy.forward(this.baseUrl, '/courses', 'POST', body);
  }

  /** PATCH /api/courses/:id — ADMIN uniquement */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.proxy.forward(this.baseUrl, `/courses/${id}`, 'PATCH', body);
  }

  /** DELETE /api/courses/:id — ADMIN uniquement */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.proxy.forward(this.baseUrl, `/courses/${id}`, 'DELETE');
  }
}
