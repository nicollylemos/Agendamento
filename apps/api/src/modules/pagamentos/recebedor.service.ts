import type { Request } from 'express';
import type { GatewayPagamento, Recebedor } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import { cifrar, decifrar } from '../../lib/crypto.js';
import { documentoValido, normalizarDocumento } from '../../lib/documento.js';
import { enviarEmail } from '../../lib/mailer.js';
import { env, isProd } from '../../config/env.js';
import { consumirToken, criarTokenUso } from '../auth/auth.service.js';
import { revogarTodasDoUsuario } from '../auth/sessao.service.js';
import { MercadoPago } from './gateway/mercadoPago.js';
import { Simulado } from './gateway/simulado.js';
import type { GatewayPix } from './gateway/tipos.js';

// RF34–RF37: quem recebe o sinal.
// 9.3: documento, chave Pix, token e segredo do gateway são cifrados (AES-256-GCM);
// a tela só vê os 4 últimos caracteres (RF35). Salvar exige senha + 2FA (rota, RF36).

const final4 = (v: string) => v.slice(-4);

const opcionalSecreto = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? undefined : v))
  .optional();

export const salvarRecebedorSchema = z
  .object({
    nome: z.string().trim().min(2).max(120),
    // Vazio = manter o que já está salvo (a tela nunca recebe o valor completo)
    documento: opcionalSecreto,
    tipoChave: z.enum(['CPF', 'CNPJ', 'EMAIL', 'TELEFONE', 'ALEATORIA']),
    chave: opcionalSecreto,
    banco: z
      .string()
      .trim()
      .max(80)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    gateway: z.enum(['MERCADO_PAGO', 'SIMULADO']),
    tokenGateway: opcionalSecreto,
    segredoWebhook: opcionalSecreto,
  })
  .superRefine((d, ctx) => {
    if (d.documento && !documentoValido(d.documento)) ctx.addIssue({ code: 'custom', path: ['documento'], message: 'CPF ou CNPJ inválido' });
    if (d.chave) {
      const ok = {
        CPF: () => documentoValido(d.chave!) && normalizarDocumento(d.chave!).length === 11,
        CNPJ: () => documentoValido(d.chave!) && normalizarDocumento(d.chave!).length === 14,
        EMAIL: () => z.string().email().safeParse(d.chave).success,
        TELEFONE: () => /^\+?\d{10,13}$/.test(d.chave!.replace(/[\s()-]/g, '')),
        ALEATORIA: () => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.chave!),
      }[d.tipoChave]();
      if (!ok) ctx.addIssue({ code: 'custom', path: ['chave'], message: 'Chave Pix não confere com o tipo escolhido' });
    }
  });

function paraTela(r: Recebedor | null) {
  if (!r) return null;
  return {
    nome: r.nome,
    tipoChave: r.tipoChave,
    banco: r.banco,
    gateway: r.gateway,
    finalDocumento: r.finalDocumento,
    finalChave: r.finalChave,
    finalToken: r.finalToken,
    finalSegredo: r.finalSegredo,
    testadoEm: r.testadoEm,
    ativo: r.ativo,
    atualizadoEm: r.updatedAt,
  };
}

export async function obter() {
  return paraTela(await prisma.recebedor.findUnique({ where: { id: 1 } }));
}

function garantirGatewayPermitido(g: GatewayPagamento) {
  if (g === 'SIMULADO' && isProd) throw new AppError('GATEWAY_INVALIDO', 'O gateway simulado não pode ser usado em produção', 400);
}

