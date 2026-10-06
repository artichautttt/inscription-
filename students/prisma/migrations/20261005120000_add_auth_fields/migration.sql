-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ELEVE', 'ADMIN');

-- AlterTable
ALTER TABLE "Student" ADD COLUMN "password" TEXT NOT NULL,
ADD COLUMN "role" "Role" NOT NULL DEFAULT 'ELEVE';
