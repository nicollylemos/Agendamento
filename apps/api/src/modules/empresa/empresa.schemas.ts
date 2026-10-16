import { z } from 'zod';
import { hora, textoOpcional } from '../../lib/zod.js';
import { documentoValido, normalizarDocumento } from '../../lib/documento.js';

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'] as const;

const telefone = textoOpcional(20).refine((v) => !v || /^[\d\s()+-]{8,20}$/.test(v), 'Telefone inválido');
const url = textoOpcional(255).refine((v) => !v || /^https:\/\/[^\s]+$/.test(v), 'Use um link começando com https://');
const usuarioRede = textoOpcional(60).refine((v) => !v || /^@?[\w.]+$/.test(v), 'Informe só o @usuário');

const diaFuncionamento = z
  .object({ diaSemana: z.number().int().min(0).max(6), abre: hora, fecha: hora })
  .refine((d) => d.abre < d.fecha, 'O horário de abertura precisa ser antes do fechamento');

// RF06. Campos fora daqui são descartados (9.2, mass assignment).
export const empresaSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  documento: textoOpcional(20)
    .refine((v) => !v || documentoValido(v), 'CPF ou CNPJ inválido')
    .transform((v) => (v ? normalizarDocumento(v) : v)),
  email: textoOpcional(254).refine((v) => !v || z.string().email().safeParse(v).success, 'E-mail inválido'),
  telefone,
  whatsapp: telefone,
  instagram: usuarioRede,
  facebook: url,
  site: url,
  cep: textoOpcional(9).refine((v) => !v || /^\d{5}-?\d{3}$/.test(v), 'CEP inválido'),
  logradouro: textoOpcional(160),
  numero: textoOpcional(20),
  complemento: textoOpcional(80),
  bairro: textoOpcional(80),
  cidade: textoOpcional(80),
  uf: z.enum(UFS).nullable().optional(),
  horarioFuncionamento: z
    .array(diaFuncionamento)
    .max(7)
    .refine((dias) => new Set(dias.map((d) => d.diaSemana)).size === dias.length, 'Dia da semana repetido')
    .optional(),
  politicaCancelamento: textoOpcional(2000),
  politicaAtraso: textoOpcional(2000),
});

export type EmpresaInput = z.infer<typeof empresaSchema>;
