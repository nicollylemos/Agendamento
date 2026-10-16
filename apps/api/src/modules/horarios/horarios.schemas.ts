import { z } from 'zod';
import { idSchema, textoOpcional } from '../../lib/zod.js';
import { faixasDoDiaSchema, semanaSchema } from './faixas.js';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
// Data e hora no fuso da empresa, sem fuso no texto: "2026-10-20T14:30"
const dataHora = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Data e hora no formato AAAA-MM-DDTHH:MM');

// RF16
export const modeloSchema = z.object({ nome: z.string().trim().min(2).max(60), semana: semanaSchema });
export const editarModeloSchema = modeloSchema.partial();

// RF17
export const jornadaSchema = z.object({ semana: semanaSchema });
export const aplicarModeloSchema = z.object({ modeloId: idSchema });

export const excecaoSchema = z
  .object({
    funcionarioId: idSchema.nullable().optional(), // vazio = equipe toda (feriado)
    data,
    tipo: z.enum(['FOLGA', 'HORARIO_ESPECIAL']),
    faixas: faixasDoDiaSchema.optional(),
    motivo: textoOpcional(120),
  })
  .refine((e) => e.tipo === 'FOLGA' || (e.faixas && e.faixas.length > 0), {
    message: 'Informe o horário especial desse dia',
    path: ['faixas'],
  });

// RF18
export const bloqueioSchema = z
  .object({ funcionarioId: idSchema, inicio: dataHora, fim: dataHora, motivo: textoOpcional(120) })
  .refine((b) => b.inicio < b.fim, { message: 'O fim precisa ser depois do início', path: ['fim'] });

export const periodoQuery = z
  .object({ de: data, ate: data, funcionarioId: idSchema.optional() })
  .refine((p) => p.de <= p.ate, 'Período inválido');

// RF20
export const disponibilidadeQuery = z.object({ servicoId: idSchema, data, funcionarioId: idSchema.optional() });
