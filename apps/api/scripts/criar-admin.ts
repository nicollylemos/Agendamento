// Cria o primeiro administrador. No primeiro login ele vai configurar o 2FA.
// Uso: npm run criar-admin -- --nome "Seu Nome" --email voce@exemplo.com
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { prisma } from '../src/lib/prisma.js';
import { gerarHash, validarNovaSenha } from '../src/lib/password.js';

const { values } = parseArgs({ options: { nome: { type: 'string' }, email: { type: 'string' } } });
const nome = values.nome?.trim();
const email = values.email?.trim().toLowerCase();

if (!nome || !email || !email.includes('@')) {
  console.error('Uso: npm run criar-admin -- --nome "Seu Nome" --email voce@exemplo.com');
  process.exit(1);
}

// Lê a senha sem mostrar o que é digitado
function perguntarSenha(texto: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const rlInterno = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let mostrouPergunta = false;
    rlInterno._writeToOutput = (s: string) => {
      if (!mostrouPergunta) {
        rlInterno.output.write(s);
        mostrouPergunta = true;
      }
    };
    rl.question(texto, (resposta) => {
      rl.close();
      process.stdout.write('\n');
      resolve(resposta);
    });
  });
}

async function main() {
  if (await prisma.usuario.findUnique({ where: { email } })) {
    console.error('Já existe um usuário com esse e-mail.');
    process.exit(1);
  }

  const senha = await perguntarSenha('Senha (mín. 10 caracteres): ');
  const confirmacao = await perguntarSenha('Confirme a senha: ');
  if (senha !== confirmacao) {
    console.error('As senhas não conferem.');
    process.exit(1);
  }
  await validarNovaSenha(senha);

  await prisma.usuario.create({
    data: { nome: nome!, email: email!, perfil: 'ADMIN', senhaHash: await gerarHash(senha) },
  });
  console.log(`Admin ${email} criado. No primeiro login você vai configurar o 2FA.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
