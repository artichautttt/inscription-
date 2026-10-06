import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export enum Role {
  ELEVE = 'ELEVE',
  ADMIN = 'ADMIN',
}

export class CreateStudentDto {
    @IsNotEmpty()
    nom: string;

    @IsOptional()
    @IsString()
    prenom?: string;

    @IsEmail()
    email: string;

    @IsOptional()
    @IsString()
    telephone?: string;

    @IsNotEmpty()
    @MinLength(6)
    password: string;

    @IsOptional()
    @IsEnum(Role)
    role?: Role;
}
