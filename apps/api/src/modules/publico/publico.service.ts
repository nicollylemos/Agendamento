import { prisma } from '../../lib/prisma.js';
import { calcularSinal, obterConfigSinal } from '../pagamentos/sinal.service.js';

// Catálogo público: só serviços ativos com pelo menos um profissional
// ativo e visível. Nunca expõe e-mail, comissão ou dados internos.
export async function catalogo() {
  // RF28: o cliente vê antes quanto vai pagar de sinal (só se o recebimento estiver ativo)
  const [config, recebedor] = await Promise.all([obterConfigSinal(), prisma.recebedor.findUnique({ where: { id: 1 }, select: { ativo: true } })]);
  const cobra = Boolean(recebedor?.ativo);
  const servicos = await prisma.servico.findMany({
    where: { ativo: true, deletedAt: null },
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    select: {
      id: true,
      nome: true,
      descricao: true,
      duracaoMin: true,
      precoCentavos: true,
      fotoUrl: true,
      sinalModo: true,
      sinalTipo: true,
      sinalValor: true,
      sinalPrazoMin: true,
      categoria: { select: { id: true, nome: true, ordem: true } },
      funcionarios: {
        where: { funcionario: { exibirNoSite: true, ativo: true } },
        select: {
          precoCentavos: true,
          duracaoMin: true,
          funcionario: {
            select: { id: true, cargo: true, fotoUrl: true, ordem: true, nome: true },
          },
        },
      },
    },
  });

  return servicos
    .filter((s) => s.funcionarios.length > 0)
    .map(({ funcionarios, sinalModo, sinalTipo, sinalValor, sinalPrazoMin, ...s }) => ({
      ...s,
      // RF13: preço e duração de cada profissional (ou os do serviço, se não tiver próprio)
      profissionais: funcionarios
        .sort((a, b) => a.funcionario.ordem - b.funcionario.ordem)
        .map((f) => ({
          id: f.funcionario.id,
          nome: f.funcionario.nome,
          cargo: f.funcionario.cargo,
          fotoUrl: f.funcionario.fotoUrl,
          precoCentavos: f.precoCentavos ?? s.precoCentavos,
          duracaoMin: f.duracaoMin ?? s.duracaoMin,
          sinalCentavos: cobra ? calcularSinal(f.precoCentavos ?? s.precoCentavos, { sinalModo, sinalTipo, sinalValor, sinalPrazoMin }, config).sinalCentavos : 0,
        })),
      sinalPrazoMin: cobra ? calcularSinal(s.precoCentavos, { sinalModo, sinalTipo, sinalValor, sinalPrazoMin }, config).prazoMin : 0,
    }));
}

// RF09: equipe para a landing
export function equipe() {
  return prisma.funcionario.findMany({
    where: { ativo: true, exibirNoSite: true, servicos: { some: { servico: { ativo: true, deletedAt: null } } } },
    select: { id: true, nome: true, cargo: true, bio: true, fotoUrl: true },
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
  });
}
