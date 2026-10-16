import { Router } from 'express';
import { AppError } from '../../lib/AppError.js';
import * as empresa from '../empresa/empresa.service.js';
import * as publico from './publico.service.js';
import { publicada } from '../personalizacao/personalizacao.service.js';
import { disponibilidadePublica } from '../horarios/horarios.routes.js';
import { z } from 'zod';
import { idSchema } from '../../lib/zod.js';
import { diasComHorario } from '../horarios/horarios.service.js';
import { diasLivresLimiter } from '../../middlewares/rateLimit.js';

// Rotas sem login (landing e tela de agendamento)
export const publicoRoutes = Router();

publicoRoutes.get('/empresa', async (_req, res) => {
  const e = await empresa.obter();
  if (!e) throw new AppError('NAO_CONFIGURADA', 'Empresa ainda não configurada', 404);
  res.set('Cache-Control', 'no-cache'); // confere sempre (ETag responde 304 se nada mudou): o que o admin publica aparece na hora
  res.json(empresa.paraPublico(e));
});

// RF07, RF09: visual e textos publicados (o rascunho nunca sai daqui)
publicoRoutes.get('/personalizacao', async (_req, res) => {
  res.set('Cache-Control', 'no-cache'); // confere sempre (ETag responde 304 se nada mudou): o que o admin publica aparece na hora
  res.json(await publicada());
});

// RF09: equipe na landing (só quem aparece no site; sem contato, sem comissão)
publicoRoutes.get('/equipe', async (_req, res) => {
  res.set('Cache-Control', 'no-cache'); // confere sempre (ETag responde 304 se nada mudou): o que o admin publica aparece na hora
  res.json(await publico.equipe());
});

publicoRoutes.get('/servicos', async (_req, res) => {
  res.set('Cache-Control', 'no-cache'); // confere sempre (ETag responde 304 se nada mudou): o que o admin publica aparece na hora
  res.json(await publico.catalogo());
});

// RF20: horários livres para o cliente escolher
// RF20: quais dos próximos dias têm horário livre (a tela já abre no primeiro dia com vaga)
publicoRoutes.get('/dias-livres', diasLivresLimiter, async (req, res) => {
  const q = z.object({ servicoId: idSchema, funcionarioId: idSchema.optional() }).parse(req.query);
  res.set('Cache-Control', 'no-store');
  res.json(await diasComHorario(q));
});

publicoRoutes.get('/disponibilidade', async (req, res) => {
  res.set('Cache-Control', 'no-store'); // muda a cada agendamento
  res.json(await disponibilidadePublica(req));
});
