-- CreateEnum
CREATE TYPE "StatutInscription" AS ENUM ('CONFIRMEE', 'ANNULEE');

-- CreateTable
CREATE TABLE "inscriptions" (
    "id" UUID NOT NULL,
    "etudiantId" UUID NOT NULL,
    "coursId" UUID NOT NULL,
    "statut" "StatutInscription" NOT NULL DEFAULT 'CONFIRMEE',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inscriptions_etudiantId_coursId_key" ON "inscriptions"("etudiantId", "coursId");
