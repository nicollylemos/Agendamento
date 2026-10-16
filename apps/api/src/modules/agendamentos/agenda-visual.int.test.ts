import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../lib/mailer.js', () => ({ enviarEmail: async () => undefined }));

const { app } = await import('../../app.js');
const { prisma } = await import('../../lib/prisma.js');
const { comBanco, limparBanco, loginAdmin, loginFuncionario } = await import('../../../tests/helpers.js');
const { PADRAO } = await import('../personalizacao/personalizacao.schemas.js');

// Ajustes de 14/10: agenda em Mês/Semana/Dia com cores por situação, meta do mês,
// site que atualiza na hora e profissional novo entrando em todos os serviços.
describe.skipIf(!comBanco)('Agenda visual, meta e correções do site', () => {
  let admin = '';
  let ana: Awaited<ReturnType<typeof loginFuncionario>>;
  const auth = () => ({ Authorization: `Bearer ${admin}` });

  beforeAll(async () => {
    await limparBanco();
    admin = await loginAdmin(app);
    ana = await loginFuncionario(app, 'Ana', 'ana@teste.com');
  });
  afterAll(async () => {
    await limparBanco();
    await prisma.$disconnect();
  });

  describe('Cores da agenda', () => {
    it('vem com as cores padrão; o admin troca e valida o formato', async () => {
      const r = await request(app).get('/api/v1/admin/agenda/visual').set(auth());
      expect(r.status).toBe(200);
      expect(Object.keys(r.body.cores)).toEqual(['AGUARDANDO', 'SINAL_PAGO', 'CONFIRMADO', 'EM_ATENDIMENTO', 'CONCLUIDO', 'FALTA', 'CANCELADO']);
      const novas = { ...r.body.cores, SINAL_PAGO: '#00AA55' };
      const s = await request(app).put('/api/v1/admin/agenda/cores').set(auth()).send(novas);
      expect(s.status).toBe(200);
      expect(s.body.cores.SINAL_PAGO).toBe('#00aa55');
      expect((await request(app).put('/api/v1/admin/agenda/cores').set(auth()).send({ ...novas, FALTA: 'red' })).status).toBe(400);
      expect((await request(app).put('/api/v1/admin/agenda/cores').set(auth()).send({ FALTA: '#ff0000' })).status).toBe(400); // todas as situações
    });

    it('profissional vê as cores (sem a meta) e não muda nada', async () => {
      const r = await request(app).get('/api/v1/staff/agenda/visual').set({ Authorization: `Bearer ${ana.token}` });
      expect(r.status).toBe(200);
      expect(r.body.cores.SINAL_PAGO).toBe('#00aa55');
      expect(r.body.metaMensalCentavos).toBeNull();
      expect((await request(app).put('/api/v1/admin/agenda/cores').set({ Authorization: `Bearer ${ana.token}` }).send(r.body.cores)).status).toBe(403);
    });
  });

  it('meta do mês: só a gestão define, valor positivo', async () => {
    expect((await request(app).put('/api/v1/admin/agenda/meta').set(auth()).send({ metaMensalCentavos: -5 })).status).toBe(400);
    const r = await request(app).put('/api/v1/admin/agenda/meta').set(auth()).send({ metaMensalCentavos: 2_000_000 });
    expect(r.body.metaMensalCentavos).toBe(2_000_000);
    expect((await request(app).put('/api/v1/admin/agenda/meta').set({ Authorization: `Bearer ${ana.token}` }).send({ metaMensalCentavos: 1000 })).status).toBe(403);
    expect((await request(app).put('/api/v1/admin/agenda/meta').set(auth()).send({ metaMensalCentavos: null })).body.metaMensalCentavos).toBeNull();
  });

  it('agenda aceita até 62 dias por consulta (visão de mês = 6 semanas)', async () => {
    expect((await request(app).get('/api/v1/admin/agenda?de=2026-09-27&ate=2026-11-07').set(auth())).status).toBe(200);
    expect((await request(app).get('/api/v1/admin/agenda?de=2026-01-01&ate=2026-12-31').set(auth())).status).toBe(400);
  });

  it('profissional novo pode entrar em todos os serviços e o serviço já aparece no site', async () => {
    await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Corte', duracaoMin: 60, precoCentavos: 9000 });
    await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Escova', duracaoMin: 30, precoCentavos: 5000 });
    expect((await request(app).get('/api/v1/public/servicos')).body).toHaveLength(0);
    const r = await request(app).post('/api/v1/admin/funcionarios').set(auth()).send({ nome: 'Bia', fazTodosServicos: true });
    expect(r.status).toBe(201);
    const site = await request(app).get('/api/v1/public/servicos');
    expect(site.body.map((s: { nome: string }) => s.nome).sort()).toEqual(['Corte', 'Escova']);
    // O navegador confere sempre (sem guardar cópia velha por 60 s)
    expect(site.headers['cache-control']).toBe('no-cache');
  });

  it('site publicado: uma parte inválida volta ao padrão sem derrubar o resto', async () => {
    const publicado = { ...PADRAO, textos: { ...PADRAO.textos, titulo: 'Studio da Nicolly' }, tema: { ...PADRAO.tema, fonteTitulos: 'fonte-que-nao-existe' } };
    await prisma.personalizacao.upsert({ where: { id: 1 }, create: { id: 1, rascunho: publicado, publicado }, update: { publicado } });
    const r = await request(app).get('/api/v1/public/personalizacao');
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.body.textos.titulo).toBe('Studio da Nicolly'); // antes voltava tudo ao padrão
    expect(r.body.tema).toEqual(PADRAO.tema);
  });
});
