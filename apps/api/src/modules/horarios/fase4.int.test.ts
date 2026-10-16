import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { app } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { comBanco, limparBanco, loginAdmin, loginFuncionario } from '../../../tests/helpers.js';

const zona = 'America/Sao_Paulo';
const amanha = DateTime.now().setZone(zona).plus({ days: 1 }).toISODate()!;
const todosOsDias = (faixas: { inicio: string; fim: string }[]) => Array.from({ length: 7 }, (_, diaSemana) => ({ diaSemana, faixas }));

describe.skipIf(!comBanco)('Fase 4: horários (RF16–RF20)', () => {
  let admin = '';
  let ana: Awaited<ReturnType<typeof loginFuncionario>>;
  let bia: Awaited<ReturnType<typeof loginFuncionario>>;
  let servicoId = '';
  const auth = () => ({ Authorization: `Bearer ${admin}` });
  const comoAna = () => ({ Authorization: `Bearer ${ana.token}` });

  async function horariosDe(nome: string, data = amanha) {
    const r = await request(app).get(`/api/v1/public/disponibilidade?servicoId=${servicoId}&data=${data}`);
    expect(r.status).toBe(200);
    return r.body.profissionais.find((p: { nome: string }) => p.nome === nome)?.horarios as string[];
  }

  beforeAll(async () => {
    await limparBanco();
    admin = await loginAdmin(app);
    ana = await loginFuncionario(app, 'Ana', 'ana@teste.com');
    bia = await loginFuncionario(app, 'Bia', 'bia@teste.com');
    const s = await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Corte', duracaoMin: 60, precoCentavos: 8000 });
    servicoId = s.body.id;
    await request(app)
      .put(`/api/v1/admin/servicos/${servicoId}/equipe`)
      .set(auth())
      .send([{ funcionarioId: ana.funcionarioId }, { funcionarioId: bia.funcionarioId }]);
  });
  afterAll(async () => {
    await limparBanco();
    await prisma.$disconnect();
  });

  it('RF16: cria modelo e aplica a um funcionário', async () => {
    const m = await request(app)
      .post('/api/v1/admin/horarios/modelos')
      .set(auth())
      .send({ nome: 'Manhã todo dia', semana: todosOsDias([{ inicio: '09:00', fim: '12:00' }]) });
    expect(m.status).toBe(201);

    for (const f of [ana, bia]) {
      const r = await request(app).post(`/api/v1/admin/horarios/funcionarios/${f.funcionarioId}/jornada/aplicar-modelo`).set(auth()).send({ modeloId: m.body.id });
      expect(r.status).toBe(200);
      expect(r.body[1].faixas).toEqual([{ inicio: '09:00', fim: '12:00' }]);
    }
  });

  it('RF20: horários livres seguem a jornada (serviço de 1 h, de 15 em 15 min)', async () => {
    expect(await horariosDe('Ana')).toEqual(['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00']);
  });

  it('RF17: personalizar a jornada não altera o modelo nem os outros', async () => {
    const r = await request(app)
      .put(`/api/v1/admin/horarios/funcionarios/${bia.funcionarioId}/jornada`)
      .set(auth())
      .send({ semana: todosOsDias([{ inicio: '14:00', fim: '16:00' }]) });
    expect(r.status).toBe(200);
    expect(await horariosDe('Bia')).toEqual(['14:00', '14:15', '14:30', '14:45', '15:00']);
    expect((await horariosDe('Ana'))[0]).toBe('09:00');
  });

  it('recusa faixas sobrepostas', async () => {
    const r = await request(app)
      .put(`/api/v1/admin/horarios/funcionarios/${bia.funcionarioId}/jornada`)
      .set(auth())
      .send({ semana: [{ diaSemana: 1, faixas: [{ inicio: '09:00', fim: '12:00' }, { inicio: '11:00', fim: '13:00' }] }] });
    expect(r.status).toBe(400);
  });

  it('RF18: bloqueio tira os horários que encostam nele', async () => {
    const b = await request(app)
      .post('/api/v1/admin/horarios/bloqueios')
      .set(auth())
      .send({ funcionarioId: ana.funcionarioId, inicio: `${amanha}T10:00`, fim: `${amanha}T10:30`, motivo: 'Dentista' });
    expect(b.status).toBe(201);
    expect(await horariosDe('Ana')).toEqual(['09:00', '10:30', '10:45', '11:00']);

    // O motivo nunca aparece na rota pública
    const pub = await request(app).get(`/api/v1/public/disponibilidade?servicoId=${servicoId}&data=${amanha}`);
    expect(JSON.stringify(pub.body)).not.toContain('Dentista');

    await request(app).delete(`/api/v1/admin/horarios/bloqueios/${b.body.id}`).set(auth());
    expect(await horariosDe('Ana')).toHaveLength(9);
  });

  it('RF17: folga de uma pessoa e feriado da equipe toda', async () => {
    const folga = await request(app).post('/api/v1/admin/horarios/excecoes').set(auth()).send({ funcionarioId: ana.funcionarioId, data: amanha, tipo: 'FOLGA' });
    expect(folga.status).toBe(201);
    expect(await horariosDe('Ana')).toEqual([]);
    expect(await horariosDe('Bia')).not.toEqual([]);

    const feriado = await request(app).post('/api/v1/admin/horarios/excecoes').set(auth()).send({ data: amanha, tipo: 'FOLGA', motivo: 'Feriado' });
    expect(await horariosDe('Bia')).toEqual([]);

    await request(app).delete(`/api/v1/admin/horarios/excecoes/${folga.body.id}`).set(auth());
    await request(app).delete(`/api/v1/admin/horarios/excecoes/${feriado.body.id}`).set(auth());
  });

  it('RF17: horário especial substitui a jornada naquele dia', async () => {
    await request(app)
      .post('/api/v1/admin/horarios/excecoes')
      .set(auth())
      .send({ funcionarioId: ana.funcionarioId, data: amanha, tipo: 'HORARIO_ESPECIAL', faixas: [{ inicio: '18:00', fim: '20:00' }] });
    expect(await horariosDe('Ana')).toEqual(['18:00', '18:15', '18:30', '18:45', '19:00']);
  });

  it('RF20: só aceita datas de hoje até 60 dias', async () => {
    const ontem = DateTime.now().setZone(zona).minus({ days: 1 }).toISODate();
    const longe = DateTime.now().setZone(zona).plus({ days: 61 }).toISODate();
    for (const data of [ontem, longe]) {
      const r = await request(app).get(`/api/v1/public/disponibilidade?servicoId=${servicoId}&data=${data}`);
      expect(r.status).toBe(400);
    }
  });

  describe('RF19: funcionário e os próprios horários', () => {
    it('vê os próprios horários, mas só edita se o admin liberar', async () => {
      const ver = await request(app).get('/api/v1/staff/horarios').set(comoAna());
      expect(ver.status).toBe(200);
      expect(ver.body.podeEditar).toBe(false);

      const negado = await request(app).put('/api/v1/staff/horarios/jornada').set(comoAna()).send({ semana: todosOsDias([]) });
      expect(negado.status).toBe(403);

      await request(app).patch(`/api/v1/admin/funcionarios/${ana.funcionarioId}`).set(auth()).send({ podeEditarHorario: true });
      const ok = await request(app)
        .put('/api/v1/staff/horarios/jornada')
        .set(comoAna())
        .send({ semana: todosOsDias([{ inicio: '08:00', fim: '10:00' }]) });
      expect(ok.status).toBe(200);
    });

    it('9.2: não consegue mexer nos horários de outra pessoa', async () => {
      // Tenta criar exceção em nome da Bia: vira exceção da própria Ana
      const r = await request(app).post('/api/v1/staff/horarios/excecoes').set(comoAna()).send({ funcionarioId: bia.funcionarioId, data: amanha, tipo: 'FOLGA' });
      expect(r.status).toBe(201);
      expect(r.body.funcionarioId).toBe(ana.funcionarioId);

      // Tenta apagar um bloqueio da Bia: não encontra (não revela que existe)
      const bloqueioBia = await request(app)
        .post('/api/v1/admin/horarios/bloqueios')
        .set(auth())
        .send({ funcionarioId: bia.funcionarioId, inicio: `${amanha}T14:00`, fim: `${amanha}T15:00` });
      const apagar = await request(app).delete(`/api/v1/staff/horarios/bloqueios/${bloqueioBia.body.id}`).set(comoAna());
      expect(apagar.status).toBe(404);
      expect(await prisma.bloqueio.count({ where: { id: bloqueioBia.body.id } })).toBe(1);

      // E não acessa as rotas de admin de horários
      const admin = await request(app).get('/api/v1/admin/horarios/modelos').set(comoAna());
      expect(admin.status).toBe(403);
    });
  });
});
