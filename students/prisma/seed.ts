import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { faker } from "@faker-js/faker";
import * as bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
    const adminHash = await bcrypt.hash("admin123", 10);
    const eleveHash = await bcrypt.hash("eleve123", 10);

    await prisma.student.upsert({
        where: { email: "admin@test.com" },
        update: { password: adminHash, role: "ADMIN", prenom: "Super", telephone: "+33 1 00 00 00 00" },
        create: {
            nom: "Admin",
            prenom: "Super",
            email: "admin@test.com",
            telephone: "+33 1 00 00 00 00",
            password: adminHash,
            role: "ADMIN",
        },
    });

    await prisma.student.upsert({
        where: { email: "eleve@test.com" },
        update: { password: eleveHash, role: "ELEVE", prenom: "Elena", telephone: "+33 6 12 34 56 78" },
        create: {
            nom: "Test",
            prenom: "Elena",
            email: "eleve@test.com",
            telephone: "+33 6 12 34 56 78",
            password: eleveHash,
            role: "ELEVE",
        },
    });

    await prisma.student.upsert({
        where: { email: "jean.dupont@example.com" },
        update: { password: eleveHash, role: "ELEVE", prenom: "Jean", telephone: "+33 6 11 22 33 44" },
        create: {
            id: "11111111-1111-4111-8111-111111111111",
            nom: "Dupont",
            prenom: "Jean",
            email: "jean.dupont@example.com",
            telephone: "+33 6 11 22 33 44",
            password: eleveHash,
            role: "ELEVE",
        },
    });

    // Donnees de remplissage
    for (let i = 0; i < 5; i++) {
        const email = faker.internet.email();
        await prisma.student.upsert({
            where: { email },
            update: {},
            create: {
                nom: faker.person.lastName(),
                prenom: faker.person.firstName(),
                email,
                telephone: faker.phone.number(),
                password: eleveHash,
                role: "ELEVE",
            },
        });
    }
}

main()
    .then(() => console.log("Seed termine"))
    .catch((e) => console.error(e))
    .finally(() => prisma.$disconnect());
