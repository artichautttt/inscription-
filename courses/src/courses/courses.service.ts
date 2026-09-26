import "dotenv/config";
import {ConflictException, Injectable, NotFoundException} from '@nestjs/common';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from "../../generated/prisma/client";

@Injectable()
export class CoursesService {
    private adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    private prisma = new PrismaClient({ adapter: this.adapter });


    async findAll() {
        return await this.prisma.course.findMany();
      }

    async create(createCourseDto: CreateCourseDto) {
        return await this.prisma.course.create({
            data: {
                titre: createCourseDto.titre,
                capacite: createCourseDto.capacite,
                placesRestantes: createCourseDto.capacite
            }
        });
    }

    async findOne(id: string) {
        const resultat= await this.prisma.course.findUnique({where:{id}});
        if (resultat === null) {
            throw new NotFoundException("Course not found");
        }
        return resultat;
    }

    async update(id: string, updateCourseDto: UpdateCourseDto) {
        return await this.prisma.course.update({where:{id: id},data: updateCourseDto});
    }

    async updateSeats(id: string, delta: number){
        const resultat= await this.prisma.course.findUnique({where:{id}});
        if (resultat === null) {
            throw new NotFoundException();
        }

        const nouvelle_valeur =resultat.placesRestantes + delta ;
        if (nouvelle_valeur <0) {
            throw new ConflictException("cours complet");
        }

         return await this.prisma.course.update({where:{id: id},data: {
            placesRestantes: nouvelle_valeur
            }})

    }

    async remove(id: string) {
        return await this.prisma.course.delete({where:{id}});
    }
}
