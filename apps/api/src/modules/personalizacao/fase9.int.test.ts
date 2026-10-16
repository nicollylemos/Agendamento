import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { DateTime } from 'luxon';

const { app } = await import('../../app.js');
const { prisma } = await import('../../lib/prisma.js');
const { comBanco, limparBanco, loginAdmin, loginFuncionario } = await import('../../../tests/helpers.js');
const { PADRAO } = await import('./personalizacao.schemas.js');

const png = (largura = 400, altura = 300) =>
  sharp({ create: { width: largura, height: altura, channels: 3, background: '#2f6f62' } })
    .png()
    .toBuffer();

describe.skipIf(!comBanco)('Fase 9: personalização, landing e imagens (RF07–RF11, 9.4)', () => {
  let admin = '';
  let ana: Awaited<ReturnType<typeof loginFuncionario>>;
  let logoUrl = '';
  const auth = () => ({ Authorization: `Bearer ${admin}` });
  const enviar = (finalidade: string, corpo: Buffer, tipo = 'image/png', token = admin) =>
    request(app).post(`/api/v1/admin/arquivos?finalidade=${finalidade}`).set({ Authorization: `Bearer ${token}`, 'Content-Type': tipo }).send(corpo);
  const rascunho = (dados: object) => request(app).put('/api/v1/admin/personalizacao/rascunho').set(auth()).send(dados);

  beforeAll(async () => {
    await limparBanco();
    admin = await loginAdmin(app);
    ana = await loginFuncionario(app, 'Ana', 'ana@teste.com');
  });
  afterAll(async () => {
    await limparBanco();
    await prisma.$disconnect();
  });

  describe('9.4: envio de imagens', () => {
    it('reprocessa para WebP, reduz e devolve a URL', async () => {
      const r = await enviar('LOGO', await png(1200, 900));
      expect(r.status).toBe(201);
      expect(r.body.url).toMatch(/^\/api\/v1\/arquivos\/[0-9a-f-]{36}\.webp$/);
      expect(r.body).toMatchObject({ largura: 512, altura: 384 });
      logoUrl = r.body.url;
      const img = await request(app).get(r.body.url).buffer(true).parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
      expect(img.status).toBe(200);
      expect(img.headers['content-type']).toBe('image/webp');
      expect(img.headers['x-content-type-options']).toBe('nosniff');
      expect((await sharp(img.body as Buffer).metadata()).format).toBe('webp');
    });

    it('apaga os metadados (ex.: localização da foto do celular)', async () => {
      const comExif = await sharp(await png(300, 300))
        .jpeg()
        .withExif({ IFD0: { Artist: 'Fulano', Copyright: 'segredo' } })
        .toBuffer();
      expect((await sharp(comExif).metadata()).exif).toBeDefined();
      const r = await enviar('GALERIA', comExif, 'image/jpeg');
      expect(r.status).toBe(201);
      const salvo = await prisma.arquivo.findFirstOrThrow({ where: { url: r.body.url } });
      const { readFile } = await import('node:fs/promises');
      const conteudo = await readFile(`${process.env.UPLOADS_DIR}/${salvo.chave}`);
      expect((await sharp(conteudo).metadata()).exif).toBeUndefined();
    });

    it('recusa o que não é imagem de verdade, SVG e arquivo grande', async () => {
      const falso = Buffer.from('<?php system($_GET["c"]); ?>');
      expect((await enviar('LOGO', falso, 'image/png')).status).toBe(400); // extensão/tipo mentindo
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
      expect((await enviar('LOGO', svg, 'image/svg+xml')).status).toBe(400);
      const grande = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(6 * 1024 * 1024)]);
      expect((await enviar('LOGO', grande, 'image/jpeg')).status).toBe(413);
    });

    it('permissão por tipo de imagem (9.2) e nome de arquivo não deixa sair da pasta', async () => {
      expect((await enviar('LOGO', await png(), 'image/png', ana.token)).status).toBe(403);
      expect((await request(app).post('/api/v1/admin/arquivos?finalidade=LOGO').set('Content-Type', 'image/png').send(await png())).status).toBe(401);
      expect((await request(app).get('/api/v1/arquivos/..%2F..%2Fpackage.json')).status).toBe(404);
      expect((await request(app).get('/api/v1/arquivos/naoexiste.webp')).status).toBe(404);
    });
  });

  describe('RF07, RF08, RF10: personalização', () => {
    it('cor clara demais é recusada (contraste com texto branco, RNF07)', async () => {
      const r = await rascunho({ ...PADRAO, tema: { ...PADRAO.tema, corPrimaria: '#ffee99' } });
      expect(r.status).toBe(400);
    });

    it('só aceita imagem enviada pelo painel e fonte da lista (9.4)', async () => {
      expect((await rascunho({ ...PADRAO, logoUrl: 'https://site-estranho.com/x.png' })).status).toBe(400);
      expect((await rascunho({ ...PADRAO, logoUrl: 'javascript:alert(1)' })).status).toBe(400);
      expect((await rascunho({ ...PADRAO, tema: { ...PADRAO.tema, fonteTitulos: 'Comic Sans' } })).status).toBe(400);
    });

    it('tira HTML dos textos e só publica depois de revisar', async () => {
      const r = await rascunho({
        ...PADRAO,
        logoUrl,
        tema: { corPrimaria: '#7a1f4f', fonteTitulos: 'playfair', fonteTexto: 'nunito' },
        textos: { ...PADRAO.textos, titulo: 'Studio <script>alert(1)</script>Bela', sobre: '<img src=x onerror=alert(1)>Desde 2015' },
      });
      expect(r.status).toBe(200);
      expect(r.body.rascunho.textos.titulo).toBe('Studio alert(1)Bela');
      expect(r.body.rascunho.textos.sobre).toBe('Desde 2015');
      expect(r.body.temAlteracoes).toBe(true);

      // RF08: o site ainda mostra o publicado (padrão)
      expect((await request(app).get('/api/v1/public/personalizacao')).body.tema.corPrimaria).toBe(PADRAO.tema.corPrimaria);
      const pub = await request(app).post('/api/v1/admin/personalizacao/publicar').set(auth());
      expect(pub.body.temAlteracoes).toBe(false);
      const site = await request(app).get('/api/v1/public/personalizacao');
      expect(site.body).toMatchObject({ logoUrl, tema: { corPrimaria: '#7a1f4f' } });
    });

    it('RF10: seção que faltar entra no fim (seções novas do sistema); repetida não', async () => {
      const r = await rascunho({ ...PADRAO, secoes: PADRAO.secoes.slice(1) });
      expect(r.status).toBe(200);
      expect(r.body.rascunho.secoes.at(-1)).toEqual({ id: PADRAO.secoes[0]!.id, visivel: true });
      expect(r.body.rascunho.secoes).toHaveLength(PADRAO.secoes.length);
      const repetida = [...PADRAO.secoes.slice(1), PADRAO.secoes[1]];
      expect((await rascunho({ ...PADRAO, secoes: repetida })).status).toBe(400);
    });

    it('funcionário não mexe na personalização (9.2)', async () => {
      expect((await request(app).get('/api/v1/admin/personalizacao').set({ Authorization: `Bearer ${ana.token}` })).status).toBe(403);
    });
  });

  describe('RF07, RF09, RF12: campos extras, fotos e ordem', () => {
    let servicoId = '';

    beforeAll(async () => {
      const s = await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Corte', duracaoMin: 60, precoCentavos: 9000 });
      servicoId = s.body.id;
      await request(app).put(`/api/v1/admin/servicos/${servicoId}/equipe`).set(auth()).send([{ funcionarioId: ana.funcionarioId }]);
      await request(app)
        .put(`/api/v1/admin/horarios/funcionarios/${ana.funcionarioId}/jornada`)
        .set(auth())
        .send({ semana: Array.from({ length: 7 }, (_, diaSemana) => ({ diaSemana, faixas: [{ inicio: '08:00', fim: '20:00' }] })) });
      await request(app)
        .put('/api/v1/admin/agenda/config')
        .set(auth())
        .send({ antecedenciaMinimaMin: 0, diasAFrente: 60, passoMin: 15, prazoCancelamentoHoras: 1, prazoReagendamentoHoras: 1 });
      const atual = (await request(app).get('/api/v1/admin/personalizacao').set(auth())).body.rascunho;
      await rascunho({
        ...atual,
        camposExtras: [
          { id: 'alergia', rotulo: 'Tem alergia a algum produto?', tipo: 'TEXTO', obrigatorio: true },
          { id: 'primeira-vez', rotulo: 'É a primeira vez aqui?', tipo: 'SIM_NAO', obrigatorio: false },
        ],
      });
      await request(app).post('/api/v1/admin/personalizacao/publicar').set(auth());
    });

    const agendar = (horario: string, respostasExtras?: Record<string, unknown>) =>
      request(app)
        .post('/api/v1/public/agendamentos')
        .send({
          servicoId,
          data: DateTime.now().setZone('America/Sao_Paulo').plus({ days: 2 }).toISODate(),
          horario,
          aceitePolitica: true,
          consentimentoLgpd: true,
          cliente: { nome: 'Carla Souza', telefone: '(15) 99999-1234', email: 'carla@cliente.com' },
          ...(respostasExtras && { respostasExtras }),
        });

    it('pergunta obrigatória sem resposta é recusada; respostas chegam na agenda', async () => {
      expect((await agendar('09:00')).status).toBe(400);
      const r = await agendar('09:00', { alergia: 'Amônia', 'primeira-vez': true, inventada: 'ignorar' });
      expect(r.status).toBe(201);
      const salvo = await prisma.agendamento.findUniqueOrThrow({ where: { id: r.body.agendamento.id } });
      expect(salvo.respostasExtras).toEqual([
        { rotulo: 'Tem alergia a algum produto?', resposta: 'Amônia' },
        { rotulo: 'É a primeira vez aqui?', resposta: 'Sim' },
      ]);
    });

    it('foto do serviço só aceita imagem do painel; ordem muda o catálogo', async () => {
      expect((await request(app).patch(`/api/v1/admin/servicos/${servicoId}`).set(auth()).send({ fotoUrl: 'https://x.com/a.jpg' })).status).toBe(400);
      const foto = await enviar('SERVICO', await png(1600, 1600));
      expect((await request(app).patch(`/api/v1/admin/servicos/${servicoId}`).set(auth()).send({ fotoUrl: foto.body.url })).status).toBe(200);
      const outro = await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Escova', duracaoMin: 30, precoCentavos: 5000 });
      await request(app).put(`/api/v1/admin/servicos/${outro.body.id}/equipe`).set(auth()).send([{ funcionarioId: ana.funcionarioId }]);
      await request(app).put('/api/v1/admin/servicos/ordem').set(auth()).send({ ids: [outro.body.id, servicoId] });
      const cat = await request(app).get('/api/v1/public/servicos');
      expect(cat.body.map((s: { nome: string }) => s.nome)).toEqual(['Escova', 'Corte']);
      expect(cat.body[1].fotoUrl).toBe(foto.body.url);
    });

    it('equipe pública sem dados de contato', async () => {
      const r = await request(app).get('/api/v1/public/equipe');
      expect(r.body).toEqual([{ id: ana.funcionarioId, nome: 'Ana', cargo: null, bio: null, fotoUrl: null }]);
    });
  });
});
