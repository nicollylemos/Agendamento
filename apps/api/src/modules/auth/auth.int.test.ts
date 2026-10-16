import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { generate } from 'otplib';

// Captura os e-mails em vez de enviar
const emails: { para: string; texto: string }[] = [];
vi.mock('../../lib/mailer.js', () => ({
  enviarEmail: async (para: string, _assunto: string, texto: string) => {
    emails.push({ para, texto });
  },
}));

const { app } = await import('../../app.js');
const { prisma } = await import('../../lib/prisma.js');
const { gerarHash } = await import('../../lib/password.js');
const { limparBanco } = await import('../../../tests/helpers.js');

// Precisa de um banco de teste com as migrations aplicadas:
//   TEST_DATABASE_URL=postgresql://... npm run test:db
const comBanco = Boolean(process.env.TEST_DATABASE_URL);

const SENHA_ADMIN = 'senha-do-admin-123';
const csrf = { 'X-Requested-With': 'agendamento' };

function tokenDoUltimoEmail(para: string) {
  const email = [...emails].reverse().find((e) => e.para === para);
  return email?.texto.match(/token=([\w-]+)/)?.[1];
}


// O mesmo código TOTP não pode ser usado duas vezes. Nos testes,
// "esquecemos" o último código para poder gerar outro na mesma janela.
async function codigoTotp(email: string, segredo: string) {
  await prisma.usuario.update({ where: { email }, data: { totpUltimoPasso: null } });
  return generate({ secret: segredo });
}

