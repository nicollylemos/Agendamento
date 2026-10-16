import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';

const emails: { para: string; assunto: string; texto: string }[] = [];
vi.mock('../../lib/mailer.js', () => ({
  enviarEmail: async (para: string, assunto: string, texto: string) => {
    emails.push({ para, assunto, texto });
  },
}));

const { app } = await import('../../app.js');
const { prisma } = await import('../../lib/prisma.js');
const { comBanco, limparBanco, loginAdmin, reauthDe } = await import('../../../tests/helpers.js');
const pagamentos = await import('./pagamentos.service.js');
const { gatewayDoTipo } = await import('./recebedor.service.js');
const { Simulado } = await import('./gateway/simulado.js');
const { enviarLembretes } = await import('../../jobs/lembretes.js');

const zona = 'America/Sao_Paulo';
const dia = (n: number) => DateTime.now().setZone(zona).plus({ days: n }).toISODate()!;
const todosOsDias = Array.from({ length: 7 }, (_, diaSemana) => ({ diaSemana, faixas: [{ inicio: '08:00', fim: '20:00' }] }));

let tel = 0;
const cliente = () => ({ nome: 'Carla Souza', telefone: `(15) 9${String(2000_0000 + ++tel).slice(-8)}`, email: 'carla@cliente.com' });
const token = (link: string) => new URL(link).searchParams.get('token')!;

