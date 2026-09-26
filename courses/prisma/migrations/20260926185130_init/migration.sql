-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "capacite" INTEGER NOT NULL,
    "placesRestantes" INTEGER NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);