describe.skipIf(!comBanco)('fluxo completo de autenticação (RF01–RF05)', () => {
  const admin = request.agent(app);
  let segredoAdmin = '';
  let tokenAdmin = '';

  beforeAll(async () => {
    await limparBanco();
    await prisma.usuario.create({
      data: { nome: 'Admin', email: 'admin@teste.com', perfil: 'ADMIN', senhaHash: await gerarHash(SENHA_ADMIN) },
    });
  });
  afterAll(async () => {
    await limparBanco();
    await prisma.$disconnect();
  });

  it('RF01: 2FA é opcional, admin sem 2FA entra só com a senha', async () => {
    const login = await admin.post('/api/v1/auth/login').send({ email: 'admin@teste.com', senha: SENHA_ADMIN });
    expect(login.status).toBe(200);
    expect(login.body.etapa).toBe('OK');
    tokenAdmin = login.body.accessToken;
  });

  it('RF01: ativa o 2FA pela própria conta', async () => {
    const auth = { Authorization: `Bearer ${tokenAdmin}` };
    // Sem login não dá para configurar
    expect((await request(app).post('/api/v1/auth/2fa/configurar')).status).toBe(401);

    const config = await request(app).post('/api/v1/auth/2fa/configurar').set(auth);
    expect(config.status).toBe(200);
    expect(config.body.qrCode).toMatch(/^data:image\/png;base64,/);
    segredoAdmin = config.body.segredo;

    const salvo = await prisma.usuario.findUniqueOrThrow({ where: { email: 'admin@teste.com' } });
    expect(salvo.totpSecretPendente).not.toContain(segredoAdmin); // cifrado no banco

    const errado = await request(app).post('/api/v1/auth/2fa/ativar').set(auth).send({ codigo: '000000' });
    expect(errado.status).toBe(400);

    const ativar = await request(app).post('/api/v1/auth/2fa/ativar').set(auth).send({ codigo: await generate({ secret: segredoAdmin }) });
    expect(ativar.status).toBe(200);
    expect(ativar.body.codigosRecuperacao).toHaveLength(10);
  });

  it('RF01: login seguinte pede o código, e o mesmo código não vale duas vezes', async () => {
    const login = await admin.post('/api/v1/auth/login').send({ email: 'admin@teste.com', senha: SENHA_ADMIN });
    expect(login.body.etapa).toBe('MFA');

    const codigo = await codigoTotp('admin@teste.com', segredoAdmin);
    const ok = await admin.post('/api/v1/auth/2fa/verificar').send({ mfaToken: login.body.mfaToken, codigo });
    expect(ok.status).toBe(200);
    tokenAdmin = ok.body.accessToken;

    const replay = await admin.post('/api/v1/auth/2fa/verificar').send({ mfaToken: login.body.mfaToken, codigo });
    expect(replay.status).toBe(401);
  });

  it('RF02: convite → funcionário cria senha → entra sem 2FA obrigatório', async () => {
    const convite = await request(app)
      .post('/api/v1/admin/usuarios/convites')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Ana', email: 'ana@teste.com', perfil: 'FUNCIONARIO' });
    expect(convite.status).toBe(201);

    const token = tokenDoUltimoEmail('ana@teste.com');
    expect(token).toBeTruthy();
    // Mensagem pronta para colar no WhatsApp, com o mesmo link
    expect(convite.body.link).toContain(`token=${token}`);
    expect(convite.body.mensagem).toContain(convite.body.link);

    const aceitar = await request(app).post('/api/v1/auth/convite/aceitar').send({ token, senha: 'senha-da-ana-123' });
    expect(aceitar.status).toBe(201);
    expect(aceitar.body.perfil).toBe('FUNCIONARIO');
    // Fase 3: funcionário convidado já ganha o perfil de atendimento
    expect(await prisma.funcionario.count({ where: { usuarioId: aceitar.body.id } })).toBe(1);

    // Link de uso único
    const deNovo = await request(app).post('/api/v1/auth/convite/aceitar').send({ token, senha: 'senha-da-ana-123' });
    expect(deNovo.status).toBe(400);

    const login = await request(app).post('/api/v1/auth/login').send({ email: 'ana@teste.com', senha: 'senha-da-ana-123' });
    expect(login.body.etapa).toBe('OK');
  });

  it('9.2: funcionário não acessa rotas de admin', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'ana@teste.com', senha: 'senha-da-ana-123' });
    const res = await request(app).get('/api/v1/admin/usuarios').set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('9.1: refresh rotaciona o token e reuso derruba a sessão inteira', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'ana@teste.com', senha: 'senha-da-ana-123' });
    const cookieOriginal = login.headers['set-cookie']![0]!.split(';')[0]!;

    // No banco só existe o hash do refresh token, nunca o token
    const sessao = await prisma.sessao.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(cookieOriginal).not.toContain(sessao.refreshHash);

    // Uso legítimo: troca o cookie por um novo
    const legitimo = await request(app).post('/api/v1/auth/refresh').set(csrf).set('Cookie', cookieOriginal);
    expect(legitimo.status).toBe(200);
    expect(legitimo.headers['set-cookie']![0]).not.toContain(cookieOriginal);

    // Outra aba manda o cookie antigo logo em seguida: só recusa, não derruba ninguém
    const outraAba = await request(app).post('/api/v1/auth/refresh').set(csrf).set('Cookie', cookieOriginal);
    expect(outraAba.status).toBe(401);
    const aindaLogado = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${legitimo.body.accessToken}`);
    expect(aindaLogado.status).toBe(200);

    // Minutos depois, o cookie antigo reaparece (roubado): recusado...
    await prisma.sessao.updateMany({
      where: { revogadaEm: { not: null }, substituidaPor: { not: null } },
      data: { revogadaEm: new Date(Date.now() - 60_000) },
    });
    const ladrao = await request(app).post('/api/v1/auth/refresh').set(csrf).set('Cookie', cookieOriginal);
    expect(ladrao.status).toBe(401);

    // ...e o acesso legítimo dessa família também cai, por segurança
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${legitimo.body.accessToken}`);
    expect(me.status).toBe(401);

    // Outros logins do mesmo usuário não são afetados
    const outroLogin = await request(app).post('/api/v1/auth/login').send({ email: 'ana@teste.com', senha: 'senha-da-ana-123' });
    const outro = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${outroLogin.body.accessToken}`);
    expect(outro.status).toBe(200);
  });

  it('RF05: desativar derruba o acesso na hora', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'ana@teste.com', senha: 'senha-da-ana-123' });
    const tokenAna = login.body.accessToken;
    const ana = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana@teste.com' } });

    const desativar = await request(app)
      .patch(`/api/v1/admin/usuarios/${ana.id}/status`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ ativo: false });
    expect(desativar.status).toBe(204);

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenAna}`);
    expect(me.status).toBe(401);

    const denovo = await request(app).post('/api/v1/auth/login').send({ email: 'ana@teste.com', senha: 'senha-da-ana-123' });
    expect(denovo.status).toBe(401);
  });

  it('9.2: trocar perfil exige reautenticação com senha + 2FA', async () => {
    const ana = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana@teste.com' } });
    const url = `/api/v1/admin/usuarios/${ana.id}/perfil`;
    const auth = { Authorization: `Bearer ${tokenAdmin}` };

    const semReauth = await request(app).patch(url).set(auth).send({ perfil: 'GERENTE' });
    expect(semReauth.status).toBe(401);
    expect(semReauth.body.code).toBe('REAUTENTICACAO_NECESSARIA');

    const reauth = await request(app)
      .post('/api/v1/auth/reautenticar')
      .set(auth)
      .send({ senha: SENHA_ADMIN, codigo: await codigoTotp('admin@teste.com', segredoAdmin) });
    expect(reauth.status).toBe(200);

    const comReauth = await request(app).patch(url).set(auth).set('X-Reauth-Token', reauth.body.reauthToken).send({ perfil: 'GERENTE' });
    expect(comReauth.status).toBe(204);
  });

  it('9.1: bloqueia depois de 5 senhas erradas, mesmo com a senha certa depois', async () => {
    await prisma.usuario.create({
      data: { nome: 'Bia', email: 'bia@teste.com', perfil: 'FUNCIONARIO', senhaHash: await gerarHash('senha-da-bia-123') },
    });
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/login').send({ email: 'bia@teste.com', senha: 'errada-errada' });
    }
    const certa = await request(app).post('/api/v1/auth/login').send({ email: 'bia@teste.com', senha: 'senha-da-bia-123' });
    expect(certa.status).toBe(401);
    // Mesma mensagem de "e-mail não existe": não revela nada
    const inexistente = await request(app).post('/api/v1/auth/login').send({ email: 'ninguem@teste.com', senha: 'x' });
    expect(certa.body).toEqual(inexistente.body);
  });

  it('RF03: recuperação de senha com link de uso único', async () => {
    // Resposta igual para e-mail que existe e que não existe
    const naoExiste = await request(app).post('/api/v1/auth/senha/esqueci').send({ email: 'ninguem@teste.com' });
    const existe = await request(app).post('/api/v1/auth/senha/esqueci').send({ email: 'bia@teste.com' });
    expect(existe.status).toBe(202);
    expect(existe.body).toEqual(naoExiste.body);

    const token = tokenDoUltimoEmail('bia@teste.com');
    const fraca = await request(app).post('/api/v1/auth/senha/redefinir').send({ token, senha: 'curta' });
    expect(fraca.status).toBe(400);

    const ok = await request(app).post('/api/v1/auth/senha/redefinir').send({ token, senha: 'nova-senha-da-bia' });
    expect(ok.status).toBe(204);

    const reuso = await request(app).post('/api/v1/auth/senha/redefinir').send({ token, senha: 'outra-senha-da-bia' });
    expect(reuso.status).toBe(400);

    // Redefinir também desbloqueia a conta
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'bia@teste.com', senha: 'nova-senha-da-bia' });
    expect(login.body.etapa).toBe('OK');
  });

  it('RF01: desativar o 2FA pede senha e código', async () => {
    const auth = { Authorization: `Bearer ${tokenAdmin}` };
    const semCodigo = await request(app).post('/api/v1/auth/2fa/desativar').set(auth).send({ senha: SENHA_ADMIN, codigo: '000000' });
    expect(semCodigo.status).toBe(401);

    const ok = await request(app)
      .post('/api/v1/auth/2fa/desativar')
      .set(auth)
      .send({ senha: SENHA_ADMIN, codigo: await codigoTotp('admin@teste.com', segredoAdmin) });
    expect(ok.status).toBe(204);

    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@teste.com', senha: SENHA_ADMIN });
    expect(login.body.etapa).toBe('OK');
  });

  it('9.7: as ações ficam no log de auditoria', async () => {
    const acoes = (await prisma.logAuditoria.findMany({ select: { acao: true } })).map((l) => l.acao);
    expect(acoes).toEqual(
      expect.arrayContaining(['MFA_ATIVADO', 'MFA_DESATIVADO', 'CONVITE_CRIADO', 'CONVITE_ACEITO', 'SESSAO_REUSO_DETECTADO', 'USUARIO_DESATIVADO', 'PERFIL_ALTERADO', 'CONTA_BLOQUEADA', 'SENHA_REDEFINIDA']),
    );
  });
});
