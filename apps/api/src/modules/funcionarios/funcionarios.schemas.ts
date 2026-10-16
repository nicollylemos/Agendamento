import { z } from 'zod';
import { idSchema, textoOpcional } from '../../lib/zod.js';
import { ehUrlDeArquivo } from '../../lib/armazenamento.js';

// Telefone opcional com DDD (10 ou 11 dígitos). "" apaga.
const telefone = z
  .string()
  .transform((v) => v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''))
  .refine((v) => v === '' || /^\d{10,11}$/.test(v), 'Telefone com DDD, ex.: (15) 99999-0000')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => v === '' || z.string().email().safeParse(v).success, 'E-mail inválido')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const campos = {
  telefone,
  email,
  cargo: textoOpcional(80),
  bio: textoOpcional(1000),
  comissaoPadraoPct: z.number().min(0).max(100).multipleOf(0.01).optional(), // RF54
  podeEditarHorario: z.boolean().optional(), // RF19
  exibirNoSite: z.boolean().optional(),
  ordem: z.number().int().min(0).max(9999).optional(),
  fotoUrl: z.string().max(300).refine(ehUrlDeArquivo, 'Imagem inválida: envie pelo próprio painel').nullable().optional(), // RF09
};

const nome = z.string().trim().min(2).max(120);

// RF13: o profissional é cadastrado direto, sem precisar de login.
// usuarioId é opcional: serve para vincular alguém que já tem conta (ex.: o próprio admin que atende).
export const criarFuncionarioSchema = z
  .object({
    nome: nome.optional(),
    usuarioId: idSchema.optional(),
    // RF13: já entra em todos os serviços cadastrados (senão o serviço não aparece no site até alguém marcar)
    fazTodosServicos: z.boolean().optional(),
    ...campos,
  })
  .refine((d) => d.nome || d.usuarioId, { message: 'Informe o nome', path: ['nome'] });

export const editarFuncionarioSchema = z.object({ nome: nome.optional(), ativo: z.boolean().optional(), ...campos });

// RF02: acesso ao painel é opcional e vem depois do cadastro
export const darAcessoSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  perfil: z.enum(['GERENTE', 'FUNCIONARIO']).default('FUNCIONARIO'),
});
