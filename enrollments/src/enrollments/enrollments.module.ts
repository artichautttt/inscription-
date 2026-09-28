import { Module } from '@nestjs/common';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { StudentsClient, MockStudentsClient } from '../clients/students.client';
import { CoursesClient, MockCoursesClient } from '../clients/courses.client';

@Module({
  controllers: [EnrollmentsController],
  providers: [
    EnrollmentsService,
    // Jalon 1 : clients MOCKÉS.
    // Jalon 2 : remplacer par les vrais clients HTTP (ex. HttpStudentsClient / HttpCoursesClient).
    { provide: StudentsClient, useClass: MockStudentsClient },
    { provide: CoursesClient, useClass: MockCoursesClient },
  ],
})
export class EnrollmentsModule {}
