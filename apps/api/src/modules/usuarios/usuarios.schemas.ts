import { z } from 'zod';

export const idParamSchema = z.object({ id: z.string().uuid() });

// RF02: admin convida gerente ou funcionário. Novos admins não entram por convite.
export const convidarSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  perfil: z.enum(['GERENTE', 'FUNCIONARIO']),
});

export const alterarStatusSchema = z.object({ ativo: z.boolean() });
export const alterarPerfilSchema = z.object({ perfil: z.enum(['ADMIN', 'GERENTE', 'FUNCIONARIO']) });
