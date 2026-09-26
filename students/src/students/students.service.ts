import "dotenv/config";
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from "../../generated/prisma/client";

@Injectable()
export class StudentsService {

    private adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    private prisma = new PrismaClient({ adapter: this.adapter });


    async findAll() {
        return await this.prisma.student.findMany();
    }

    async create(createStudentDto: CreateStudentDto) {
        try {return await this.prisma.student.create({data: createStudentDto})}
        catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError ) {
                if (error.code === 'P2002'){
                    throw new ConflictException("Email already exists");
                }
            }
            throw error;
        }
    }

    async findOne(id: string) {
        const resultat= await this.prisma.student.findUnique({where:{id}});
        if (resultat === null) {
             throw new NotFoundException();
        }
        return resultat;
    }

    async update(id: string, updateStudentDto: UpdateStudentDto) {
        return await this.prisma.student.update({where:{id: id},data: updateStudentDto});
    }

    async remove(id: string) {
        return await this.prisma.student.delete({where:{id}});
    }
}
