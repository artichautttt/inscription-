import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { EnrollmentsService } from './enrollments.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';

@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  /** Inscrire un étudiant à un cours. */
  @Post()
  create(@Body() dto: CreateEnrollmentDto) {
    return this.enrollments.create(dto);
  }

  /** Lister les inscriptions d'un étudiant ("Mes inscriptions"). */
  @Get()
  findForStudent(@Query('etudiantId') etudiantId: string) {
    return this.enrollments.findForStudent(etudiantId);
  }
}
