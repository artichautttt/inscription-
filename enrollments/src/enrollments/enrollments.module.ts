import { Module } from '@nestjs/common';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { StudentsClient, HttpStudentsClient } from '../clients/students.client';
import { CoursesClient, HttpCoursesClient } from '../clients/courses.client';

@Module({
  controllers: [EnrollmentsController],
  providers: [
    EnrollmentsService,
    // Jalon 2 : utilisation des vrais clients HTTP vers les microservices Étudiants et Cours
    { provide: StudentsClient, useClass: HttpStudentsClient },
    { provide: CoursesClient, useClass: HttpCoursesClient },
  ],
})
export class EnrollmentsModule {}
