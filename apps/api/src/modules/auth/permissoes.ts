import type { Perfil } from '@prisma/client';

// Seção 9.2: RBAC com permissões finas.
// A checagem é SEMPRE no backend; o front só usa isso para esconder botões.
export const PERMISSOES = [
  'usuarios:gerenciar',
  'equipe:gerenciar',
  'agenda:ver_todas',
  'agenda:gerenciar',
  'agenda:ver_propria',
  'agenda:gerenciar_propria',
  'horarios:editar_proprio',
  'horarios:gerenciar',
  'servicos:gerenciar',
  'estoque:ver',
  'estoque:editar',
  'relatorios:ver',
  'relatorios:ver_proprios',
  'empresa:gerenciar',
  'sinal:gerenciar',
  'recebedor:gerenciar',
  'fidelidade:gerenciar',
  'marketing:gerenciar', // posts para o Instagram
  'auditoria:ver',
] as const;

export type Permissao = (typeof PERMISSOES)[number];

const MAPA: Record<Perfil, readonly Permissao[]> = {
  ADMIN: PERMISSOES,
  GERENTE: [
    'horarios:gerenciar',
    'agenda:ver_todas',
    'agenda:gerenciar',
    'agenda:ver_propria',
    'agenda:gerenciar_propria',
    'estoque:ver',
    'estoque:editar',
    'relatorios:ver',
    'marketing:gerenciar',
  ],
  FUNCIONARIO: ['agenda:ver_propria', 'agenda:gerenciar_propria', 'relatorios:ver_proprios'],
  // 'horarios:editar_proprio' é liberado por funcionário (RF19), não pelo perfil.
};

export function temPermissao(perfil: Perfil, permissao: Permissao): boolean {
  return MAPA[perfil].includes(permissao);
}

export function permissoesDo(perfil: Perfil): readonly Permissao[] {
  return MAPA[perfil];
}
