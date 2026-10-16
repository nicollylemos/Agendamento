import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { logger } from './logger.js';

// Seção 9.7: log de auditoria. Nunca guarde senha, token ou valor sensível em "detalhes".
export type AcaoAuditoria =
  | 'LOGIN_SUCESSO'
  | 'LOGIN_FALHA'
  | 'CONTA_BLOQUEADA'
  | 'MFA_FALHA'
  | 'MFA_ATIVADO'
  | 'MFA_DESATIVADO'
  | 'MFA_CODIGO_RECUPERACAO_USADO'
  | 'LOGOUT'
  | 'SESSAO_REUSO_DETECTADO'
  | 'SENHA_RESET_SOLICITADO'
  | 'SENHA_REDEFINIDA'
  | 'CONVITE_CRIADO'
  | 'CONVITE_ACEITO'
  | 'USUARIO_DESATIVADO'
  | 'USUARIO_REATIVADO'
  | 'PERFIL_ALTERADO'
  | 'REAUTENTICACAO'
  | 'EMPRESA_ALTERADA'
  | 'FUNCIONARIO_CRIADO'
  | 'FUNCIONARIO_ALTERADO'
  | 'SERVICO_CRIADO'
  | 'SERVICO_ALTERADO'
  | 'SERVICO_REMOVIDO'
  | 'SERVICO_EQUIPE_ALTERADA'
  | 'MODELO_JORNADA_SALVO'
  | 'JORNADA_ALTERADA'
  | 'EXCECAO_SALVA'
  | 'EXCECAO_REMOVIDA'
  | 'BLOQUEIO_CRIADO'
  | 'BLOQUEIO_REMOVIDO'
  | 'CONFIG_AGENDA_ALTERADA'
  | 'AGENDAMENTO_CRIADO'
  | 'AGENDAMENTO_STATUS'
  | 'AGENDAMENTO_REAGENDADO'
  | 'AGENDAMENTO_CANCELADO_CLIENTE'
  | 'CLIENTE_ACESSO_CODIGO'
  | 'CONFIG_SINAL_ALTERADA'
  | 'RECEBEDOR_ALTERADO'
  | 'RECEBEDOR_TESTADO'
  | 'RECEBEDOR_ATIVADO'
  | 'RECEBEDOR_DESATIVADO'
  | 'RECEBEDOR_NAO_FUI_EU'
  | 'SINAL_CONFIRMADO'
  | 'SINAL_EXPIRADO'
  | 'SINAL_REEMBOLSADO'
  | 'SINAL_RETIDO'
  | 'SINAL_RECEBIDO_APOS_EXPIRAR'
  | 'WEBHOOK_RECUSADO'
  | 'PRODUTO_CRIADO'
  | 'PRODUTO_ALTERADO'
  | 'PRODUTO_REMOVIDO'
  | 'ESTOQUE_MOVIMENTADO'
  | 'FICHA_TECNICA_ALTERADA'
  | 'FIDELIDADE_PROGRAMA_ALTERADO'
  | 'RECOMPENSA_SALVA'
  | 'RECOMPENSA_REMOVIDA'
  | 'PONTOS_AJUSTADOS'
  | 'PONTOS_RESGATADOS'
  | 'VOUCHER_USADO'
  | 'VOUCHER_CANCELADO'
  | 'ARQUIVO_ENVIADO'
  | 'PERSONALIZACAO_SALVA'
  | 'PERSONALIZACAO_PUBLICADA'
  | 'RELATORIO_EXPORTADO'
  | 'POST_SALVO'
  | 'POST_REMOVIDO';

interface DadosAuditoria {
  usuarioId?: string | null;
  entidade?: string;
  entidadeId?: string;
  detalhes?: Prisma.InputJsonValue;
}

export async function auditar(acao: AcaoAuditoria, req: Request | null, dados: DadosAuditoria = {}) {
  try {
    await prisma.logAuditoria.create({
      data: {
        acao,
        usuarioId: dados.usuarioId ?? null,
        entidade: dados.entidade,
        entidadeId: dados.entidadeId,
        detalhes: dados.detalhes,
        ip: req?.ip,
        userAgent: req?.get('user-agent')?.slice(0, 255),
      },
    });
  } catch (err) {
    // Falha de auditoria não pode derrubar a requisição, mas precisa aparecer.
    logger.error({ err, acao }, 'Falha ao gravar auditoria');
  }
}