// RF34, RF36
export async function salvar(req: Request, dados: z.infer<typeof salvarRecebedorSchema>) {
  garantirGatewayPermitido(dados.gateway);
  const atual = await prisma.recebedor.findUnique({ where: { id: 1 } });
  const trocouGateway = atual && atual.gateway !== dados.gateway;

  const documento = dados.documento ? normalizarDocumento(dados.documento) : undefined;
  const chave = dados.chave ? (['CPF', 'CNPJ'].includes(dados.tipoChave) ? normalizarDocumento(dados.chave) : dados.chave) : undefined;
  if (!atual && (!documento || !chave)) throw new AppError('VALIDACAO', 'Informe o CPF/CNPJ e a chave Pix', 400);
  if (atual && atual.tipoChave !== dados.tipoChave && !chave) throw new AppError('VALIDACAO', 'Mudou o tipo de chave: informe a chave nova', 400);

  let token = dados.tokenGateway;
  let segredo = dados.segredoWebhook;
  if (dados.gateway === 'MERCADO_PAGO') {
    const temToken = token || (!trocouGateway && atual?.tokenGatewayCifrado);
    const temSegredo = segredo || (!trocouGateway && atual?.segredoWebhookCifrado);
    if (!temToken || !temSegredo) throw new AppError('VALIDACAO', 'Informe o access token e a assinatura secreta do webhook do Mercado Pago', 400);
  } else if (!segredo && (trocouGateway || !atual?.segredoWebhookCifrado)) {
    segredo = randomBytes(24).toString('base64url'); // simulado: gerado aqui
    token = undefined;
  }

  const campos = [
    ...(atual?.nome !== dados.nome ? ['nome'] : []),
    ...(documento ? ['documento'] : []),
    ...(atual?.tipoChave !== dados.tipoChave || chave ? ['chavePix'] : []),
    ...((atual?.banco ?? null) !== (dados.banco ?? null) ? ['banco'] : []),
    ...(atual?.gateway !== dados.gateway ? ['gateway'] : []),
    ...(token ? ['tokenGateway'] : []),
    ...(segredo ? ['segredoWebhook'] : []),
  ];

  const comum = {
    nome: dados.nome,
    tipoChave: dados.tipoChave,
    banco: dados.banco ?? null,
    gateway: dados.gateway,
    ...(documento && { documentoCifrado: cifrar(documento), finalDocumento: final4(documento) }),
    ...(chave && { chaveCifrada: cifrar(chave), finalChave: final4(chave) }),
    ...(token && { tokenGatewayCifrado: cifrar(token), finalToken: final4(token) }),
    ...(segredo && { segredoWebhookCifrado: cifrar(segredo), finalSegredo: final4(segredo) }),
    ...(trocouGateway && dados.gateway === 'SIMULADO' && { tokenGatewayCifrado: null, finalToken: null }),
    // RF37: qualquer alteração exige testar e ativar de novo
    testadoEm: null,
    ativo: false,
    alteradoPor: req.usuario!.id,
  };

  const r = atual
    ? await prisma.recebedor.update({ where: { id: 1 }, data: comum })
    : await prisma.recebedor.create({
        data: { id: 1, ...comum, documentoCifrado: cifrar(documento!), finalDocumento: final4(documento!), chaveCifrada: cifrar(chave!), finalChave: final4(chave!) },
      });

  // 9.7: registra quais campos mudaram, nunca os valores
  await auditar('RECEBEDOR_ALTERADO', req, { usuarioId: req.usuario!.id, entidade: 'Recebedor', entidadeId: '1', detalhes: { campos } });
  await alertarAdmins(req, 'Os dados de quem recebe o sinal foram alterados');
  return paraTela(r);
}

// RF36 / fluxo 6.5: e-mail para todos os admins, com link para bloquear em caso de fraude
async function alertarAdmins(req: Request, oQue: string) {
  const admins = await prisma.usuario.findMany({ where: { perfil: 'ADMIN', ativo: true }, select: { email: true } });
  const autor = req.usuario!;
  const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  for (const a of admins) {
    const token = await criarTokenUso('ALERTA_RECEBEDOR', a.email, { alteradoPor: autor.id }, autor.id);
    await enviarEmail(
      a.email,
      'Alerta de segurança: recebedor do sinal alterado',
      [
        `${oQue} em ${quando}, pelo IP ${req.ip ?? 'desconhecido'}.`,
        '',
        'Se foi você, não precisa fazer nada.',
        '',
        'Se NÃO foi você, clique no link abaixo. Ele desativa o recebimento do sinal na hora,',
        'desconecta a conta que fez a alteração de todos os aparelhos e envia um link para trocar a senha:',
        `${env.APP_URL}/seguranca/nao-fui-eu?token=${token}`,
        '',
        'O link vale 7 dias e só pode ser usado uma vez.',
      ].join('\n'),
    );
  }
}

