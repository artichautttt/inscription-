import {
    Body,
    Controller,
    Delete,
    Get,
    Headers,
    HttpCode,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
} from '@nestjs/common';
import { EnrollmentsService } from './enrollments.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { AccesInterditException } from '../common/errors';

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

  /** Lister les élèves inscrits à un cours (vue admin). */
  @Get('by-course/:coursId')
  findByCourse(@Param('coursId', new ParseUUIDPipe()) coursId: string) {
    return this.enrollments.findByCourse(coursId);
  }

  /**
   * Annuler une inscription.
   * L'identité (X-User-Id, X-User-Role) est posée par la gateway après vérification du JWT.
   * En appel direct sans ces headers, on refuse (le service n'est pas une porte ouverte).
   */
  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('x-user-id') userId: string,
    @Headers('x-user-role') role: string,
  ) {
    if (!userId || !role) {
      throw new AccesInterditException('Identité requise pour cette action.');
    }
    return this.enrollments.remove(id, {
      userId,
      role: role as 'ELEVE' | 'ADMIN',
    });
  }
}
