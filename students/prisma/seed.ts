import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { faker } from "@faker-js/faker";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
    for (let i = 0; i < 5; i++) {
        await prisma.student.create({
            data: {
                nom: faker.person.fullName(),
                email: faker.internet.email(),
            },
        });
    }
}

main()
    .then(() => console.log("Seed terminé"))
    .catch((e) => console.error(e))
    .finally(() => prisma.$disconnect());