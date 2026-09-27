import { IsEmail, IsNotEmpty } from 'class-validator';

export class CreateStudentDto {
    @IsNotEmpty()
    nom: string;

    @IsEmail()
    email: string;
}