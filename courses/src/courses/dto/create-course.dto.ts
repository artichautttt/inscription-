import {IsNotEmpty, Min} from 'class-validator';

export class CreateCourseDto {
    @IsNotEmpty()
    titre:string;

    @Min(0)
    capacite: number;
}


