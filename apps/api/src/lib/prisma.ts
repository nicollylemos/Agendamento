import { PrismaClient } from '@prisma/client';

// Uma instância só para a aplicação inteira.
export const prisma = new PrismaClient();