// RF37
export async function testar(req: Request) {
  const r = await prisma.recebedor.findUnique({ where: { id: 1 } });
  if (!r) throw new AppError('SEM_RECEBEDOR', 'Cadastre o recebedor primeiro', 404);
  const resultado = await gatewayDe(r).testarConexao();
  if (resultado.ok) await prisma.recebedor.update({ where: { id: 1 }, data: { testadoEm: new Date() } });
  await auditar('RECEBEDOR_TESTADO', req, { usuarioId: req.usuario!.id, entidade: 'Recebedor', detalhes: { ok: resultado.ok } });
  return resultado;
}

// RF37: só ativa depois de testar com sucesso. Ativar e desativar também pedem reautenticação.
export async function definirAtivo(req: Request, ativo: boolean) {
  const r = await prisma.recebedor.findUnique({ where: { id: 1 } });
  if (!r) throw new AppError('SEM_RECEBEDOR', 'Cadastre o recebedor primeiro', 404);
  if (ativo) {
    garantirGatewayPermitido(r.gateway);
    if (!r.testadoEm) throw new AppError('NAO_TESTADO', 'Teste a conexão com o gateway antes de ativar', 409);
  }
  await prisma.recebedor.update({ where: { id: 1 }, data: { ativo, alteradoPor: req.usuario!.id } });
  await auditar(ativo ? 'RECEBEDOR_ATIVADO' : 'RECEBEDOR_DESATIVADO', req, { usuarioId: req.usuario!.id, entidade: 'Recebedor' });
  if (ativo) await alertarAdmins(req, 'O recebimento do sinal foi ativado');
  return obter();
}

// Fluxo 6.5: "não fui eu" — corta o recebimento, derruba a conta suspeita e força troca de senha
export async function naoFuiEu(req: Request, token: string) {
  const registro = await prisma.$transaction((tx) => consumirToken(tx, 'ALERTA_RECEBEDOR', token));
  const { alteradoPor } = (registro.dados ?? {}) as { alteradoPor?: string };
  await prisma.recebedor.updateMany({ where: { id: 1 }, data: { ativo: false, testadoEm: null } });
  if (alteradoPor) {
    await revogarTodasDoUsuario(alteradoPor);
    const u = await prisma.usuario.findUnique({ where: { id: alteradoPor }, select: { email: true } });
    if (u) {
      const reset = await criarTokenUso('RESET_SENHA', u.email);
      await enviarEmail(u.email, 'Troque sua senha', `Por segurança, crie uma nova senha:\n${env.APP_URL}/redefinir-senha?token=${reset}\n\nO link vale 30 minutos.`);
    }
  }
  await auditar('RECEBEDOR_NAO_FUI_EU', req, { entidade: 'Recebedor', detalhes: { alteradoPor: alteradoPor ?? null } });
}

// ─── Uso interno ─────────────────────────────────────────

function gatewayDe(r: Recebedor): GatewayPix {
  const segredo = r.segredoWebhookCifrado ? decifrar(r.segredoWebhookCifrado) : '';
  if (r.gateway === 'SIMULADO') {
    garantirGatewayPermitido('SIMULADO');
    return new Simulado(segredo);
  }
  if (!r.tokenGatewayCifrado) throw new AppError('SEM_CREDENCIAL', 'Token do gateway não configurado', 500);
  return new MercadoPago(decifrar(r.tokenGatewayCifrado), segredo);
}

// Gateway do recebedor ativo, ou null se o sinal não pode ser cobrado agora
export async function gatewayAtivo(): Promise<{ gateway: GatewayPix; tipo: GatewayPagamento } | null> {
  const r = await prisma.recebedor.findUnique({ where: { id: 1 } });
  if (!r || !r.ativo || (r.gateway === 'SIMULADO' && isProd)) return null;
  return { gateway: gatewayDe(r), tipo: r.gateway };
}

// Para consultar/reembolsar pagamentos antigos mesmo com o recebedor desativado
export async function gatewayDoTipo(tipo: GatewayPagamento): Promise<GatewayPix | null> {
  const r = await prisma.recebedor.findUnique({ where: { id: 1 } });
  if (!r || r.gateway !== tipo) return null;
  return gatewayDe(r);
}
