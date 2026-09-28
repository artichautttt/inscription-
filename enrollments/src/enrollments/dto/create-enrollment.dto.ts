import { IsUUID } from 'class-validator';

export class CreateEnrollmentDto {
  @IsUUID()
  etudiantId!: string;

  @IsUUID()
  coursId!: string;
}
