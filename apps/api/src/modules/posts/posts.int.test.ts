import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

const { app } = await import('../../app.js');
const { prisma } = await import('../../lib/prisma.js');
const { comBanco, limparBanco, loginAdmin, loginFuncionario } = await import('../../../tests/helpers.js');

// Posts para o Instagram: conteúdo sempre validado, só gestão mexe
describe.skipIf(!comBanco)('Posts para o Instagram', () => {
  let admin = '';
  let ana: Awaited<ReturnType<typeof loginFuncionario>>;
  let id = '';
  const auth = () => ({ Authorization: `Bearer ${admin}` });
  const conteudo = {
    titulo: 'Corte feminino',
    subtitulo: 'Com lavagem e finalização',
    texto: '1 h',
    destaque: 'R$ 90,00',
    rodape: 'Agende pelo link da bio',
    itens: [],
    imagemUrl: null,
    fundo: 'COR',
    corFundo: '#f4f2ee',
    corTexto: '#26292a',
    corDestaque: '#26292a',
    fonteTitulos: 'instrument',
    fonteTexto: 'instrument',
    mostrarLogo: true,
    alinhamento: 'ESQUERDA',
  };
  const post = (extra: Record<string, unknown> = {}) => ({
    titulo: 'Corte da semana',
    modelo: 'SERVICO',
    formato: 'RETRATO',
    conteudo,
    legenda: 'Corte feminino por R$ 90.',
    status: 'RASCUNHO',
    agendadoPara: '2026-10-20',
    ...extra,
  });

  beforeAll(async () => {
    await limparBanco();
    admin = await loginAdmin(app);
    ana = await loginFuncionario(app, 'Ana', 'ana@teste.com');
  });
  afterAll(async () => {
    await prisma.postInstagram.deleteMany();
    await limparBanco();
    await prisma.$disconnect();
  });

  it('cria, lista, edita e apaga', async () => {
    const r = await request(app).post('/api/v1/admin/posts').set(auth()).send(post());
    expect(r.status).toBe(201);
    id = r.body.id;
    expect(r.body).toMatchObject({ titulo: 'Corte da semana', agendadoPara: '2026-10-20', status: 'RASCUNHO' });

    const e = await request(app).patch(`/api/v1/admin/posts/${id}`).set(auth()).send({ status: 'PRONTO', agendadoPara: null });
    expect(e.body).toMatchObject({ status: 'PRONTO', agendadoPara: null });
    expect((await request(app).get('/api/v1/admin/posts?status=PRONTO').set(auth())).body).toHaveLength(1);
    expect((await request(app).get('/api/v1/admin/posts?status=RASCUNHO').set(auth())).body).toHaveLength(0);
    expect(await prisma.logAuditoria.count({ where: { acao: 'POST_SALVO' } })).toBe(2);
  });

  it('valida o conteúdo: sem tags, só imagem nossa, cores e modelo conhecidos', async () => {
    const tags = await request(app)
      .post('/api/v1/admin/posts')
      .set(auth())
      .send(post({ conteudo: { ...conteudo, titulo: '<script>alert(1)</script>Corte' } }));
    expect(tags.status).toBe(201);
    expect(tags.body.conteudo.titulo).toBe('alert(1)Corte');
    expect((await request(app).post('/api/v1/admin/posts').set(auth()).send(post({ conteudo: { ...conteudo, imagemUrl: 'https://mal.example/x.png' } }))).status).toBe(400);
    expect((await request(app).post('/api/v1/admin/posts').set(auth()).send(post({ conteudo: { ...conteudo, corFundo: 'red' } }))).status).toBe(400);
    expect((await request(app).post('/api/v1/admin/posts').set(auth()).send(post({ modelo: 'QUALQUER' }))).status).toBe(400);
    expect((await request(app).post('/api/v1/admin/posts').set(auth()).send(post({ legenda: 'x'.repeat(2201) }))).status).toBe(400);
  });

  it('profissional não acessa', async () => {
    const h = { Authorization: `Bearer ${ana.token}` };
    expect((await request(app).get('/api/v1/admin/posts').set(h)).status).toBe(403);
    expect((await request(app).post('/api/v1/admin/arquivos?finalidade=POST').set(h).set('Content-Type', 'image/png').send(Buffer.from('x'))).status).toBe(403);
  });

  it('apaga', async () => {
    expect((await request(app).delete(`/api/v1/admin/posts/${id}`).set(auth())).status).toBe(204);
    expect((await request(app).get(`/api/v1/admin/posts/${id}`).set(auth())).status).toBe(404);
  });
});
