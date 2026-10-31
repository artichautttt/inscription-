import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    Patch,
    Post,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CanaryRoutingService } from '../canary/canary-routing.service';
import { ProxyService } from './proxy.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/courses')
export class CoursesProxyController {
  private readonly baseUrl = process.env.COURSES_SERVICE_URL ?? 'http://localhost:3002';

  constructor(
    private readonly proxy: ProxyService,
    private readonly canary: CanaryRoutingService,
  ) {}

  /** GET /api/courses -> GET {COURSES}/courses (liste du catalogue) — public. Les ecritures vont toujours vers v1. */
  @Get()
  findAll(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Lecture : seule operation soumise au canary (v1 / v2 selon le flag Unleash).
    return this.canary.get(req, res, '/courses');
  }

  /** GET /api/courses/:id — public */
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.canary.get(req, res, `/courses/${id}`);
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
