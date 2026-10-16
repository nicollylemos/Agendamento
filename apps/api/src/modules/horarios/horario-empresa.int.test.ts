import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';

const { app } = await import('../../app.js');
const { prisma } = await import('../../lib/prisma.js');
const { comBanco, limparBanco, loginAdmin } = await import('../../../tests/helpers.js');

// RF20: profissional sem jornada usa o horário de funcionamento da empresa; a tela do
// cliente sabe quais dias têm vaga; o Início avisa quem está sem horário nenhum.
describe.skipIf(!comBanco)('Horários: jornada ou horário da empresa', () => {
  let admin = '';
  let servicoId = '';
  const auth = () => ({ Authorization: `Bearer ${admin}` });
  const amanha = DateTime.now().setZone('America/Sao_Paulo').plus({ days: 1 });

  beforeAll(async () => {
    await limparBanco();
    admin = await loginAdmin(app);
    servicoId = (await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Corte', duracaoMin: 60, precoCentavos: 9000 })).body.id;
    await request(app).post('/api/v1/admin/funcionarios').set(auth()).send({ nome: 'Bia', fazTodosServicos: true });
  });
  afterAll(async () => {
    await limparBanco();
    await prisma.$disconnect();
  });

  it('sem jornada e sem horário da empresa: nenhum dia com vaga, e o Início avisa', async () => {
    const dias = await request(app).get(`/api/v1/public/dias-livres?servicoId=${servicoId}`);
    expect(dias.status).toBe(200);
    expect(dias.body.every((d: { livres: number }) => d.livres === 0)).toBe(true);
    const diag = await request(app).get('/api/v1/admin/horarios/diagnostico').set(auth());
    expect(diag.body).toEqual({ empresaTemHorario: false, semJornada: ['Bia'], semHorarioNenhum: ['Bia'] });
  });

  it('com o horário de funcionamento da empresa, quem não tem jornada passa a ter vagas', async () => {
    await prisma.empresa.upsert({
      where: { id: 1 },
      create: { id: 1, nome: 'Studio', horarioFuncionamento: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ diaSemana: d, abre: '09:00', fecha: '18:00' })) },
      update: { horarioFuncionamento: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ diaSemana: d, abre: '09:00', fecha: '18:00' })) },
    });
    const disp = await request(app).get(`/api/v1/public/disponibilidade?servicoId=${servicoId}&data=${amanha.toISODate()}`);
    expect(disp.body.profissionais[0].horarios[0]).toBe('09:00');
    expect(disp.body.profissionais[0].horarios.at(-1)).toBe('17:00');
    const dias = await request(app).get(`/api/v1/public/dias-livres?servicoId=${servicoId}`);
    expect(dias.body.find((d: { data: string }) => d.data === amanha.toISODate()).livres).toBeGreaterThan(0);
    expect((await request(app).get('/api/v1/admin/horarios/diagnostico').set(auth())).body.semHorarioNenhum).toEqual([]);
  });

  it('a jornada do profissional, quando existe, vale mais que o horário da empresa', async () => {
    const f = await prisma.funcionario.findFirstOrThrow({ where: { nome: 'Bia' } });
    await request(app)
      .put(`/api/v1/admin/horarios/funcionarios/${f.id}/jornada`)
      .set(auth())
      .send({ semana: [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, faixas: [{ inicio: '14:00', fim: '16:00' }] })) });
    const disp = await request(app).get(`/api/v1/public/disponibilidade?servicoId=${servicoId}&data=${amanha.toISODate()}`);
    expect(disp.body.profissionais[0].horarios[0]).toBe('14:00');
    expect(disp.body.profissionais[0].horarios.at(-1)).toBe('15:00');
  });

  it('valida o serviço', async () => {
    expect((await request(app).get('/api/v1/public/dias-livres?servicoId=nao-e-uuid')).status).toBe(400);
  });
});
