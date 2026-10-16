import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';

vi.mock('../../lib/mailer.js', () => ({ enviarEmail: async () => undefined }));

const { app } = await import('../../app.js');
const { prisma } = await import('../../lib/prisma.js');
const { comBanco, limparBanco, loginAdmin, loginFuncionario, reauthDe } = await import('../../../tests/helpers.js');

const ZONA = 'America/Sao_Paulo';
const t = (iso: string) => DateTime.fromISO(iso, { zone: ZONA }).toJSDate();
// Semana fixa no passado: segunda 07/09/2026 a domingo 13/09/2026
const SEMANA = { de: '2026-09-07', ate: '2026-09-13' };

describe.skipIf(!comBanco)('Fase 10: relatórios (RF47–RF55)', () => {
  let admin = '';
  let ana: Awaited<ReturnType<typeof loginFuncionario>>;
  let bia: Awaited<ReturnType<typeof loginFuncionario>>;
  let corteId = '';
  let escovaId = '';
  let carlaId = '';
  let daviId = '';
  const auth = () => ({ Authorization: `Bearer ${admin}` });
  const rel = (tipo: string, q: Record<string, string> = SEMANA) => request(app).get(`/api/v1/admin/relatorios/${tipo}`).query(q).set(auth());
  const indicador = (body: { indicadores: { id: string; valor: number | null }[] }, id: string) => body.indicadores.find((i) => i.id === id)?.valor;
  const tabela = (body: { tabelas: { id: string; linhas: Record<string, unknown>[] }[] }, id: string) => body.tabelas.find((x) => x.id === id)!.linhas;

  let n = 0;
  async function agendamento(p: {
    funcionarioId: string;
    clienteId: string;
    servicoId?: string;
    inicio: string;
    status: 'CONCLUIDO' | 'CANCELADO' | 'NAO_COMPARECEU' | 'CONFIRMADO';
    valor?: number;
    forma?: 'PIX' | 'DINHEIRO' | 'CARTAO_CREDITO' | 'CARTAO_DEBITO';
    custo?: number;
    comissao?: number | null;
    sinal?: { status: 'APROVADO' | 'RETIDO' | 'REEMBOLSADO' | 'CANCELADO'; pago: boolean };
  }) {
    const inicio = t(p.inicio);
    const fim = new Date(inicio.getTime() + 3_600_000);
    const a = await prisma.agendamento.create({
      data: {
        clienteId: p.clienteId,
        funcionarioId: p.funcionarioId,
        servicoId: p.servicoId ?? corteId,
        inicio,
        fim,
        fimOcupado: fim,
        status: p.status,
        valorCentavos: p.valor ?? 10000,
        duracaoMin: 60,
        limpezaMin: 0,
        origem: 'PAINEL',
        formaPagamento: p.forma ?? null,
        custoCentavos: p.custo ?? null,
        comissaoCentavos: p.comissao ?? null,
      },
    });
    if (p.sinal) {
      await prisma.pagamento.create({
        data: {
          agendamentoId: a.id,
          valorCentavos: 3000,
          status: p.sinal.status,
          gateway: 'SIMULADO',
          idempotencyKey: `teste-${++n}`,
          expiraEm: inicio,
          pagoEm: p.sinal.pago ? inicio : null,
          valorPagoCentavos: p.sinal.pago ? 3000 : null,
        },
      });
    }
    return a;
  }

  beforeAll(async () => {
    await limparBanco();
    admin = await loginAdmin(app);
    ana = await loginFuncionario(app, 'Ana', 'ana@teste.com');
    bia = await loginFuncionario(app, 'Bia', 'bia@teste.com');
    await prisma.funcionario.update({ where: { id: ana.funcionarioId }, data: { comissaoPadraoPct: 10 } });
    await prisma.funcionario.update({ where: { id: bia.funcionarioId }, data: { comissaoPadraoPct: 20 } });
    corteId = (await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Corte', duracaoMin: 60, precoCentavos: 10000 })).body.id;
    escovaId = (await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Escova', duracaoMin: 60, precoCentavos: 5000 })).body.id;
    // RF54: Ana ganha 40% no corte; Bia fica com o padrão dela
    const equipe = await request(app)
      .put(`/api/v1/admin/servicos/${corteId}/equipe`)
      .set(auth())
      .send([
        { funcionarioId: ana.funcionarioId, comissaoPct: 40 },
        { funcionarioId: bia.funcionarioId },
      ]);
    expect(equipe.status).toBe(200);
    expect(equipe.body.equipe.find((m: { funcionarioId: string }) => m.funcionarioId === ana.funcionarioId).comissaoPct).toBe(40);
    await request(app).put(`/api/v1/admin/servicos/${escovaId}/equipe`).set(auth()).send([{ funcionarioId: ana.funcionarioId }]);
    // Jornada da Ana: todo dia das 9h às 18h
    await request(app)
      .put(`/api/v1/admin/horarios/funcionarios/${ana.funcionarioId}/jornada`)
      .set(auth())
      .send({ semana: [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, faixas: [{ inicio: '09:00', fim: '18:00' }] })) });
    await prisma.bloqueio.create({ data: { funcionarioId: ana.funcionarioId, inicio: t('2026-09-08T10:00'), fim: t('2026-09-08T12:00') } });

    carlaId = (await prisma.cliente.create({ data: { nome: 'Carla Souza', telefone: '15999990001' } })).id;
    // Nome malicioso: vai parar no CSV (injeção de fórmula)
    daviId = (await prisma.cliente.create({ data: { nome: '=HYPERLINK("http://mal.example","x")', telefone: '15999990002' } })).id;

    const A = ana.funcionarioId;
    // Carla já veio antes (agosto): no período ela é recorrente
    await agendamento({ funcionarioId: A, clienteId: carlaId, inicio: '2026-08-10T09:00', status: 'CONCLUIDO', comissao: 4000 });
    // Antigo, sem comissão gravada: usa o % atual (40%)
    await agendamento({ funcionarioId: A, clienteId: carlaId, inicio: '2026-09-07T09:00', status: 'CONCLUIDO', forma: 'DINHEIRO', custo: 1500, comissao: null });
    await agendamento({ funcionarioId: A, clienteId: carlaId, inicio: '2026-09-08T09:00', status: 'CONCLUIDO', forma: 'CARTAO_CREDITO', custo: 1500, comissao: 4000, sinal: { status: 'APROVADO', pago: true } });
    await agendamento({ funcionarioId: A, clienteId: carlaId, inicio: '2026-09-09T14:00', status: 'NAO_COMPARECEU', sinal: { status: 'RETIDO', pago: true } });
    await agendamento({ funcionarioId: A, clienteId: carlaId, inicio: '2026-09-10T10:00', status: 'CANCELADO', sinal: { status: 'REEMBOLSADO', pago: true } });
    await agendamento({ funcionarioId: A, clienteId: carlaId, inicio: '2026-09-11T09:00', status: 'CANCELADO', sinal: { status: 'CANCELADO', pago: false } });
    await agendamento({ funcionarioId: bia.funcionarioId, clienteId: daviId, inicio: '2026-09-07T09:00', status: 'CONCLUIDO', forma: 'PIX', custo: 2500, comissao: 2000 });
  });
  afterAll(async () => {
    await limparBanco();
    await prisma.$disconnect();
  });

  describe('RF47, RF54: concluir grava forma de pagamento e congela a comissão', () => {
    it('usa o % do serviço para a profissional, senão o padrão dela', async () => {
      const agora = DateTime.now().setZone(ZONA).minus({ minutes: 70 }).toFormat("yyyy-MM-dd'T'HH:mm");
      const corte = await agendamento({ funcionarioId: ana.funcionarioId, clienteId: carlaId, inicio: agora, status: 'CONFIRMADO' });
      const r = await request(app).patch(`/api/v1/admin/agenda/${corte.id}/status`).set(auth()).send({ status: 'CONCLUIDO', formaPagamento: 'CARTAO_DEBITO' });
      expect(r.status).toBe(200);
      expect(r.body.formaPagamento).toBe('CARTAO_DEBITO');
      const salvo = await prisma.agendamento.findUniqueOrThrow({ where: { id: corte.id } });
      expect(salvo).toMatchObject({ comissaoCentavos: 4000, formaPagamento: 'CARTAO_DEBITO' });
      expect(salvo.concluidoEm).toBeInstanceOf(Date);

      // Mudar o % depois não reescreve o que já foi concluído
      await prisma.funcionario.update({ where: { id: ana.funcionarioId }, data: { comissaoPadraoPct: 15 } });
      const depois = DateTime.now().setZone(ZONA).minus({ minutes: 200 }).toFormat("yyyy-MM-dd'T'HH:mm");
      const escova = await agendamento({ funcionarioId: ana.funcionarioId, clienteId: carlaId, servicoId: escovaId, inicio: depois, status: 'CONFIRMADO', valor: 5000 });
      await request(app).patch(`/api/v1/staff/agenda/${escova.id}/status`).set({ Authorization: `Bearer ${ana.token}` }).send({ status: 'CONCLUIDO', formaPagamento: 'PIX' });
      expect((await prisma.agendamento.findUniqueOrThrow({ where: { id: escova.id } })).comissaoCentavos).toBe(750); // 15% de 50
      expect((await prisma.agendamento.findUniqueOrThrow({ where: { id: corte.id } })).comissaoCentavos).toBe(4000);
      await prisma.funcionario.update({ where: { id: ana.funcionarioId }, data: { comissaoPadraoPct: 10 } });
    });

    it('forma de pagamento inválida é recusada', async () => {
      const r = await request(app).patch(`/api/v1/admin/agenda/00000000-0000-4000-8000-000000000000/status`).set(auth()).send({ status: 'CONCLUIDO', formaPagamento: 'CHEQUE' });
      expect(r.status).toBe(400);
    });
  });

  describe('RF47: faturamento', () => {
    it('soma concluídos e sinais retidos, separa por forma, serviço e profissional', async () => {
      const r = await rel('faturamento');
      expect(r.status).toBe(200);
      expect(indicador(r.body, 'total')).toBe(33000);
      expect(indicador(r.body, 'concluidos')).toBe(3);
      expect(indicador(r.body, 'ticket')).toBe(10000);
      expect(indicador(r.body, 'retido')).toBe(3000);
      const formas = Object.fromEntries(tabela(r.body, 'formas').map((l) => [l.forma, l.valor]));
      expect(formas).toEqual({ Dinheiro: 10000, Pix: 10000, 'Cartão de crédito': 7000, 'Pix (sinal)': 3000, 'Sinal retido (Pix)': 3000 });
      expect(tabela(r.body, 'profissionais')).toEqual([
        { profissional: 'Ana', qtd: 2, valor: 20000, ticket: 10000 },
        { profissional: 'Bia', qtd: 1, valor: 10000, ticket: 10000 },
      ]);
      const serie = r.body.graficos.find((g: { id: string }) => g.id === 'evolucao');
      expect(serie.pontos).toHaveLength(7); // um ponto por dia, mesmo sem venda
      expect(serie.pontos[0]).toEqual({ rotulo: '07/09', valor: 20000 });
    });

    it('filtra por profissional', async () => {
      const r = await rel('faturamento', { ...SEMANA, funcionarioId: bia.funcionarioId });
      expect(r.body.profissional).toBe('Bia');
      expect(indicador(r.body, 'total')).toBe(10000);
    });

    it('valida o período (até 366 dias, início antes do fim) e o tipo', async () => {
      expect((await rel('faturamento', { de: '2025-01-01', ate: '2026-09-13' })).status).toBe(400);
      expect((await rel('faturamento', { de: '2026-09-13', ate: '2026-09-07' })).status).toBe(400);
      expect((await rel('faturamento', { de: '2026-02-30', ate: '2026-03-01' })).status).toBe(400);
      expect((await rel('nao-existe')).status).toBe(400);
      expect((await rel('faturamento', { ...SEMANA, funcionarioId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    });
  });

  it('RF48: sinais recebidos, retidos, devolvidos e não pagos', async () => {
    const r = await rel('sinais');
    expect(indicador(r.body, 'recebido')).toBe(9000);
    expect(indicador(r.body, 'retido')).toBe(3000);
    expect(indicador(r.body, 'devolvido')).toBe(3000);
    expect(indicador(r.body, 'expirados')).toBe(1);
    expect(tabela(r.body, 'detalhe')).toHaveLength(4);
  });

  it('RF49: ocupação desconta bloqueios e ignora cancelados', async () => {
    const r = await rel('ocupacao', { ...SEMANA, funcionarioId: ana.funcionarioId });
    expect(indicador(r.body, 'disponivel')).toBe(7 * 540 - 120);
    expect(indicador(r.body, 'ocupado')).toBe(180);
    expect(indicador(r.body, 'faltas')).toBe(60);
    expect(indicador(r.body, 'taxa')).toBeCloseTo(180 / 3660, 6);
    const mapa = r.body.graficos[0];
    expect(mapa.linhas[0]).toBe('Seg');
    expect(mapa.colunas[0]).toBe('09h');
    expect(mapa.valores[0][0]).toBe(1); // segunda 9h: ocupada
    expect(mapa.valores[1][1]).toBe(null); // terça 10h: bloqueada, nada disponível
  });

  it('RF50: margem por serviço (receita − custo − comissão)', async () => {
    const r = await rel('servicos');
    expect(tabela(r.body, 'servicos')[0]).toMatchObject({ servico: 'Corte', qtd: 3, receita: 30000, custo: 5500, comissao: 10000, margem: 14500 });
  });

  it('RF52: novos × recorrentes, ticket e faltas', async () => {
    const r = await rel('clientes');
    expect(indicador(r.body, 'atendidos')).toBe(2);
    expect(indicador(r.body, 'novos')).toBe(1);
    expect(indicador(r.body, 'recorrentes')).toBe(1);
    expect(indicador(r.body, 'faltas')).toBe(0.25);
    expect(tabela(r.body, 'ranking')[0]).toMatchObject({ cliente: 'Carla Souza', qtd: 2, valor: 20000, faltas: 1, ultima: '2026-09-08' });
  });

  it('RF54: comissões por profissional', async () => {
    const r = await rel('comissoes');
    expect(indicador(r.body, 'total')).toBe(10000);
    expect(tabela(r.body, 'profissionais').map((l) => [l.profissional, l.comissao])).toEqual([
      ['Ana', 8000],
      ['Bia', 2000],
    ]);
    expect(r.body.tabelas.find((x: { id: string }) => x.id === 'atendimentos')).toBeUndefined();
  });

  it('RF51 e RF53: estoque e fidelidade', async () => {
    const hoje = DateTime.now().setZone(ZONA).toISODate()!;
    const p = await request(app)
      .post('/api/v1/admin/estoque/produtos')
      .set(auth())
      .send({ nome: 'Shampoo', unidade: 'ML', estoqueMinimo: 500, estoqueInicial: 1000, custoTotalInicialCentavos: 5000 });
    await request(app).post('/api/v1/admin/estoque/movimentos').set(auth()).send({ tipo: 'PERDA', produtoId: p.body.id, quantidade: 600, motivo: 'Frasco caiu' });
    const e = await rel('estoque', { de: hoje, ate: hoje });
    expect(indicador(e.body, 'perdas')).toBe(3000);
    expect(indicador(e.body, 'valor')).toBe(2000);
    expect(indicador(e.body, 'abaixo')).toBe(1);
    expect(tabela(e.body, 'posicao')[0]).toMatchObject({ produto: 'Shampoo', estoque: 400, situacao: 'Abaixo do mínimo' });

    const f = await rel('fidelidade', { de: hoje, ate: hoje });
    expect(f.status).toBe(200);
    expect(indicador(f.body, 'emitidos')).toBe(0);
  });

  describe('9.2: profissional vê só a própria produção', () => {
    const staff = (tipo: string, q: Record<string, string> = SEMANA) =>
      request(app).get(`/api/v1/staff/relatorios/${tipo}`).query(q).set({ Authorization: `Bearer ${ana.token}` });

    it('ignora o funcionarioId da URL', async () => {
      const r = await staff('comissoes', { ...SEMANA, funcionarioId: bia.funcionarioId });
      expect(r.status).toBe(200);
      expect(r.body.profissional).toBe('Ana');
      expect(indicador(r.body, 'total')).toBe(8000);
      expect(tabela(r.body, 'atendimentos')).toHaveLength(2);
      expect(JSON.stringify(r.body)).not.toContain('Bia');
    });

    it('não acessa relatórios da empresa', async () => {
      expect((await staff('estoque')).status).toBe(403);
      expect((await staff('clientes')).status).toBe(403);
      expect((await request(app).get('/api/v1/admin/relatorios/faturamento').query(SEMANA).set({ Authorization: `Bearer ${ana.token}` })).status).toBe(403);
      expect((await request(app).get('/api/v1/admin/relatorios/faturamento').query(SEMANA)).status).toBe(401);
    });
  });

  describe('RF55: exportação', () => {
    const exportar = (tipo: string, formato: string, reauth?: string) =>
      request(app)
        .get(`/api/v1/admin/relatorios/${tipo}/exportar`)
        .query({ ...SEMANA, formato })
        .set({ ...auth(), ...(reauth && { 'X-Reauth-Token': reauth }) })
        .buffer(true)
        .parse((res, cb) => {
          const partes: Buffer[] = [];
          res.on('data', (b: Buffer) => partes.push(b));
          res.on('end', () => cb(null, Buffer.concat(partes)));
        });

    it('pede a senha de novo (9.1)', async () => {
      expect((await exportar('faturamento', 'csv')).status).toBe(401);
    });

    it('CSV abre no Excel e fica na auditoria (9.7)', async () => {
      const r = await exportar('faturamento', 'csv', await reauthDe());
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('text/csv');
      expect(r.headers['content-disposition']).toBe('attachment; filename="relatorio-faturamento-2026-09-07-a-2026-09-13.csv"');
      expect(r.headers['cache-control']).toBe('no-store');
      const texto = (r.body as Buffer).toString('utf8');
      expect(texto.startsWith('﻿')).toBe(true);
      expect(texto).toContain('Faturamento;330,00');
      expect(texto).toContain('Período;07/09/2026 a 13/09/2026');
      const log = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'RELATORIO_EXPORTADO' } });
      expect(log.detalhes).toMatchObject({ tipo: 'faturamento', formato: 'csv' });
    });

    it('CSV neutraliza fórmulas vindas de nomes', async () => {
      const r = await exportar('clientes', 'csv', await reauthDe());
      const texto = (r.body as Buffer).toString('utf8');
      expect(texto).toContain(`"'=HYPERLINK(""http://mal.example"",""x"")"`);
      expect(texto.split('\r\n').some((l) => l.startsWith('=') || l.includes(';='))).toBe(false);
    });

    it('PDF', async () => {
      const r = await exportar('servicos', 'pdf', await reauthDe());
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('application/pdf');
      expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      // Relatório curto cabe numa página (o rodapé não pode abrir página em branco)
      expect((r.body as Buffer).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
    });

    it('profissional também exporta, só o dele', async () => {
      const r = await request(app)
        .get('/api/v1/staff/relatorios/comissoes/exportar')
        .query({ ...SEMANA, formato: 'csv', funcionarioId: bia.funcionarioId })
        .set({ Authorization: `Bearer ${ana.token}`, 'X-Reauth-Token': await reauthDe('ana@teste.com') });
      expect(r.status).toBe(200);
      expect(r.text).toContain('Profissional;Ana');
      expect(r.text).not.toContain('Bia');
    });
  });
});
