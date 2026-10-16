import request from 'supertest';
import { generate, generateSecret } from 'otplib';
import type { Express } from 'express';
import { prisma } from '../src/lib/prisma.js';
import { gerarHash } from '../src/lib/password.js';
import { cifrar } from '../src/lib/crypto.js';
import { assinar } from '../src/lib/jwt.js';

// Token de reautenticação direto (o código TOTP não pode ser reusado no mesmo intervalo de 30 s,
// então os testes não conseguem reautenticar várias vezes seguidas pelo fluxo normal)
export async function reauthDe(email = 'admin@teste.com') {
  const u = await prisma.usuario.findUniqueOrThrow({ where: { email } });
  return assinar('reauth', u.id);
}

export const comBanco = Boolean(process.env.TEST_DATABASE_URL);

// Apaga tudo, na ordem certa por causa das chaves estrangeiras
export async function limparBanco() {
  await prisma.postInstagram.deleteMany();
  await prisma.logAuditoria.deleteMany();
  // Histórico de estoque é só de inserção (trigger bloqueia DELETE); TRUNCATE não passa pelo trigger de linha
  await prisma.$executeRawUnsafe('TRUNCATE movimentacoes_estoque');
  // Extrato de pontos também é protegido por trigger
  await prisma.$executeRawUnsafe('TRUNCATE transacoes_fidelidade');
  await prisma.resgateFidelidade.deleteMany();
  await prisma.recompensa.deleteMany();
  await prisma.programaFidelidade.deleteMany();
  await prisma.arquivo.deleteMany();
  await prisma.personalizacao.deleteMany();
  await prisma.fichaTecnicaItem.deleteMany();
  await prisma.custoExtraServico.deleteMany();
  await prisma.produto.deleteMany();
  await prisma.webhookEvento.deleteMany();
  await prisma.pagamento.deleteMany();
  await prisma.recebedor.deleteMany();
  await prisma.codigoCliente.deleteMany();
  await prisma.agendamento.deleteMany();
  await prisma.cliente.deleteMany();
  await prisma.configAgenda.deleteMany();
  await prisma.bloqueio.deleteMany();
  await prisma.excecaoHorario.deleteMany();
  await prisma.jornadaFaixa.deleteMany();
  await prisma.modeloJornada.deleteMany();
  await prisma.servicoFuncionario.deleteMany();
  await prisma.servico.deleteMany();
  await prisma.categoriaServico.deleteMany();
  await prisma.funcionario.deleteMany();
  await prisma.sessao.deleteMany();
  await prisma.tokenUso.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.empresa.deleteMany();
}

// Admin com 2FA já configurado, logado. Devolve o access token.
export async function loginAdmin(app: Express, email = 'admin@teste.com') {
  const segredo = generateSecret();
  await prisma.usuario.create({
    data: {
      nome: 'Admin',
      email,
      perfil: 'ADMIN',
      senhaHash: await gerarHash('senha-do-admin-123'),
      totpAtivo: true,
      totpSecret: cifrar(segredo),
    },
  });
  const login = await request(app).post('/api/v1/auth/login').send({ email, senha: 'senha-do-admin-123' });
  const ok = await request(app)
    .post('/api/v1/auth/2fa/verificar')
    .send({ mfaToken: login.body.mfaToken, codigo: await generate({ secret: segredo }) });
  return ok.body.accessToken as string;
}

// Funcionário (sem 2FA) com perfil de atendimento, logado.
export async function loginFuncionario(app: Express, nome: string, email: string) {
  const usuario = await prisma.usuario.create({
    data: {
      nome,
      email,
      perfil: 'FUNCIONARIO',
      senhaHash: await gerarHash('senha-do-funcionario'),
      funcionario: { create: { nome } },
    },
    include: { funcionario: true },
  });
  const login = await request(app).post('/api/v1/auth/login').send({ email, senha: 'senha-do-funcionario' });
  return { token: login.body.accessToken as string, usuarioId: usuario.id, funcionarioId: usuario.funcionario!.id };
}