describe.skipIf(!comBanco)('Fase 6: sinal via Pix e recebedor (RF27–RF37)', () => {
  let admin = '';
  let servicoId = '';
  let funcionarioId = '';
  const auth = () => ({ Authorization: `Bearer ${admin}` });
  const comReauth = async () => ({ ...auth(), 'X-Reauth-Token': await reauthDe() });

  const agendar = (data: string, horario: string, extra: Record<string, unknown> = {}) =>
    request(app)
      .post('/api/v1/public/agendamentos')
      .send({ servicoId, data, horario, aceitePolitica: true, consentimentoLgpd: true, cliente: cliente(), ...extra });

  const simulado = async () => {
    const g = await gatewayDoTipo('SIMULADO');
    if (!(g instanceof Simulado)) throw new Error('sem simulado');
    return g;
  };
  const pagamentoDe = (agendamentoId: string) => prisma.pagamento.findFirstOrThrow({ where: { agendamentoId } });

  beforeAll(async () => {
    await limparBanco();
    admin = await loginAdmin(app);
    const f = await request(app).post('/api/v1/admin/funcionarios').set(auth()).send({ nome: 'Ana Paula' });
    funcionarioId = f.body.id;
    const s = await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Corte', duracaoMin: 60, precoCentavos: 9000 });
    servicoId = s.body.id;
    await request(app).put(`/api/v1/admin/servicos/${servicoId}/equipe`).set(auth()).send([{ funcionarioId }]);
    await request(app).put(`/api/v1/admin/horarios/funcionarios/${funcionarioId}/jornada`).set(auth()).send({ semana: todosOsDias });
    await request(app)
      .put('/api/v1/admin/agenda/config')
      .set(auth())
      .send({ antecedenciaMinimaMin: 0, diasAFrente: 60, passoMin: 15, prazoCancelamentoHoras: 1, prazoReagendamentoHoras: 1 });
  });
  afterAll(async () => {
    await limparBanco();
    await prisma.$disconnect();
  });

  describe('RF28: regra do sinal', () => {
    it('mudar a regra exige reautenticação (9.1)', async () => {
      const corpo = { sinalExige: true, sinalTipo: 'PERCENTUAL', sinalValor: 3000, sinalPrazoMin: 30, reembolsoAteHoras: 24, reembolsoAutomaticoAposExpirar: true };
      const sem = await request(app).put('/api/v1/admin/pagamentos/config').set(auth()).send(corpo);
      expect(sem.status).toBe(401);
      const com = await request(app).put('/api/v1/admin/pagamentos/config').set(await comReauth()).send(corpo);
      expect(com.status).toBe(200);
      const invalido = await request(app).put('/api/v1/admin/pagamentos/config').set(await comReauth()).send({ ...corpo, sinalValor: 20000 });
      expect(invalido.status).toBe(400);
    });

    it('sem recebedor ativo, o agendamento entra confirmado e o painel avisa', async () => {
      const r = await agendar(dia(3), '09:00');
      expect(r.status).toBe(201);
      expect(r.body.agendamento.status).toBe('CONFIRMADO');
      expect(r.body.pix).toBeNull();
      const s = await request(app).get('/api/v1/admin/pagamentos/situacao').set(auth());
      expect(s.body).toMatchObject({ semCobrar: true, recebedorAtivo: false });
    });
  });

  describe('RF34–RF37: recebedor', () => {
    it('salvar exige senha, cifra os dados e a tela só vê os 4 últimos', async () => {
      const corpo = { nome: 'Studio Bela LTDA', documento: '11.222.333/0001-81', tipoChave: 'EMAIL', chave: 'pix@studiobela.com', banco: 'Nubank', gateway: 'SIMULADO' };
      expect((await request(app).put('/api/v1/admin/pagamentos/recebedor').set(auth()).send(corpo)).status).toBe(401);

      emails.length = 0;
      const r = await request(app).put('/api/v1/admin/pagamentos/recebedor').set(await comReauth()).send(corpo);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ finalDocumento: '0181', finalChave: '.com', ativo: false, testadoEm: null });
      expect(JSON.stringify(r.body)).not.toMatch(/11222333|pix@studiobela/);

      const noBanco = await prisma.recebedor.findUniqueOrThrow({ where: { id: 1 } });
      expect(noBanco.documentoCifrado).toMatch(/^v1:/);
      expect(noBanco.chaveCifrada).not.toContain('studiobela');

      // 9.7: auditoria com os campos, nunca os valores
      const log = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'RECEBEDOR_ALTERADO' } });
      expect(JSON.stringify(log.detalhes)).not.toMatch(/studiobela|11222333/);
      // RF36: alerta por e-mail com link "não fui eu"
      expect(emails.find((e) => e.assunto.includes('recebedor'))?.texto).toContain('/seguranca/nao-fui-eu?token=');
    });

    it('recusa chave Pix que não bate com o tipo', async () => {
      const r = await request(app)
        .put('/api/v1/admin/pagamentos/recebedor')
        .set(await comReauth())
        .send({ nome: 'Studio', tipoChave: 'CPF', chave: 'nao-e-cpf', gateway: 'SIMULADO' });
      expect(r.status).toBe(400);
    });

    it('RF37: só ativa depois de testar a conexão', async () => {
      const antes = await request(app).post('/api/v1/admin/pagamentos/recebedor/ativo').set(await comReauth()).send({ ativo: true });
      expect(antes.status).toBe(409);
      const teste = await request(app).post('/api/v1/admin/pagamentos/recebedor/testar').set(auth());
      expect(teste.body.ok).toBe(true);
      const depois = await request(app).post('/api/v1/admin/pagamentos/recebedor/ativo').set(await comReauth()).send({ ativo: true });
      expect(depois.status).toBe(200);
      expect(depois.body.ativo).toBe(true);
    });
  });

  describe('RF29–RF31: cobrança, webhook e expiração', () => {
    let agendamentoId = '';
    let linkGestao = '';

    it('cobra o sinal calculado no servidor e prende o horário', async () => {
      const r = await agendar(dia(4), '10:00', { sinalCentavos: 1, valorCentavos: 1 }); // 9.3: front não manda valor
      expect(r.status).toBe(201);
      expect(r.body.agendamento.status).toBe('AGUARDANDO_PAGAMENTO');
      expect(r.body.agendamento.sinalCentavos).toBe(2700); // 30% de R$ 90
      expect(r.body.pix.copiaECola).toContain('SIMULADO');
      expect(r.body.pix.qrBase64.length).toBeGreaterThan(100);
      agendamentoId = r.body.agendamento.id;
      linkGestao = r.body.linkGestao;

      // RF23: o horário não aparece mais como livre
      const livres = await request(app).get(`/api/v1/public/disponibilidade?servicoId=${servicoId}&data=${dia(4)}`);
      expect(livres.body.profissionais[0].horarios).not.toContain('10:00');

      // O catálogo mostra o sinal antes
      const cat = await request(app).get('/api/v1/public/servicos');
      expect(cat.body[0].profissionais[0].sinalCentavos).toBe(2700);
    });

    it('webhook com assinatura errada ou antigo é recusado (9.3)', async () => {
      const p = await pagamentoDe(agendamentoId);
      const g = await simulado();
      const n = g.notificacaoAssinada(p.gatewayPaymentId!);
      const errada = await request(app)
        .post(`/api/v1/webhooks/pagamentos/simulado?data.id=${p.gatewayPaymentId}`)
        .set({ 'x-signature': n.headers['x-signature']!.replace(/v1=(.)/, (_, c: string) => `v1=${c === '0' ? '1' : '0'}`), 'x-request-id': n.headers['x-request-id']! })
        .send(n.body as object);
      expect(errada.status).toBe(401);

      const antiga = g.notificacaoAssinada(p.gatewayPaymentId!, Date.now() - 10 * 60_000);
      const r = await request(app)
        .post(`/api/v1/webhooks/pagamentos/simulado?data.id=${p.gatewayPaymentId}`)
        .set(antiga.headers as Record<string, string>)
        .send(antiga.body as object);
      expect(r.status).toBe(401);
    });

    it('pagamento menor que o sinal não confirma', async () => {
      const p = await pagamentoDe(agendamentoId);
      const g = await simulado();
      g.pagar(p.gatewayPaymentId!, 100);
      const n = g.notificacaoAssinada(p.gatewayPaymentId!);
      await request(app).post(`/api/v1/webhooks/pagamentos/simulado?data.id=${p.gatewayPaymentId}`).set(n.headers as Record<string, string>).send(n.body as object);
      const a = await prisma.agendamento.findUniqueOrThrow({ where: { id: agendamentoId } });
      expect(a.status).toBe('AGUARDANDO_PAGAMENTO');
    });

    it('RF30: Pix pago → webhook confirma; reenviar o mesmo evento não muda nada', async () => {
      const p = await pagamentoDe(agendamentoId);
      const g = await simulado();
      g.pagar(p.gatewayPaymentId!, 2700);
      const n = g.notificacaoAssinada(p.gatewayPaymentId!);
      const r = await request(app).post(`/api/v1/webhooks/pagamentos/simulado?data.id=${p.gatewayPaymentId}`).set(n.headers as Record<string, string>).send(n.body as object);
      expect(r.status).toBe(200);
      const a = await prisma.agendamento.findUniqueOrThrow({ where: { id: agendamentoId } });
      expect(a.status).toBe('CONFIRMADO');
      expect((await pagamentoDe(agendamentoId)).status).toBe('APROVADO');

      const de = await request(app).post(`/api/v1/webhooks/pagamentos/simulado?data.id=${p.gatewayPaymentId}`).set(n.headers as Record<string, string>).send(n.body as object);
      expect(de.status).toBe(200);
      expect(await prisma.webhookEvento.count({ where: { eventoId: (n.body as { id: string }).id } })).toBe(1);

      const st = await request(app).post('/api/v1/public/agendamentos/status-sinal').send({ token: token(linkGestao) });
      expect(st.body).toEqual({ status: 'CONFIRMADO', sinalStatus: 'APROVADO' });
    });

    it('RF33: o painel mostra quanto falta receber', async () => {
      const r = await request(app).get(`/api/v1/admin/agenda?de=${dia(4)}&ate=${dia(4)}`).set(auth());
      const item = r.body.find((x: { id: string }) => x.id === agendamentoId);
      expect(item.sinal.status).toBe('APROVADO');
      expect(item.restanteCentavos).toBe(6300);
    });

    it('RF32: cliente cancela com antecedência → sinal devolvido', async () => {
      const r = await request(app).post('/api/v1/public/agendamentos/cancelar').send({ token: token(linkGestao) });
      expect(r.status).toBe(200);
      expect(r.body.sinal).toBe('reembolsado');
      expect((await pagamentoDe(agendamentoId)).status).toBe('REEMBOLSADO');
    });

    it('RF31: prazo vencido → expira, libera o horário; Pix pago depois é devolvido sozinho', async () => {
      const r = await agendar(dia(5), '11:00');
      const id = r.body.agendamento.id;
      await prisma.agendamento.update({ where: { id }, data: { expiraSinalEm: new Date(Date.now() - 1000) } });
      expect(await pagamentos.expirarVencidos()).toBe(1);
      expect((await prisma.agendamento.findUniqueOrThrow({ where: { id } })).status).toBe('EXPIRADO');
      expect((await pagamentoDe(id)).status).toBe('CANCELADO');

      // O horário voltou a ficar livre
      const outro = await agendar(dia(5), '11:00');
      expect(outro.status).toBe(201);

      // Fluxo 6.2: cliente pagou mesmo assim
      const p = await pagamentoDe(id);
      const g = await simulado();
      g.pagar(p.gatewayPaymentId!);
      const n = g.notificacaoAssinada(p.gatewayPaymentId!);
      await request(app).post(`/api/v1/webhooks/pagamentos/simulado?data.id=${p.gatewayPaymentId}`).set(n.headers as Record<string, string>).send(n.body as object);
      expect((await prisma.agendamento.findUniqueOrThrow({ where: { id } })).status).toBe('EXPIRADO');
      expect((await pagamentoDe(id)).status).toBe('REEMBOLSADO');
    });

    it('webhook e expiração ao mesmo tempo: só um vence, sem estado quebrado', async () => {
      const r = await agendar(dia(6), '14:00');
      const id = r.body.agendamento.id;
      const p = await pagamentoDe(id);
      const g = await simulado();
      g.pagar(p.gatewayPaymentId!);
      await prisma.agendamento.update({ where: { id }, data: { expiraSinalEm: new Date(Date.now() - 1000) } });
      await Promise.all([pagamentos.expirarVencidos(), pagamentos.processarWebhook('SIMULADO', g.notificacaoAssinada(p.gatewayPaymentId!))]);
      const a = await prisma.agendamento.findUniqueOrThrow({ where: { id } });
      const pg = await pagamentoDe(id);
      if (a.status === 'CONFIRMADO') expect(pg.status).toBe('APROVADO');
      else {
        expect(a.status).toBe('EXPIRADO');
        expect(['REEMBOLSADO', 'RECEBIDO_APOS_EXPIRAR', 'REEMBOLSO_PENDENTE']).toContain(pg.status);
      }
    });

    it('RF32: cancelamento fora do prazo de devolução → empresa retém', async () => {
      await request(app)
        .put('/api/v1/admin/pagamentos/config')
        .set(await comReauth())
        .send({ sinalExige: true, sinalTipo: 'FIXO', sinalValor: 2000, sinalPrazoMin: 30, reembolsoAteHoras: 720, reembolsoAutomaticoAposExpirar: true });
      const r = await agendar(dia(7), '15:00');
      expect(r.body.agendamento.sinalCentavos).toBe(2000);
      await pagamentos.simularPagamento(r.body.agendamento.id);
      const c = await request(app).post('/api/v1/public/agendamentos/cancelar').send({ token: token(r.body.linkGestao) });
      expect(c.body.sinal).toBe('retido');
    });

    it('painel cancela e decide devolver, mesmo fora do prazo', async () => {
      const r = await agendar(dia(8), '15:00');
      await pagamentos.simularPagamento(r.body.agendamento.id);
      const c = await request(app)
        .patch(`/api/v1/admin/agenda/${r.body.agendamento.id}/status`)
        .set(auth())
        .send({ status: 'CANCELADO', reembolsarSinal: true });
      expect(c.status).toBe(200);
      expect(c.body.sinal.status).toBe('REEMBOLSADO');
    });

    it('confirmar na mão (pagou no balcão) cancela o Pix pendente', async () => {
      const r = await agendar(dia(9), '16:00');
      const c = await request(app).patch(`/api/v1/admin/agenda/${r.body.agendamento.id}/status`).set(auth()).send({ status: 'CONFIRMADO' });
      expect(c.status).toBe(200);
      expect(c.body.status).toBe('CONFIRMADO');
      expect((await pagamentoDe(r.body.agendamento.id)).status).toBe('CANCELADO');
    });
  });

  describe('RF27: lembretes', () => {
    it('envia o de 24 h uma vez só, e não para quem agendou em cima da hora', async () => {
      const inicio = DateTime.now().plus({ hours: 20 });
      const servico = await prisma.servico.findUniqueOrThrow({ where: { id: servicoId } });
      const c = await prisma.cliente.create({ data: { nome: 'Lia Lembrete', telefone: '15977776666', email: 'lia@cliente.com' } });
      const base = { clienteId: c.id, funcionarioId, servicoId, status: 'CONFIRMADO' as const, valorCentavos: servico.precoCentavos, duracaoMin: 60, limpezaMin: 0, origem: 'PAINEL' as const };
      await prisma.agendamento.create({
        data: { ...base, inicio: inicio.toJSDate(), fim: inicio.plus({ hours: 1 }).toJSDate(), fimOcupado: inicio.plus({ hours: 1 }).toJSDate(), createdAt: DateTime.now().minus({ days: 3 }).toJSDate() },
      });
      const cedo = inicio.plus({ hours: 2 });
      await prisma.agendamento.create({ data: { ...base, inicio: cedo.toJSDate(), fim: cedo.plus({ hours: 1 }).toJSDate(), fimOcupado: cedo.plus({ hours: 1 }).toJSDate() } });

      emails.length = 0;
      const r1 = await enviarLembretes();
      expect(r1.h24).toBe(1);
      expect(emails.filter((e) => e.para === 'lia@cliente.com')).toHaveLength(1);
      const r2 = await enviarLembretes();
      expect(r2.h24).toBe(0);
    });
  });

  describe('Fluxo 6.5: "não fui eu"', () => {
    it('desativa o recebedor e derruba as sessões de quem alterou', async () => {
      emails.length = 0;
      await request(app)
        .put('/api/v1/admin/pagamentos/recebedor')
        .set(await comReauth())
        .send({ nome: 'Outro Nome', tipoChave: 'EMAIL', gateway: 'SIMULADO' });
      const alerta = emails.find((e) => e.assunto.includes('recebedor'))!;
      const t = alerta.texto.match(/token=([\w-]+)/)![1];
      const r = await request(app).post('/api/v1/public/seguranca/nao-fui-eu').send({ token: t });
      expect(r.status).toBe(204);
      expect((await prisma.recebedor.findUniqueOrThrow({ where: { id: 1 } })).ativo).toBe(false);
      const eu = await request(app).get('/api/v1/admin/pagamentos/recebedor').set(auth());
      expect(eu.status).toBe(401);
      // Link de uso único
      expect((await request(app).post('/api/v1/public/seguranca/nao-fui-eu').send({ token: t })).status).toBe(400);
    });
  });
});
