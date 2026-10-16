import { z } from 'zod';
import { idSchema, textoOpcional } from '../../lib/zod.js';
import { consumoSchema } from '../estoque/estoque.schemas.js';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const horario = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário no formato HH:MM');

// Telefone brasileiro com DDD: 10 ou 11 dígitos (aceita +55 na frente)
export const telefoneSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''))
  .refine((v) => /^\d{10,11}$/.test(v), 'Telefone com DDD, ex.: (15) 99999-0000');

const email = z.string().trim().toLowerCase().email().max(254);

const clienteSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  telefone: telefoneSchema,
  email: email.optional().nullable().or(z.literal('').transform(() => null)),
});

// RF21, RF23: agendamento pelo site
export const agendamentoOnlineSchema = z.object({
  servicoId: idSchema,
  funcionarioId: idSchema.nullable().optional(), // vazio = "qualquer profissional"
  data,
  horario,
  cliente: clienteSchema.extend({ email }), // online o e-mail é obrigatório (confirmação e RF04)
  observacao: textoOpcional(500),
  // 9.6: aceite da política e consentimento LGPD precisam ser explícitos
  aceitePolitica: z.literal(true, { errorMap: () => ({ message: 'É preciso aceitar a política de agendamento' }) }),
  consentimentoLgpd: z.literal(true, { errorMap: () => ({ message: 'É preciso concordar com o uso dos dados' }) }),
  // RF07: respostas das perguntas extras (conferidas contra o que está publicado)
  respostasExtras: z.record(z.string().max(30), z.union([z.string().max(300), z.boolean()])).optional(),
});

// RF24: agendamento manual (balcão, WhatsApp)
export const agendamentoPainelSchema = z.object({
  servicoId: idSchema,
  funcionarioId: idSchema,
  data,
  horario,
  cliente: clienteSchema,
  observacao: textoOpcional(500),
  encaixe: z.boolean().optional(), // permite fora da jornada (nunca por cima de outro cliente)
});

export const agendaQuery = z
  .object({ de: data, ate: data, funcionarioId: idSchema.optional() })
  .refine((p) => p.de <= p.ate, 'Período inválido')
  // Visão de mês mostra até 6 semanas; mais que isso é relatório (9.5)
  .refine((p) => (Date.parse(p.ate) - Date.parse(p.de)) / 86_400_000 <= 62, 'Escolha um período de até 62 dias');

export const mudarStatusSchema = z.object({
  // CONFIRMADO aqui = confirmar na mão um agendamento que aguardava o sinal (pagou no balcão)
  status: z.enum(['CONFIRMADO', 'EM_ATENDIMENTO', 'CONCLUIDO', 'NAO_COMPARECEU', 'CANCELADO']),
  motivo: textoOpcional(200),
  // RF32: ao cancelar pelo painel, a gestão decide se devolve o sinal (sem isso, vale a política)
  reembolsarSinal: z.boolean().optional(),
  // RF40: ao concluir, o que foi gasto de verdade (sem isso, vale a ficha técnica)
  consumo: consumoSchema.optional(),
  // RF47: como o cliente pagou o restante (só ao concluir)
  formaPagamento: z.enum(['PIX', 'DINHEIRO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'OUTRO']).optional(),
});

export const reagendarPainelSchema = z.object({
  data,
  horario,
  funcionarioId: idSchema.optional(),
  encaixe: z.boolean().optional(),
});

// RF25: link de gestão do cliente (o token vai no corpo, nunca na URL: URLs vão para logs)
const tokenGestao = z.string().min(20).max(200);
export const tokenGestaoSchema = z.object({ token: tokenGestao });
export const simularPixSchema = z.object({ token: tokenGestao });
export const cancelarClienteSchema = z.object({ token: tokenGestao, motivo: textoOpcional(200) });
export const reagendarClienteSchema = z.object({ token: tokenGestao, data, horario });

export const horariosPainelQuery = z.object({
  servicoId: idSchema,
  funcionarioId: idSchema,
  data,
  ignorarAgendamentoId: idSchema.optional(),
});
