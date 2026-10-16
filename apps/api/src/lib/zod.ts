import { z } from 'zod';

// Texto opcional: "" vira null (para o usuário conseguir apagar um campo).
export const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const idSchema = z.string().uuid();
export const idParamSchema = z.object({ id: idSchema });

// Dinheiro sempre em centavos inteiros: R$ 49,90 = 4990. Evita erro de arredondamento.
export const centavos = z.number().int().min(0).max(100_000_000);

// Durações em minutos, múltiplas de 5 (a agenda trabalha em blocos de 5 min)
export const minutos = (min: number, max: number) =>
  z.number().int().min(min).max(max).refine((v) => v % 5 === 0, 'Use múltiplos de 5 minutos');

export const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato HH:MM');
