import type { Request } from 'express';
import type { Empresa } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { auditar } from '../../lib/audit.js';
import { ehCnpj } from '../../lib/documento.js';
import type { EmpresaInput } from './empresa.schemas.js';

const ID = 1; // linha única

export function obter() {
  return prisma.empresa.findUnique({ where: { id: ID } });
}

// RF06: salva os dados (cria na primeira vez)
export async function salvar(req: Request, dados: EmpresaInput) {
  const anterior = await obter();
  const empresa = await prisma.empresa.upsert({
    where: { id: ID },
    create: { id: ID, ...dados },
    update: dados,
  });

  // 9.7: registra QUAIS campos mudaram (sem os valores)
  const alterados = anterior
    ? (Object.keys(dados) as (keyof EmpresaInput)[]).filter(
        (k) => JSON.stringify(anterior[k as keyof Empresa]) !== JSON.stringify(empresa[k as keyof Empresa]),
      )
    : Object.keys(dados);
  if (alterados.length) {
    await auditar('EMPRESA_ALTERADA', req, { usuarioId: req.usuario!.id, entidade: 'Empresa', detalhes: { campos: alterados } });
  }
  return empresa;
}

// Versão pública (landing e tela de agendamento): sem dados internos.
// CPF nunca aparece; CNPJ é dado público da empresa.
export function paraPublico(e: Empresa) {
  return {
    nome: e.nome,
    cnpj: ehCnpj(e.documento) ? e.documento : null,
    email: e.email,
    telefone: e.telefone,
    whatsapp: e.whatsapp,
    instagram: e.instagram,
    facebook: e.facebook,
    site: e.site,
    endereco: {
      cep: e.cep,
      logradouro: e.logradouro,
      numero: e.numero,
      complemento: e.complemento,
      bairro: e.bairro,
      cidade: e.cidade,
      uf: e.uf,
    },
    logoUrl: e.logoUrl,
    fusoHorario: e.fusoHorario,
    horarioFuncionamento: e.horarioFuncionamento,
    politicaCancelamento: e.politicaCancelamento,
    politicaAtraso: e.politicaAtraso,
  };
}
