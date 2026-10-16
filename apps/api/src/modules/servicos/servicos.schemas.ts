import { z } from 'zod';
import { centavos, idSchema, minutos, textoOpcional } from '../../lib/zod.js';
import { ehUrlDeArquivo } from '../../lib/armazenamento.js';

const urlArquivo = z.string().max(300).refine(ehUrlDeArquivo, 'Imagem inválida: envie pelo próprio painel');

// RF07: ordem dos serviços no site e na tela de agendamento
export const ordemServicosSchema = z.object({ ids: z.array(idSchema).min(1).max(500) });

// RF12
const campos = {
  nome: z.string().trim().min(2).max(120),
  categoriaId: idSchema.nullable().optional(),
  descricao: textoOpcional(2000),
  duracaoMin: minutos(5, 600),
  precoCentavos: centavos,
  intervaloLimpezaMin: minutos(0, 120).optional(),
  ativo: z.boolean().optional(),
  ordem: z.number().int().min(0).max(9999).optional(),
  fotoUrl: urlArquivo.nullable().optional(), // RF12: só imagem enviada pelo painel (9.4)
};

export const criarServicoSchema = z.object(campos);
export const editarServicoSchema = z.object(campos).partial();

// RF13: lista completa de quem executa o serviço (substitui a anterior)
export const definirEquipeSchema = z
  .array(
    z.object({
      funcionarioId: idSchema,
      precoCentavos: centavos.nullable().optional(), // null = preço do serviço
      duracaoMin: minutos(5, 600).nullable().optional(), // null = duração do serviço
      comissaoPct: z.number().min(0).max(100).multipleOf(0.01).nullable().optional(), // RF54: null = padrão do profissional
    }),
  )
  .max(200)
  .refine((l) => new Set(l.map((i) => i.funcionarioId)).size === l.length, 'Funcionário repetido');

export const listarServicosQuery = z.object({
  incluirInativos: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export const categoriaSchema = z.object({
  nome: z.string().trim().min(2).max(60),
  ordem: z.number().int().min(0).max(9999).optional(),
});
export const editarCategoriaSchema = categoriaSchema.partial();
