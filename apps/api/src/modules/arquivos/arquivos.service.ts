import type { Request } from 'express';
import type { FinalidadeArquivo } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp, { type OutputInfo } from 'sharp';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/AppError.js';
import { auditar } from '../../lib/audit.js';
import { salvar } from '../../lib/armazenamento.js';

// Seção 9.4: upload de imagens.
// 1. Tipo conferido pelos primeiros bytes (magic bytes), não pela extensão nem pelo Content-Type.
// 2. Só JPEG, PNG e WebP (SVG pode carregar script; GIF/HEIC ficam de fora).
// 3. Reprocessada com sharp: gira pelo EXIF, reduz, converte para WebP e descarta todos os
//    metadados (localização do celular, câmera, scripts escondidos).
// 4. Nome aleatório (uuid.webp); o nome original nem é guardado.

export const TAMANHO_MAXIMO = 5 * 1024 * 1024; // 5 MB

const DIMENSOES: Record<FinalidadeArquivo, { largura: number; altura: number }> = {
  LOGO: { largura: 512, altura: 512 },
  BANNER: { largura: 2000, altura: 1100 },
  SERVICO: { largura: 1200, altura: 1200 },
  EQUIPE: { largura: 800, altura: 800 },
  GALERIA: { largura: 1600, altura: 1600 },
  POST: { largura: 1080, altura: 1920 }, // cabe o story inteiro
};

export function tipoPelosBytes(b: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export async function enviar(req: Request, finalidade: FinalidadeArquivo, conteudo: unknown) {
  if (!Buffer.isBuffer(conteudo) || !conteudo.length) {
    throw new AppError('ARQUIVO_INVALIDO', 'Envie uma imagem JPG, PNG ou WebP', 400);
  }
  if (conteudo.length > TAMANHO_MAXIMO) throw new AppError('MUITO_GRANDE', 'A imagem pode ter até 5 MB', 413);
  if (!tipoPelosBytes(conteudo)) throw new AppError('ARQUIVO_INVALIDO', 'Envie uma imagem JPG, PNG ou WebP', 400);

  const { largura, altura } = DIMENSOES[finalidade];
  let saida: { data: Buffer; info: OutputInfo };
  try {
    saida = await sharp(conteudo, { limitInputPixels: 50_000_000, failOn: 'error' }) // trava "bombas" de pixels
      .rotate()
      .resize({ width: largura, height: altura, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true }); // sem .withMetadata(): o sharp descarta EXIF/XMP/ICC
  } catch {
    throw new AppError('ARQUIVO_INVALIDO', 'Não conseguimos ler essa imagem. Tente outra.', 400);
  }

  const chave = `${randomUUID()}.webp`;
  const url = await salvar(chave, saida.data, 'image/webp');
  const arquivo = await prisma.arquivo.create({
    data: { chave, url, finalidade, largura: saida.info.width, altura: saida.info.height, bytes: saida.info.size, criadoPor: req.usuario!.id },
  });
  await auditar('ARQUIVO_ENVIADO', req, { usuarioId: req.usuario!.id, entidade: 'Arquivo', entidadeId: arquivo.id, detalhes: { finalidade, bytes: arquivo.bytes } });
  return { id: arquivo.id, url, largura: arquivo.largura, altura: arquivo.altura };
}
