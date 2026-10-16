import { z } from 'zod';
import { DateTime } from 'luxon';
import { idSchema } from '../../lib/zod.js';

export const TIPOS = ['faturamento', 'sinais', 'ocupacao', 'servicos', 'estoque', 'clientes', 'fidelidade', 'comissoes'] as const;
export type TipoRelatorio = (typeof TIPOS)[number];

// O profissional só vê os relatórios da própria produção (9.2)
export const TIPOS_PROPRIOS: readonly TipoRelatorio[] = ['faturamento', 'ocupacao', 'comissoes'];

export const MAX_DIAS = 366;

const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD')
  .refine((v) => DateTime.fromISO(v).isValid, 'Data inválida');

export const tipoParam = z.object({ tipo: z.enum(TIPOS) });

export const relatorioQuery = z
  .object({
    de: data,
    ate: data,
    funcionarioId: idSchema.optional(),
  })
  .refine((q) => q.de <= q.ate, { message: 'A data inicial é depois da final', path: ['ate'] })
  // Período limitado: evita consulta gigante (9.5)
  .refine((q) => DateTime.fromISO(q.ate).diff(DateTime.fromISO(q.de), 'days').days < MAX_DIAS, {
    message: `Escolha um período de até ${MAX_DIAS} dias`,
    path: ['ate'],
  });

export type Filtro = z.infer<typeof relatorioQuery>;

// RF55
export const exportarQuery = z.object({ formato: z.enum(['csv', 'pdf']) });
