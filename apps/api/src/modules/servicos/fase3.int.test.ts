import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { comBanco, limparBanco, loginAdmin, loginFuncionario } from '../../../tests/helpers.js';

describe.skipIf(!comBanco)('Fase 3: empresa, serviços e equipe (RF06, RF12, RF13)', () => {
  let admin = '';
  let ana: Awaited<ReturnType<typeof loginFuncionario>>;
  let bia: Awaited<ReturnType<typeof loginFuncionario>>;
  const auth = () => ({ Authorization: `Bearer ${admin}` });

  beforeAll(async () => {
    await limparBanco();
    admin = await loginAdmin(app);
    ana = await loginFuncionario(app, 'Ana', 'ana@teste.com');
    bia = await loginFuncionario(app, 'Bia', 'bia@teste.com');
  });
  afterAll(async () => {
    await limparBanco();
    await prisma.$disconnect();
  });

  describe('RF06: dados da empresa', () => {
    it('recusa CNPJ inválido', async () => {
      const res = await request(app).put('/api/v1/admin/empresa').set(auth()).send({ nome: 'Studio', documento: '11.222.333/0001-82' });
      expect(res.status).toBe(400);
    });

    it('salva, normaliza o documento e ignora campos extras (9.2)', async () => {
      const res = await request(app)
        .put('/api/v1/admin/empresa')
        .set(auth())
        .send({
          nome: 'Studio Bela',
          documento: '11.222.333/0001-81',
          instagram: '@studiobela',
          uf: 'SP',
          horarioFuncionamento: [{ diaSemana: 1, abre: '09:00', fecha: '18:00' }],
          id: 999, // não pode virar outra linha
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(1);
      expect(res.body.documento).toBe('11222333000181');
    });

    it('recusa horário que fecha antes de abrir', async () => {
      const res = await request(app)
        .put('/api/v1/admin/empresa')
        .set(auth())
        .send({ nome: 'Studio Bela', horarioFuncionamento: [{ diaSemana: 1, abre: '18:00', fecha: '09:00' }] });
      expect(res.status).toBe(400);
    });

    it('rota pública mostra CNPJ, mas nunca CPF', async () => {
      const comCnpj = await request(app).get('/api/v1/public/empresa');
      expect(comCnpj.body.cnpj).toBe('11222333000181');

      await request(app).put('/api/v1/admin/empresa').set(auth()).send({ nome: 'Studio Bela', documento: '529.982.247-25' });
      const comCpf = await request(app).get('/api/v1/public/empresa');
      expect(comCpf.status).toBe(200);
      expect(comCpf.body.cnpj).toBeNull();
      expect(JSON.stringify(comCpf.body)).not.toContain('52998224725');
    });

    it('funcionário não edita a empresa (9.2)', async () => {
      const res = await request(app).put('/api/v1/admin/empresa').set('Authorization', `Bearer ${ana.token}`).send({ nome: 'X' });
      expect(res.status).toBe(403);
    });
  });

  describe('RF12: serviços', () => {
    let corteId = '';

    it('cria serviço com categoria', async () => {
      const cat = await request(app).post('/api/v1/admin/servicos/categorias').set(auth()).send({ nome: 'Cabelo' });
      expect(cat.status).toBe(201);

      const res = await request(app)
        .post('/api/v1/admin/servicos')
        .set(auth())
        .send({ nome: 'Corte feminino', categoriaId: cat.body.id, duracaoMin: 60, precoCentavos: 8000, intervaloLimpezaMin: 10 });
      expect(res.status).toBe(201);
      expect(res.body.categoria.nome).toBe('Cabelo');
      corteId = res.body.id;
    });

    it('valida duração em blocos de 5 min e preço inteiro em centavos', async () => {
      const duracao = await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'X', duracaoMin: 7, precoCentavos: 100 });
      expect(duracao.status).toBe(400);
      const preco = await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Y', duracaoMin: 30, precoCentavos: 49.9 });
      expect(preco.status).toBe(400);
    });

    it('não deixa dois serviços com o mesmo nome (sem diferenciar maiúsculas)', async () => {
      const res = await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'CORTE FEMININO', duracaoMin: 30, precoCentavos: 100 });
      expect(res.status).toBe(409);
    });

    it('mudança de preço fica na auditoria com o valor anterior (9.7)', async () => {
      await request(app).patch(`/api/v1/admin/servicos/${corteId}`).set(auth()).send({ precoCentavos: 9000 });
      const log = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'SERVICO_ALTERADO', entidadeId: corteId } });
      expect(log.detalhes).toMatchObject({ preco: { de: 8000, para: 9000 } });
    });

    describe('RF13: equipe do serviço', () => {
      it('define quem executa, com preço próprio opcional', async () => {
        const res = await request(app)
          .put(`/api/v1/admin/servicos/${corteId}/equipe`)
          .set(auth())
          .send([{ funcionarioId: ana.funcionarioId }, { funcionarioId: bia.funcionarioId, precoCentavos: 12000, duracaoMin: 45 }]);
        expect(res.status).toBe(200);
        expect(res.body.equipe).toHaveLength(2);
      });

      it('recusa funcionário inexistente', async () => {
        const res = await request(app)
          .put(`/api/v1/admin/servicos/${corteId}/equipe`)
          .set(auth())
          .send([{ funcionarioId: '00000000-0000-0000-0000-000000000000' }]);
        expect(res.status).toBe(400);
      });

      it('catálogo público usa o preço de cada profissional e não expõe dados internos', async () => {
        const res = await request(app).get('/api/v1/public/servicos');
        const corte = res.body.find((s: { id: string }) => s.id === corteId);
        const porNome = Object.fromEntries(corte.profissionais.map((p: { nome: string }) => [p.nome, p]));
        expect(porNome.Ana).toMatchObject({ precoCentavos: 9000, duracaoMin: 60 });
        expect(porNome.Bia).toMatchObject({ precoCentavos: 12000, duracaoMin: 45 });
        expect(JSON.stringify(res.body)).not.toMatch(/@teste\.com|comissao/);
      });

      it('funcionário desativado some do catálogo', async () => {
        await request(app).patch(`/api/v1/admin/usuarios/${bia.usuarioId}/status`).set(auth()).send({ ativo: false });
        const res = await request(app).get('/api/v1/public/servicos');
        const corte = res.body.find((s: { id: string }) => s.id === corteId);
        expect(corte.profissionais.map((p: { nome: string }) => p.nome)).toEqual(['Ana']);
      });

      it('serviço sem ninguém para executar não aparece para o cliente', async () => {
        const novo = await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Escova', duracaoMin: 30, precoCentavos: 5000 });
        const res = await request(app).get('/api/v1/public/servicos');
        expect(res.body.map((s: { id: string }) => s.id)).not.toContain(novo.body.id);
      });
    });

    it('excluir é lógico: some das listas, mas continua no banco', async () => {
      const del = await request(app).delete(`/api/v1/admin/servicos/${corteId}`).set(auth());
      expect(del.status).toBe(204);
      const lista = await request(app).get('/api/v1/admin/servicos?incluirInativos=true').set(auth());
      expect(lista.body.map((s: { id: string }) => s.id)).not.toContain(corteId);
      expect(await prisma.servico.findUnique({ where: { id: corteId } })).not.toBeNull();
    });
  });

  describe('Equipe', () => {
    it('admin edita comissão e permissão de horário; funcionário não acessa', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/funcionarios/${ana.funcionarioId}`)
        .set(auth())
        .send({ cargo: 'Cabeleireira', comissaoPadraoPct: 12.5, podeEditarHorario: true });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ cargo: 'Cabeleireira', comissaoPadraoPct: 12.5, podeEditarHorario: true });

      const negado = await request(app).get('/api/v1/admin/funcionarios').set('Authorization', `Bearer ${ana.token}`);
      expect(negado.status).toBe(403);
    });

    it('admin que também atende ganha perfil de atendimento', async () => {
      const adminUser = await prisma.usuario.findUniqueOrThrow({ where: { email: 'admin@teste.com' } });
      const res = await request(app).post('/api/v1/admin/funcionarios').set(auth()).send({ usuarioId: adminUser.id });
      expect(res.status).toBe(201);
      const dup = await request(app).post('/api/v1/admin/funcionarios').set(auth()).send({ usuarioId: adminUser.id });
      expect(dup.status).toBe(409);
    });

    it('RF13: cadastra profissional direto, sem login, e ele já pode atender', async () => {
      const res = await request(app)
        .post('/api/v1/admin/funcionarios')
        .set(auth())
        .send({ nome: 'Carla Souza', telefone: '(15) 99999-0000', cargo: 'Manicure' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ nome: 'Carla Souza', telefone: '15999990000', ativo: true, acesso: null });

      const sem = await request(app).post('/api/v1/admin/funcionarios').set(auth()).send({ cargo: 'x' });
      expect(sem.status).toBe(400);

      const servico = await request(app).post('/api/v1/admin/servicos').set(auth()).send({ nome: 'Unha', duracaoMin: 30, precoCentavos: 4000 });
      await request(app).put(`/api/v1/admin/servicos/${servico.body.id}/equipe`).set(auth()).send([{ funcionarioId: res.body.id }]);
      const catalogo = await request(app).get('/api/v1/public/servicos');
      const unha = catalogo.body.find((s: { id: string }) => s.id === servico.body.id);
      expect(unha.profissionais.map((p: { nome: string }) => p.nome)).toEqual(['Carla Souza']);

      // Desativar o profissional tira do site
      await request(app).patch(`/api/v1/admin/funcionarios/${res.body.id}`).set(auth()).send({ ativo: false });
      const depois = await request(app).get('/api/v1/public/servicos');
      expect(depois.body.map((s: { id: string }) => s.id)).not.toContain(servico.body.id);
      await request(app).patch(`/api/v1/admin/funcionarios/${res.body.id}`).set(auth()).send({ ativo: true });
    });

    it('RF02: acesso ao painel é opcional — gera link + mensagem e o login fica vinculado', async () => {
      const f = await request(app).post('/api/v1/admin/funcionarios').set(auth()).send({ nome: 'Duda Lima' });
      const semEmail = await request(app).post(`/api/v1/admin/funcionarios/${f.body.id}/acesso`).set(auth()).send({});
      expect(semEmail.status).toBe(400);

      const acesso = await request(app)
        .post(`/api/v1/admin/funcionarios/${f.body.id}/acesso`)
        .set(auth())
        .send({ email: 'duda@teste.com' });
      expect(acesso.status).toBe(201);
      expect(acesso.body.mensagem).toContain('Duda');
      expect(acesso.body.mensagem).toContain(acesso.body.link);

      const lista = await request(app).get('/api/v1/admin/funcionarios').set(auth());
      expect(lista.body.find((x: { id: string }) => x.id === f.body.id).convitePendente).toBe(true);

      const token = new URL(acesso.body.link).searchParams.get('token');
      const aceitar = await request(app).post('/api/v1/auth/convite/aceitar').send({ token, senha: 'senha-da-duda-123' });
      expect(aceitar.status).toBe(201);
      // Não cria outro profissional: vincula o que já existia
      const vinculado = await prisma.funcionario.findUniqueOrThrow({ where: { id: f.body.id } });
      expect(vinculado.usuarioId).toBe(aceitar.body.id);
      expect(await prisma.funcionario.count({ where: { nome: 'Duda Lima' } })).toBe(1);

      const deNovo = await request(app).post(`/api/v1/admin/funcionarios/${f.body.id}/acesso`).set(auth()).send({ email: 'outro@teste.com' });
      expect(deNovo.status).toBe(409);
    });
  });
});
