import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

const emails: { para: string; assunto: string; texto: string }[] = [];
vi.mock('../../lib/mailer.js', () => ({
  enviarEmail: async (para: string, assunto: string, texto: string) => {
    emails.push({ para, assunto, texto });
  },
}));

const { app } = await import('../../app.js');
const { prisma } = await import('../../lib/prisma.js');
const { comBanco, limparBanco, loginAdmin, loginFuncionario } = await import('../../../tests/helpers.js');
const { expirar, saldo } = await import('./fidelidade.service.js');

describe.skipIf(!comBanco)('Fase 8: fidelidade (RF43–RF46)', () => {
  let admin = '';
  let ana: Awaited<ReturnType<typeof loginFuncionario>>;
  let servicoId = '';
  let outroServicoId = '';
  let clienteId = '';
  const auth = () => ({ Authorization: `Bearer ${admin}` });
  const programa = (extra: Record<string, unknown> = {}) =>
    request(app)
      .put('/api/v1/admin/fidelidade/programa')
      .set(auth())
      .send({ ativo: true, tipo: 'PONTOS', pontosPorReal: 1, pontosPorAtendimento: 10, servicosElegiveis: [], validadeDias: 365, ...extra });

  async function atendimento(valorCentavos = 9000, servico = servicoId) {
    const inicio = new Date(Date.now() - 10 * 60_000);
    return prisma.agendamento.create({
      data: {
        clienteId,
        funcionarioId: ana.funcionarioId,
        servicoId: servico,
        inicio,
        fim: new Date(inicio.getTime() + 3_600_000),
        fimOcupado: new Date(inicio.getTime() + 3_600_000),
        status: 'CONFIRMADO',
        valorCentavos,
        duracaoMin: 60,
        limpezaMin: 0,
        origem: 'PAINEL',
      },
    });
  }
  const concluir = (id: string) => request(app).patch(`/api/v1/admin/agenda/${id}/status`).set(auth()).send({ status: 'CONCLUIDO' });
  const resumo = () => request(app).get(`/api/v1/admin/fidelidade/clientes/${clienteId}`).set(auth());

  beforeAll(async () => {
    await limparBanco();
    admin = await loginAdmin(app);
    ana = await loginFuncionario(app, 'Ana', 'ana@teste.com');
    servicoId = (await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Corte', duracaoMin: 60, precoCentavos: 9000 })).body.id;
    outroServicoId = (await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Escova', duracaoMin: 30, precoCentavos: 5000 })).body.id;
    clienteId = (await prisma.cliente.create({ data: { nome: 'Carla Souza', telefone: '15999990001', email: 'carla@cliente.com' } })).id;
  });
  afterAll(async () => {
    await limparBanco();
    await prisma.$disconnect();
  });

  describe('RF43, RF45: ganhar pontos', () => {
    it('programa desligado não credita nada', async () => {
      const a = await atendimento();
      expect((await concluir(a.id)).status).toBe(200);
      expect((await resumo()).body.saldo).toBe(0);
    });

    it('só admin configura (9.2)', async () => {
      const r = await request(app).get('/api/v1/admin/fidelidade/programa').set({ Authorization: `Bearer ${ana.token}` });
      expect(r.status).toBe(403);
      expect((await programa()).status).toBe(200);
    });

    it('credita ao concluir: R$ 90 × 1 + 10 de bônus = 100, e avisa por e-mail', async () => {
      emails.length = 0;
      const a = await atendimento();
      await concluir(a.id);
      const r = await resumo();
      expect(r.body.saldo).toBe(100);
      expect(r.body.extrato[0]).toMatchObject({ tipo: 'CREDITO', pontos: 100 });
      expect(emails.find((e) => e.para === 'carla@cliente.com')?.texto).toContain('agora tem 100 pontos');
    });

    it('não credita antes de concluir, nem duas vezes', async () => {
      const a = await atendimento();
      expect((await resumo()).body.saldo).toBe(100);
      await Promise.all([concluir(a.id), concluir(a.id)]);
      expect((await resumo()).body.saldo).toBe(200);
      expect(await prisma.transacaoFidelidade.count({ where: { agendamentoId: a.id } })).toBe(1);
    });

    it('serviço fora da lista do programa não rende pontos', async () => {
      await programa({ servicosElegiveis: [servicoId] });
      const a = await atendimento(5000, outroServicoId);
      await concluir(a.id);
      expect((await resumo()).body.saldo).toBe(200);
      await programa();
    });
  });

  describe('RF44: recompensas e vouchers', () => {
    let recompensaId = '';
    let voucherId = '';
    let codigo = '';

    it('cria recompensa e valida coerência', async () => {
      expect((await request(app).post('/api/v1/admin/fidelidade/recompensas').set(auth()).send({ nome: 'Desconto', tipo: 'DESCONTO', custoPontos: 150, validadeDias: 30 })).status).toBe(400);
      const r = await request(app)
        .post('/api/v1/admin/fidelidade/recompensas')
        .set(auth())
        .send({ nome: 'R$ 20 de desconto', tipo: 'DESCONTO', valorCentavos: 2000, custoPontos: 150, validadeDias: 30 });
      expect(r.status).toBe(201);
      recompensaId = r.body.id;
    });

    it('resgata, gera código e desconta os pontos', async () => {
      const r = await request(app).post(`/api/v1/admin/fidelidade/clientes/${clienteId}/resgates`).set(auth()).send({ recompensaId });
      expect(r.status).toBe(201);
      expect(r.body.codigo).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      voucherId = r.body.id;
      codigo = r.body.codigo;
      expect((await resumo()).body.saldo).toBe(50);
      // Saldo insuficiente
      const sem = await request(app).post(`/api/v1/admin/fidelidade/clientes/${clienteId}/resgates`).set(auth()).send({ recompensaId });
      expect(sem.status).toBe(409);
    });

    it('cancelar o voucher devolve os pontos; usado não volta', async () => {
      await request(app).post(`/api/v1/admin/fidelidade/vouchers/${voucherId}/cancelar`).set(auth());
      expect((await resumo()).body.saldo).toBe(200);
      const v2 = await request(app).post(`/api/v1/admin/fidelidade/clientes/${clienteId}/resgates`).set(auth()).send({ recompensaId });
      const achado = await request(app).get(`/api/v1/admin/fidelidade/vouchers/${v2.body.codigo.toLowerCase()}`).set(auth());
      expect(achado.body).toMatchObject({ status: 'DISPONIVEL', cliente: { nome: 'Carla Souza' } });
      const usos = await Promise.all([1, 2].map(() => request(app).post(`/api/v1/admin/fidelidade/vouchers/${v2.body.id}/usar`).set(auth())));
      expect(usos.map((u) => u.status).sort()).toEqual([204, 409]);
      expect((await request(app).post(`/api/v1/admin/fidelidade/vouchers/${v2.body.id}/cancelar`).set(auth())).status).toBe(409);
      expect(codigo).not.toBe(v2.body.codigo);
    });

    it('dois resgates ao mesmo tempo não gastam o mesmo ponto', async () => {
      // saldo 50 + ajuste 250 = 300 → cabem 2 resgates de 150, não 3
      await request(app).post(`/api/v1/admin/fidelidade/clientes/${clienteId}/ajuste`).set(auth()).send({ pontos: 250, motivo: 'Teste de concorrência' });
      const rs = await Promise.all([1, 2, 3].map(() => request(app).post(`/api/v1/admin/fidelidade/clientes/${clienteId}/resgates`).set(auth()).send({ recompensaId })));
      expect(rs.filter((r) => r.status === 201)).toHaveLength(2);
      expect((await resumo()).body.saldo).toBe(0);
    });
  });

  describe('RF46: ajuste, extrato e visão do cliente', () => {
    it('ajuste exige justificativa, fica na auditoria e não deixa saldo negativo', async () => {
      expect((await request(app).post(`/api/v1/admin/fidelidade/clientes/${clienteId}/ajuste`).set(auth()).send({ pontos: 30 })).status).toBe(400);
      const ok = await request(app).post(`/api/v1/admin/fidelidade/clientes/${clienteId}/ajuste`).set(auth()).send({ pontos: 30, motivo: 'Cortesia de aniversário' });
      expect(ok.body.saldo).toBe(30);
      expect(ok.body.extrato[0]).toMatchObject({ tipo: 'AJUSTE', pontos: 30, motivo: 'Cortesia de aniversário', usuario: 'Admin' });
      expect((await request(app).post(`/api/v1/admin/fidelidade/clientes/${clienteId}/ajuste`).set(auth()).send({ pontos: -999, motivo: 'Tirar demais' })).status).toBe(409);
      expect(await prisma.logAuditoria.count({ where: { acao: 'PONTOS_AJUSTADOS' } })).toBe(2);
    });

    it('extrato não pode ser apagado nem reescrito (9.7)', async () => {
      const t = await prisma.transacaoFidelidade.findFirstOrThrow({ where: { clienteId, tipo: 'AJUSTE', pontos: { gt: 0 } }, orderBy: { createdAt: 'desc' } });
      await expect(prisma.transacaoFidelidade.update({ where: { id: t.id }, data: { pontos: 99999 } })).rejects.toThrow();
      await expect(prisma.transacaoFidelidade.update({ where: { id: t.id }, data: { disponivel: t.disponivel + 10 } })).rejects.toThrow();
      await expect(prisma.transacaoFidelidade.delete({ where: { id: t.id } })).rejects.toThrow();
    });

    it('o cliente vê saldo, extrato e resgata pelo site (com código por e-mail)', async () => {
      emails.length = 0;
      await request(app).post('/api/v1/public/clientes/codigo').send({ email: 'carla@cliente.com' });
      const codigoEmail = emails.at(-1)!.texto.match(/\d{6}/)![0];
      const { token } = (await request(app).post('/api/v1/public/clientes/entrar').send({ email: 'carla@cliente.com', codigo: codigoEmail })).body;
      const r = await request(app).get('/api/v1/public/clientes/fidelidade').set('Authorization', `Bearer ${token}`);
      expect(r.body.programa).toMatchObject({ tipo: 'PONTOS', pontosPorReal: 1 });
      expect(r.body.contas[0].saldo).toBe(30);
      expect(r.body.contas[0].cliente).toEqual({ id: clienteId, nome: 'Carla Souza' }); // sem telefone/e-mail
      expect(JSON.stringify(r.body)).not.toMatch(/usuario|motivo/);
      expect(r.body.recompensas).toHaveLength(1);
      const sem = await request(app).post('/api/v1/public/clientes/fidelidade/resgatar').set('Authorization', `Bearer ${token}`).send({ recompensaId: r.body.recompensas[0].id });
      expect(sem.status).toBe(409);
      const semLogin = await request(app).get('/api/v1/public/clientes/fidelidade');
      expect(semLogin.status).toBe(401);
    });
  });

  describe('Validade e cartão de selos', () => {
    it('pontos vencidos saem do saldo e entram no extrato', async () => {
      const antes = await saldo(prisma, clienteId);
      const daqui2anos = new Date(Date.now() + 2 * 365 * 86_400_000);
      const r = await expirar(daqui2anos);
      expect(r.pontos).toBe(antes);
      expect(await saldo(prisma, clienteId, daqui2anos)).toBe(0);
      expect(await prisma.transacaoFidelidade.count({ where: { clienteId, tipo: 'EXPIRACAO' } })).toBe(1);
    });

    it('cartão de selos: 1 selo por atendimento, qualquer valor', async () => {
      const novo = (await prisma.cliente.create({ data: { nome: 'Davi', telefone: '15999990002' } })).id;
      const antes = clienteId;
      clienteId = novo;
      await programa({ tipo: 'SELOS', validadeDias: null });
      for (const v of [9000, 4500]) await concluir((await atendimento(v)).id);
      expect((await resumo()).body.saldo).toBe(2);
      clienteId = antes;
    });
  });
});
