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
const { gerarHash } = await import('../../lib/password.js');
const { enviarAlertaValidade } = await import('./estoque.service.js');

const esperarAvisos = () => new Promise((r) => setTimeout(r, 50));

describe.skipIf(!comBanco)('Fase 7: estoque e ficha técnica (RF14, RF15, RF38–RF42)', () => {
  let admin = '';
  let gerente = '';
  let ana: Awaited<ReturnType<typeof loginFuncionario>>;
  let shampoo = '';
  let luva = '';
  let servicoId = '';
  const auth = () => ({ Authorization: `Bearer ${admin}` });
  const produto = (id: string) => request(app).get('/api/v1/admin/estoque/produtos?incluirInativos=true').set(auth()).then((r) => r.body.find((p: { id: string }) => p.id === id));
  const mover = (corpo: Record<string, unknown>) => request(app).post('/api/v1/admin/estoque/movimentos').set(auth()).send(corpo);

  // Atendimento que já começou (para poder concluir)
  async function atendimentoAgora(funcionarioId: string, minutosAtras = 10) {
    const c = await prisma.cliente.create({ data: { nome: 'Cliente', telefone: `159${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } });
    const inicio = new Date(Date.now() - minutosAtras * 60_000);
    return prisma.agendamento.create({
      data: {
        clienteId: c.id,
        funcionarioId,
        servicoId,
        inicio,
        fim: new Date(inicio.getTime() + 60 * 60_000),
        fimOcupado: new Date(inicio.getTime() + 60 * 60_000),
        status: 'CONFIRMADO',
        valorCentavos: 9000,
        duracaoMin: 60,
        limpezaMin: 0,
        origem: 'PAINEL',
      },
    });
  }

  beforeAll(async () => {
    await limparBanco();
    admin = await loginAdmin(app);
    ana = await loginFuncionario(app, 'Ana', 'ana@teste.com');
    await prisma.usuario.create({ data: { nome: 'Gil Gerente', email: 'gerente@teste.com', perfil: 'GERENTE', senhaHash: await gerarHash('senha-do-gerente-1') } });
    gerente = (await request(app).post('/api/v1/auth/login').send({ email: 'gerente@teste.com', senha: 'senha-do-gerente-1' })).body.accessToken;
    const s = await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Corte', duracaoMin: 60, precoCentavos: 9000 });
    servicoId = s.body.id;
    await request(app).put(`/api/v1/admin/servicos/${servicoId}/equipe`).set(auth()).send([{ funcionarioId: ana.funcionarioId }]);
  });
  afterAll(async () => {
    await limparBanco();
    await prisma.$disconnect();
  });

  describe('RF38: produtos e permissões', () => {
    it('gerente cuida do estoque; funcionário não acessa (9.2)', async () => {
      const r = await request(app)
        .post('/api/v1/admin/estoque/produtos')
        .set({ Authorization: `Bearer ${gerente}` })
        .send({ nome: 'Shampoo 1L', sku: 'SH-1L', categoria: 'Cabelo', unidade: 'ML', estoqueMinimo: 500, estoqueInicial: 1000, custoTotalInicialCentavos: 4700 });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ estoqueAtual: 1000, custoMedioCentavos: 4.7, valorEmEstoqueCentavos: 4700 });
      shampoo = r.body.id;
      const negado = await request(app).get('/api/v1/admin/estoque/produtos').set({ Authorization: `Bearer ${ana.token}` });
      expect(negado.status).toBe(403);
    });

    it('SKU repetido e unidade inválida são recusados', async () => {
      expect((await request(app).post('/api/v1/admin/estoque/produtos').set(auth()).send({ nome: 'Outro', sku: 'SH-1L', unidade: 'ML' })).status).toBe(409);
      expect((await request(app).post('/api/v1/admin/estoque/produtos').set(auth()).send({ nome: 'Outro', unidade: 'LITRO' })).status).toBe(400);
      const l = await request(app).post('/api/v1/admin/estoque/produtos').set(auth()).send({ nome: 'Luva (par)', unidade: 'UN', estoqueInicial: 100, custoTotalInicialCentavos: 5000 });
      luva = l.body.id;
    });
  });

  describe('RF39, RF42: movimentações e custo médio', () => {
    it('entrada recalcula o custo médio ponderado', async () => {
      // 1000 ml a 4,7 + 500 ml por R$ 30 (6 c/ml) → (4700 + 3000) / 1500 = 5,1333
      const r = await mover({ tipo: 'ENTRADA', produtoId: shampoo, quantidade: 500, custoTotalCentavos: 3000, validade: '2027-06-30' });
      expect(r.status).toBe(201);
      expect(r.body.estoqueAtual).toBe(1500);
      expect(r.body.custoMedioCentavos).toBeCloseTo(5.1333, 4);
      expect(r.body.validade).toBe('2027-06-30');
    });

    it('saída manual não deixa o saldo negativo; perda e ajuste exigem motivo', async () => {
      expect((await mover({ tipo: 'SAIDA', produtoId: shampoo, quantidade: 99999, motivo: 'teste' })).status).toBe(409);
      expect((await mover({ tipo: 'PERDA', produtoId: shampoo, quantidade: 10 })).status).toBe(400);
      const perda = await mover({ tipo: 'PERDA', produtoId: shampoo, quantidade: 10.5, motivo: 'Frasco caiu' });
      expect(perda.body.estoqueAtual).toBe(1489.5);
      const ajuste = await mover({ tipo: 'AJUSTE', produtoId: shampoo, saldoContado: 1480, motivo: 'Inventário do mês' });
      expect(ajuste.body.estoqueAtual).toBe(1480);
      expect((await mover({ tipo: 'AJUSTE', produtoId: shampoo, saldoContado: 1480, motivo: 'De novo' })).status).toBe(400);
    });

    it('histórico mostra tudo, com quem fez, e não pode ser editado (9.7)', async () => {
      const h = await request(app).get(`/api/v1/admin/estoque/produtos/${shampoo}/movimentos`).set(auth());
      expect(h.body.map((m: { tipo: string }) => m.tipo)).toEqual(['AJUSTE', 'PERDA', 'ENTRADA', 'ENTRADA']);
      expect(h.body[0]).toMatchObject({ quantidade: -9.5, saldoApos: 1480, motivo: 'Inventário do mês', usuario: 'Admin' });
      const qualquer = await prisma.movimentacaoEstoque.findFirstOrThrow({ where: { produtoId: shampoo } });
      await expect(prisma.movimentacaoEstoque.update({ where: { id: qualquer.id }, data: { motivo: 'adulterado' } })).rejects.toThrow();
      await expect(prisma.movimentacaoEstoque.delete({ where: { id: qualquer.id } })).rejects.toThrow();
    });

    it('10 saídas ao mesmo tempo: o saldo nunca fica negativo nem perde lançamento', async () => {
      const p = await request(app).post('/api/v1/admin/estoque/produtos').set(auth()).send({ nome: 'Algodão', unidade: 'G', estoqueInicial: 100, custoTotalInicialCentavos: 1000 });
      const rs = await Promise.all(Array.from({ length: 12 }, () => mover({ tipo: 'SAIDA', produtoId: p.body.id, quantidade: 10, motivo: 'Uso interno' })));
      expect(rs.filter((r) => r.status === 201)).toHaveLength(10);
      expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
      expect((await produto(p.body.id)).estoqueAtual).toBe(0);
      expect(await prisma.movimentacaoEstoque.count({ where: { produtoId: p.body.id, tipo: 'SAIDA' } })).toBe(10);
    });
  });

  describe('RF14, RF15: ficha técnica', () => {
    it('calcula custo e margem do serviço', async () => {
      const r = await request(app)
        .put(`/api/v1/admin/servicos/${servicoId}/ficha`)
        .set(auth())
        .send({ itens: [{ produtoId: shampoo, quantidade: 30 }, { produtoId: luva, quantidade: 1 }], extras: [{ descricao: 'Descartáveis', valorCentavos: 300 }] });
      expect(r.status).toBe(200);
      // 30 ml × 5,1333 = 154 + 1 luva × 50 + 300 = 504
      expect(r.body.custoCentavos).toBe(504);
      expect(r.body.margemCentavos).toBe(8496);
      const lista = await request(app).get('/api/v1/admin/servicos').set(auth());
      expect(lista.body[0]).toMatchObject({ custoCentavos: 504, margemPct: 94.4, temFicha: true });
    });

    it('produto em uso na ficha não pode ser removido', async () => {
      const r = await request(app).delete(`/api/v1/admin/estoque/produtos/${shampoo}`).set(auth());
      expect(r.status).toBe(409);
      expect(r.body.message).toContain('Corte');
    });
  });

  describe('RF40, RF41: baixa ao concluir', () => {
    it('concluir baixa a ficha técnica e registra o custo do atendimento', async () => {
      const a = await atendimentoAgora(ana.funcionarioId);
      const antes = (await produto(shampoo)).estoqueAtual;
      const r = await request(app).patch(`/api/v1/admin/agenda/${a.id}/status`).set(auth()).send({ status: 'CONCLUIDO' });
      expect(r.status).toBe(200);
      expect((await produto(shampoo)).estoqueAtual).toBe(antes - 30);
      expect((await produto(luva)).estoqueAtual).toBe(99);
      const salvo = await prisma.agendamento.findUniqueOrThrow({ where: { id: a.id } });
      expect(salvo.custoCentavos).toBe(504);
      expect(await prisma.movimentacaoEstoque.count({ where: { agendamentoId: a.id, tipo: 'CONSUMO' } })).toBe(2);
    });

    it('a profissional ajusta a quantidade real nos próprios atendimentos (9.2)', async () => {
      const a = await atendimentoAgora(ana.funcionarioId);
      const comoAna = { Authorization: `Bearer ${ana.token}` };
      const sug = await request(app).get(`/api/v1/staff/agenda/${a.id}/consumo`).set(comoAna);
      expect(sug.body.map((i: { quantidade: number }) => i.quantidade).sort()).toEqual([1, 30]);
      const antes = (await produto(shampoo)).estoqueAtual;
      const r = await request(app)
        .patch(`/api/v1/staff/agenda/${a.id}/status`)
        .set(comoAna)
        .send({ status: 'CONCLUIDO', consumo: [{ produtoId: shampoo, quantidade: 45 }, { produtoId: luva, quantidade: 0 }] });
      expect(r.status).toBe(200);
      expect((await produto(shampoo)).estoqueAtual).toBe(antes - 45);
      expect((await produto(luva)).estoqueAtual).toBe(99);
    });

    it('concluir duas vezes ao mesmo tempo baixa uma vez só', async () => {
      const a = await atendimentoAgora(ana.funcionarioId);
      const antes = (await produto(shampoo)).estoqueAtual;
      const rs = await Promise.all([1, 2, 3].map(() => request(app).patch(`/api/v1/admin/agenda/${a.id}/status`).set(auth()).send({ status: 'CONCLUIDO' })));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      expect((await produto(shampoo)).estoqueAtual).toBe(antes - 30);
    });

    it('RF41: avisa uma vez quando cruza o estoque mínimo', async () => {
      await request(app).patch(`/api/v1/admin/estoque/produtos/${shampoo}`).set(auth()).send({ estoqueMinimo: 1360 });
      emails.length = 0;
      await atendimentoAgora(ana.funcionarioId).then((a) => request(app).patch(`/api/v1/admin/agenda/${a.id}/status`).set(auth()).send({ status: 'CONCLUIDO' }));
      await esperarAvisos();
      const avisos = emails.filter((e) => e.assunto === 'Estoque abaixo do mínimo');
      expect(avisos.map((e) => e.para).sort()).toEqual(['admin@teste.com', 'gerente@teste.com']);
      expect(avisos[0]!.texto).toContain('Shampoo 1L');

      emails.length = 0;
      await atendimentoAgora(ana.funcionarioId).then((a) => request(app).patch(`/api/v1/admin/agenda/${a.id}/status`).set(auth()).send({ status: 'CONCLUIDO' }));
      await esperarAvisos();
      expect(emails.filter((e) => e.assunto === 'Estoque abaixo do mínimo')).toHaveLength(0);

      const alertas = await request(app).get('/api/v1/admin/estoque/alertas').set(auth());
      expect(alertas.body.abaixoDoMinimo).toBe(1);
    });

    it('RF41: validade próxima aparece nos alertas e o aviso diário sai uma vez', async () => {
      const em10dias = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
      await request(app).patch(`/api/v1/admin/estoque/produtos/${luva}`).set(auth()).send({ validade: em10dias });
      const lista = await request(app).get('/api/v1/admin/estoque/produtos?alertas=true').set(auth());
      expect(lista.body.find((p: { id: string }) => p.id === luva)).toMatchObject({ venceEmBreve: true });
      emails.length = 0;
      expect(await enviarAlertaValidade()).toBe(1);
      expect(await enviarAlertaValidade()).toBe(0);
    });
  });
});
