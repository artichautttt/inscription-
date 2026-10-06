import "dotenv/config";
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from "../../generated/prisma/client";

@Injectable()
export class StudentsService {

    private adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    private prisma = new PrismaClient({ adapter: this.adapter });


    async findAll() {
        // On expose jamais les hash de mots de passe
        return await this.prisma.student.findMany({
            select: { id: true, email: true, nom: true, prenom: true, telephone: true, role: true },
        });
    }

    async create(createStudentDto: CreateStudentDto) {
        const hashed = await bcrypt.hash(createStudentDto.password, 10);
        try {
            const created = await this.prisma.student.create({
                data: {
                    nom: createStudentDto.nom,
                    prenom: createStudentDto.prenom,
                    email: createStudentDto.email,
                    telephone: createStudentDto.telephone,
                    password: hashed,
                    role: createStudentDto.role ?? 'ELEVE',
                },
            });
            // Jamais renvoyer le hash
            const { password: _pwd, ...safe } = created;
            return safe;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2002') {
                    throw new ConflictException("Email already exists");
                }
            }
            throw error;
        }
    }

    async findOne(id: string) {
        const resultat = await this.prisma.student.findUnique({
            where: { id },
            select: { id: true, email: true, nom: true, prenom: true, telephone: true, role: true },
        });
        if (resultat === null) {
             throw new NotFoundException("Student not found");
        }
        return resultat;
    }

    /** Variante INTERNE : renvoie aussi le hash. Reservee a l'auth. */
    async findByEmailWithPassword(email: string) {
        return this.prisma.student.findUnique({ where: { email } });
    }

    async update(id: string, updateStudentDto: UpdateStudentDto) {
        try {
            const data: Prisma.StudentUpdateInput = { ...updateStudentDto };
            if (updateStudentDto.password) {
                data.password = await bcrypt.hash(updateStudentDto.password, 10);
            }
            const updated = await this.prisma.student.update({ where: { id }, data });
            const { password: _pwd, ...safe } = updated;
            return safe;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2025') {
                    throw new NotFoundException("Student not found");
                }
            }
            throw error;
        }
    }

    async remove(id: string) {
        try {
            await this.prisma.student.delete({ where: { id } });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2025') {
                    throw new NotFoundException("Student not found");
                }
            }
            throw error;
        }
    }
}
