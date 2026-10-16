import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';

const emails: { para: string; texto: string }[] = [];
vi.mock('../../lib/mailer.js', () => ({
  enviarEmail: async (para: string, _assunto: string, texto: string) => {
    emails.push({ para, texto });
  },
}));

const { app } = await import('../../app.js');
const { prisma } = await import('../../lib/prisma.js');
const { comBanco, limparBanco, loginAdmin, loginFuncionario } = await import('../../../tests/helpers.js');

const zona = 'America/Sao_Paulo';
const amanha = DateTime.now().setZone(zona).plus({ days: 1 }).toISODate()!;
const depois = DateTime.now().setZone(zona).plus({ days: 2 }).toISODate()!;
const todosOsDias = (inicio: string, fim: string) => Array.from({ length: 7 }, (_, diaSemana) => ({ diaSemana, faixas: [{ inicio, fim }] }));

let contadorTelefone = 0;
const cliente = (extra: Record<string, string> = {}) => ({
  nome: 'Carla Souza',
  telefone: `(15) 9${String(1000_0000 + ++contadorTelefone).slice(-8)}`,
  email: 'carla@cliente.com',
  ...extra,
});

describe.skipIf(!comBanco)('Fase 5: agendamento (RF04, RF21–RF26)', () => {
  let admin = '';
  let ana: Awaited<ReturnType<typeof loginFuncionario>>;
  let bia: Awaited<ReturnType<typeof loginFuncionario>>;
  let servicoId = '';
  const auth = () => ({ Authorization: `Bearer ${admin}` });
  const comoAna = () => ({ Authorization: `Bearer ${ana.token}` });

  const agendar = (corpo: Record<string, unknown>) =>
    request(app)
      .post('/api/v1/public/agendamentos')
      .send({ servicoId, data: amanha, aceitePolitica: true, consentimentoLgpd: true, cliente: cliente(), ...corpo });

  const livres = async (nome: string, data = amanha) => {
    const r = await request(app).get(`/api/v1/public/disponibilidade?servicoId=${servicoId}&data=${data}`);
    return r.body.profissionais.find((p: { nome: string }) => p.nome === nome).horarios as string[];
  };

  beforeAll(async () => {
    await limparBanco();
    admin = await loginAdmin(app);
    ana = await loginFuncionario(app, 'Ana', 'ana@teste.com');
    bia = await loginFuncionario(app, 'Bia', 'bia@teste.com');
    const s = await request(app)
      .post('/api/v1/admin/servicos')
      .set(auth())
      .send({ nome: 'Corte', duracaoMin: 60, precoCentavos: 8000, intervaloLimpezaMin: 10 });
    servicoId = s.body.id;
    await request(app)
      .put(`/api/v1/admin/servicos/${servicoId}/equipe`)
      .set(auth())
      .send([{ funcionarioId: ana.funcionarioId }, { funcionarioId: bia.funcionarioId, precoCentavos: 9500 }]);
    for (const f of [ana, bia]) {
      await request(app).put(`/api/v1/admin/horarios/funcionarios/${f.funcionarioId}/jornada`).set(auth()).send({ semana: todosOsDias('09:00', '18:00') });
    }
    // Prazos curtos para os testes conseguirem cancelar "amanhã"
    await request(app)
      .put('/api/v1/admin/agenda/config')
      .set(auth())
      .send({ antecedenciaMinimaMin: 0, diasAFrente: 60, passoMin: 15, prazoCancelamentoHoras: 1, prazoReagendamentoHoras: 1 });
  });
  afterAll(async () => {
    await limparBanco();
    await prisma.$disconnect();
  });

  describe('RF21, RF23: agendamento pelo site', () => {
    it('agenda, manda e-mail com o link e guarda o preço da época', async () => {
      const r = await agendar({ funcionarioId: bia.funcionarioId, horario: '10:00' });
      expect(r.status).toBe(201);
      expect(r.body.agendamento).toMatchObject({ status: 'CONFIRMADO', valorCentavos: 9500, inicio: `${amanha}T10:00` });
      expect(r.body.linkGestao).toMatch(/\/meu-agendamento\?token=/);
      expect(emails.at(-1)?.texto).toContain('/meu-agendamento?token=');
    });

    it('o horário some da agenda, contando a limpeza', async () => {
      const h = await livres('Bia');
      expect(h).not.toContain('10:00');
      expect(h).not.toContain('09:15'); // terminaria 10:15 + limpeza, por cima do 10:00
      expect(h).not.toContain('11:00'); // o 10:00 só libera às 11:10
      expect(h).toContain('11:15');
      expect(h).not.toContain('09:00'); // 09:00 + 1 h + 10 min de limpeza = 10:10, invade o das 10:00
    });

    it('RNF02: 20 pessoas no mesmo horário ao mesmo tempo, só 1 consegue', async () => {
      const tentativas = await Promise.all(
        Array.from({ length: 20 }, () => agendar({ funcionarioId: ana.funcionarioId, horario: '14:00' })),
      );
      const codigos = tentativas.map((t) => t.status);
      expect(codigos.filter((c) => c === 201)).toHaveLength(1);
      expect(codigos.filter((c) => c === 409)).toHaveLength(19);
      expect(await prisma.agendamento.count({ where: { funcionarioId: ana.funcionarioId, status: 'CONFIRMADO' } })).toBe(1);
    });

    it('"qualquer profissional" escolhe quem estiver livre', async () => {
      // Às 14:00 a Ana está ocupada, então vai para a Bia
      const r = await agendar({ horario: '14:00' });
      expect(r.status).toBe(201);
      expect(r.body.agendamento.profissional.nome).toBe('Bia');
    });

    it('exige aceite da política e do uso de dados (9.6)', async () => {
      const r = await agendar({ funcionarioId: ana.funcionarioId, horario: '16:00', consentimentoLgpd: false });
      expect(r.status).toBe(400);
    });

    it('não aceita horário fora da jornada nem data passada', async () => {
      expect((await agendar({ funcionarioId: ana.funcionarioId, horario: '20:00' })).status).toBe(409);
      const ontem = DateTime.now().setZone(zona).minus({ days: 1 }).toISODate();
      expect((await agendar({ funcionarioId: ana.funcionarioId, horario: '10:00', data: ontem })).status).toBe(400);
    });

    it('cliente que já existe não tem o e-mail trocado pelo site', async () => {
      const tel = '(15) 98888-7777';
      await agendar({ funcionarioId: ana.funcionarioId, horario: '09:00', cliente: cliente({ telefone: tel, email: 'dona@real.com' }) });
      await agendar({ funcionarioId: ana.funcionarioId, horario: '11:00', cliente: cliente({ telefone: tel, nome: 'Outro', email: 'golpe@x.com' }) });
      const c = await prisma.cliente.findUniqueOrThrow({ where: { telefone: '15988887777' } });
      expect(c.email).toBe('dona@real.com');
      expect(c.nome).toBe('Carla Souza');
    });
  });

  describe('RF25: cliente gerencia pelo link', () => {
    let token = '';

    it('consulta, remarca e o horário antigo fica livre', async () => {
      const r = await agendar({ funcionarioId: bia.funcionarioId, horario: '16:00' });
      token = new URL(r.body.linkGestao).searchParams.get('token')!;

      const ver = await request(app).post('/api/v1/public/agendamentos/consultar').send({ token });
      expect(ver.status).toBe(200);
      expect(ver.body).toMatchObject({ podeCancelar: true, podeReagendar: true });

      const rem = await request(app).post('/api/v1/public/agendamentos/reagendar').send({ token, data: depois, horario: '16:00' });
      expect(rem.status).toBe(200);
      expect(rem.body.inicio).toBe(`${depois}T16:00`);
      expect(await livres('Bia')).toContain('16:00');
    });

    it('cancela dentro do prazo, mas não fora dele', async () => {
      await request(app)
        .put('/api/v1/admin/agenda/config')
        .set(auth())
        .send({ antecedenciaMinimaMin: 0, diasAFrente: 60, passoMin: 15, prazoCancelamentoHoras: 72, prazoReagendamentoHoras: 72 });
      const fora = await request(app).post('/api/v1/public/agendamentos/cancelar').send({ token });
      expect(fora.status).toBe(409);
      expect(fora.body.code).toBe('FORA_DO_PRAZO');

      await request(app)
        .put('/api/v1/admin/agenda/config')
        .set(auth())
        .send({ antecedenciaMinimaMin: 0, diasAFrente: 60, passoMin: 15, prazoCancelamentoHoras: 1, prazoReagendamentoHoras: 1 });
      const ok = await request(app).post('/api/v1/public/agendamentos/cancelar').send({ token });
      expect(ok.status).toBe(200);
      expect(ok.body.sinal).toBeNull(); // sem sinal, nada a devolver
      expect(await livres('Bia', depois)).toContain('16:00');
    });

    it('link inválido não revela nada', async () => {
      const r = await request(app).post('/api/v1/public/agendamentos/consultar').send({ token: 'x'.repeat(43) });
      expect(r.status).toBe(404);
    });
  });

  describe('RF24, RF26: agenda da equipe', () => {
    it('admin agenda pelo painel, inclusive encaixe fora da jornada', async () => {
      const normal = await request(app)
        .post('/api/v1/admin/agenda')
        .set(auth())
        .send({ servicoId, funcionarioId: ana.funcionarioId, data: amanha, horario: '15:15', cliente: { nome: 'Balcão', telefone: '1533334444' } });
      expect(normal.status).toBe(201);

      const encaixe = await request(app)
        .post('/api/v1/admin/agenda')
        .set(auth())
        .send({ servicoId, funcionarioId: ana.funcionarioId, data: amanha, horario: '19:00', encaixe: true, cliente: { nome: 'Encaixe', telefone: '1533334445' } });
      expect(encaixe.status).toBe(201);

      // Encaixe nunca passa por cima de outro cliente
      const porCima = await request(app)
        .post('/api/v1/admin/agenda')
        .set(auth())
        .send({ servicoId, funcionarioId: ana.funcionarioId, data: amanha, horario: '14:30', encaixe: true, cliente: { nome: 'Xavier', telefone: '1533334446' } });
      expect(porCima.status).toBe(409);
    });

    it('fluxo de status e regras de transição', async () => {
      // Agendamento que já começou (gravado direto no banco)
      const c = await prisma.cliente.create({ data: { nome: 'Passado', telefone: '1500000001' } });
      const inicio = DateTime.now().minus({ minutes: 20 });
      const a = await prisma.agendamento.create({
        data: {
          clienteId: c.id, funcionarioId: ana.funcionarioId, servicoId,
          inicio: inicio.toJSDate(), fim: inicio.plus({ minutes: 60 }).toJSDate(), fimOcupado: inicio.plus({ minutes: 70 }).toJSDate(),
          valorCentavos: 8000, duracaoMin: 60, limpezaMin: 10, origem: 'PAINEL',
        },
      });
      const status = (s: string) => request(app).patch(`/api/v1/admin/agenda/${a.id}/status`).set(auth()).send({ status: s });

      expect((await status('EM_ATENDIMENTO')).status).toBe(200);
      expect((await status('NAO_COMPARECEU')).status).toBe(409); // em atendimento não vira falta
      expect((await status('CONCLUIDO')).body.status).toBe('CONCLUIDO');
      expect((await status('CANCELADO')).status).toBe(409); // concluído é final
    });

    it('não marca falta antes do horário', async () => {
      const lista = await request(app).get(`/api/v1/admin/agenda?de=${amanha}&ate=${amanha}`).set(auth());
      const futuro = lista.body.find((x: { status: string }) => x.status === 'CONFIRMADO');
      const r = await request(app).patch(`/api/v1/admin/agenda/${futuro.id}/status`).set(auth()).send({ status: 'NAO_COMPARECEU' });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('CEDO_DEMAIS');
    });

    it('9.2 e 9.6: funcionário vê só a própria agenda, com telefone mascarado', async () => {
      const r = await request(app).get(`/api/v1/staff/agenda?de=${amanha}&ate=${amanha}`).set(comoAna());
      expect(r.status).toBe(200);
      expect(r.body.length).toBeGreaterThan(0);
      expect(r.body.every((x: { funcionario: { id: string } }) => x.funcionario.id === ana.funcionarioId)).toBe(true);
      expect(r.body[0].cliente.telefone).toMatch(/•••••-\d{4}$/);
      expect(r.body[0].cliente.email).toBeNull();

      // Tenta mudar um agendamento da Bia
      const daBia = await prisma.agendamento.findFirstOrThrow({ where: { funcionarioId: bia.funcionarioId } });
      const mexer = await request(app).patch(`/api/v1/staff/agenda/${daBia.id}/status`).set(comoAna()).send({ status: 'CANCELADO' });
      expect(mexer.status).toBe(404);

      // E não vê a agenda geral
      expect((await request(app).get(`/api/v1/admin/agenda?de=${amanha}&ate=${amanha}`).set(comoAna())).status).toBe(403);
    });

    it('funcionário agenda só para si mesmo', async () => {
      const r = await request(app)
        .post('/api/v1/staff/agenda')
        .set(comoAna())
        .send({ servicoId, funcionarioId: bia.funcionarioId, data: depois, horario: '09:00', cliente: { nome: 'Amiga', telefone: '1599990000' } });
      expect(r.status).toBe(201);
      expect(r.body.funcionario.id).toBe(ana.funcionarioId);
    });
  });

  describe('Painel: opções e horários livres', () => {
    it('lista quem não aparece no site e ignora a antecedência mínima', async () => {
      await request(app).patch(`/api/v1/admin/funcionarios/${bia.funcionarioId}`).set(auth()).send({ exibirNoSite: false });
      await request(app)
        .put('/api/v1/admin/agenda/config')
        .set(auth())
        .send({ antecedenciaMinimaMin: 7 * 24 * 60, diasAFrente: 60, passoMin: 15, prazoCancelamentoHoras: 1, prazoReagendamentoHoras: 1 });

      const opcoes = await request(app).get('/api/v1/admin/agenda/opcoes').set(auth());
      expect(opcoes.body[0].profissionais.map((p: { nome: string }) => p.nome)).toContain('Bia');

      // No site, com 7 dias de antecedência, amanhã não tem nada; no painel tem
      expect(await livres('Ana')).toEqual([]);
      const painel = await request(app)
        .get(`/api/v1/admin/agenda/horarios-livres?servicoId=${servicoId}&funcionarioId=${ana.funcionarioId}&data=${amanha}`)
        .set(auth());
      expect(painel.body.length).toBeGreaterThan(0);

      // Funcionário: só os próprios horários, mesmo pedindo os de outra pessoa
      const staff = await request(app)
        .get(`/api/v1/staff/agenda/horarios-livres?servicoId=${servicoId}&funcionarioId=${bia.funcionarioId}&data=${amanha}`)
        .set(comoAna());
      expect(staff.body).toEqual(painel.body);

      await request(app).patch(`/api/v1/admin/funcionarios/${bia.funcionarioId}`).set(auth()).send({ exibirNoSite: true });
      await request(app)
        .put('/api/v1/admin/agenda/config')
        .set(auth())
        .send({ antecedenciaMinimaMin: 0, diasAFrente: 60, passoMin: 15, prazoCancelamentoHoras: 1, prazoReagendamentoHoras: 1 });
    });
  });

  describe('RF04: cliente vê os agendamentos com código por e-mail', () => {
    it('pede código, entra e lista; código errado e reuso falham', async () => {
      const pedido = await request(app).post('/api/v1/public/clientes/codigo').send({ email: 'carla@cliente.com' });
      expect(pedido.status).toBe(202);
      const codigo = emails.at(-1)!.texto.match(/\b(\d{6})\b/)![1]!;

      const errado = await request(app).post('/api/v1/public/clientes/entrar').send({ email: 'carla@cliente.com', codigo: codigo === '000000' ? '111111' : '000000' });
      expect(errado.status).toBe(401);

      const ok = await request(app).post('/api/v1/public/clientes/entrar').send({ email: 'carla@cliente.com', codigo });
      expect(ok.status).toBe(200);

      const reuso = await request(app).post('/api/v1/public/clientes/entrar').send({ email: 'carla@cliente.com', codigo });
      expect(reuso.status).toBe(401);

      const lista = await request(app).get('/api/v1/public/clientes/agendamentos').set('Authorization', `Bearer ${ok.body.token}`);
      expect(lista.status).toBe(200);
      expect(lista.body.length).toBeGreaterThan(0);
    });

    it('e-mail sem cadastro recebe a mesma resposta, mas nenhum e-mail sai', async () => {
      const antes = emails.length;
      const r = await request(app).post('/api/v1/public/clientes/codigo').send({ email: 'ninguem@x.com' });
      expect(r.status).toBe(202);
      expect(emails.length).toBe(antes);
    });

    it('5 códigos errados queimam o código, mesmo acertando depois', async () => {
      await request(app).post('/api/v1/public/clientes/codigo').send({ email: 'dona@real.com' });
      const codigo = emails.at(-1)!.texto.match(/\b(\d{6})\b/)![1]!;
      const errado = codigo === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) await request(app).post('/api/v1/public/clientes/entrar').send({ email: 'dona@real.com', codigo: errado });
      const certo = await request(app).post('/api/v1/public/clientes/entrar').send({ email: 'dona@real.com', codigo });
      expect(certo.status).toBe(401);
    });

    it('9.2: não cancela agendamento de outro e-mail', async () => {
      await request(app).post('/api/v1/public/clientes/codigo').send({ email: 'carla@cliente.com' });
      const codigo = emails.at(-1)!.texto.match(/\b(\d{6})\b/)![1]!;
      const { body } = await request(app).post('/api/v1/public/clientes/entrar').send({ email: 'carla@cliente.com', codigo });
      const deOutro = await prisma.agendamento.findFirstOrThrow({ where: { cliente: { email: 'dona@real.com' } } });
      const r = await request(app).post(`/api/v1/public/clientes/agendamentos/${deOutro.id}/cancelar`).set('Authorization', `Bearer ${body.token}`);
      expect(r.status).toBe(404);
    });
  });
});
