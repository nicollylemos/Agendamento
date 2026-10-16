// Acrescenta a trava da agenda (prisma/sql/trava-agenda.sql) na migration que cria a
// tabela "agendamentos". O Prisma não sabe gerar esse tipo de trava sozinho.
//
// Uso (uma vez, na Fase 5):
//   npx prisma migrate dev --create-only --name agendamentos
//   npm run trava-agenda
//   npx prisma migrate dev
import { readdirSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const pastaMigrations = join(import.meta.dirname, '..', 'prisma', 'migrations');
const sql = readFileSync(join(import.meta.dirname, '..', 'prisma', 'sql', 'trava-agenda.sql'), 'utf8');

const alvo = readdirSync(pastaMigrations, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(pastaMigrations, d.name, 'migration.sql'))
  .find((arq) => existsSync(arq) && readFileSync(arq, 'utf8').includes('CREATE TABLE "agendamentos"'));

if (!alvo) {
  console.error('Nenhuma migration cria a tabela "agendamentos". Rode antes:');
  console.error('  npx prisma migrate dev --create-only --name agendamentos');
  process.exit(1);
}

if (readFileSync(alvo, 'utf8').includes('agendamentos_sem_sobreposicao')) {
  console.log(`A trava já está em ${alvo}`);
} else {
  appendFileSync(alvo, `\n${sql}`);
  console.log(`Trava adicionada em ${alvo}`);
  console.log('Agora rode: npx prisma migrate dev');
}
