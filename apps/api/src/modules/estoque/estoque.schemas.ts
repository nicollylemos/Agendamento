import { z } from 'zod';
import { centavos, idSchema, textoOpcional } from '../../lib/zod.js';

// Quantidade com até 3 casas (ex.: 12,5 ml). Comparação tolerante a erro de ponto flutuante.
export const quantidade = (min = 0) =>
  z
    .number()
    .min(min)
    .max(10_000_000)
    .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'Use no máximo 3 casas decimais');

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');

// RF38
const campos = {
  nome: z.string().trim().min(2).max(120),
  sku: textoOpcional(60),
  categoria: textoOpcional(60),
  unidade: z.enum(['ML', 'G', 'UN']),
  estoqueMinimo: quantidade().optional(),
  fornecedor: textoOpcional(120),
  validade: data.nullable().optional(),
  ativo: z.boolean().optional(),
};

export const criarProdutoSchema = z.object({
  ...campos,
  // Opcional: já lança a primeira compra (vira uma ENTRADA no histórico)
  estoqueInicial: quantidade().optional(),
  custoTotalInicialCentavos: centavos.optional(),
});
// A unidade não muda depois de criado (mudaria o sentido de todo o histórico)
export const editarProdutoSchema = z.object(campos).omit({ unidade: true }).partial();

// RF39
export const movimentoSchema = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('ENTRADA'),
    produtoId: idSchema,
    quantidade: quantidade(0.001),
    custoTotalCentavos: centavos, // quanto pagou pelo lote inteiro (RF42)
    validade: data.nullable().optional(), // lote novo pode trazer validade nova
    motivo: textoOpcional(200),
  }),
  z.object({ tipo: z.literal('SAIDA'), produtoId: idSchema, quantidade: quantidade(0.001), motivo: z.string().trim().min(3).max(200) }),
  z.object({ tipo: z.literal('PERDA'), produtoId: idSchema, quantidade: quantidade(0.001), motivo: z.string().trim().min(3).max(200) }),
  // Inventário: informa quanto contou; o sistema calcula a diferença
  z.object({ tipo: z.literal('AJUSTE'), produtoId: idSchema, saldoContado: quantidade(), motivo: z.string().trim().min(3).max(200) }),
]);

export const listarProdutosQuery = z.object({
  busca: z.string().trim().max(60).optional(),
  alertas: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  incluirInativos: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

// RF14
export const fichaSchema = z.object({
  itens: z
    .array(z.object({ produtoId: idSchema, quantidade: quantidade(0.001) }))
    .max(50)
    .refine((l) => new Set(l.map((i) => i.produtoId)).size === l.length, 'Produto repetido'),
  extras: z.array(z.object({ descricao: z.string().trim().min(2).max(80), valorCentavos: centavos })).max(20),
});

// RF40: o que foi gasto de verdade (se não vier, usa a ficha técnica)
export const consumoSchema = z
  .array(z.object({ produtoId: idSchema, quantidade: quantidade() }))
  .max(50)
  .refine((l) => new Set(l.map((i) => i.produtoId)).size === l.length, 'Produto repetido');
