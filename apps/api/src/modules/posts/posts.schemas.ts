import { z } from 'zod';
import { FONTES, texto, urlImagem } from '../personalizacao/personalizacao.schemas.js';

// Posts para o Instagram: o conteúdo é sempre validado (texto sem tags, só imagens nossas, cores #RRGGBB)

export const MODELOS = ['SERVICO', 'PROMOCAO', 'HORARIOS', 'DEPOIMENTO', 'EQUIPE', 'AVISO'] as const;
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #RRGGBB');

export const conteudoSchema = z.object({
  titulo: texto(120),
  subtitulo: texto(200),
  texto: texto(600),
  destaque: texto(40), // preço, desconto, nota
  rodape: texto(120),
  itens: z.array(texto(40)).max(12), // ex.: horários livres
  imagemUrl: urlImagem.nullable(),
  fundo: z.enum(['COR', 'IMAGEM']),
  corFundo: hex,
  corTexto: hex,
  corDestaque: hex,
  fonteTitulos: z.enum(FONTES),
  fonteTexto: z.enum(FONTES),
  mostrarLogo: z.boolean(),
  alinhamento: z.enum(['ESQUERDA', 'CENTRO']),
});

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');

export const postSchema = z.object({
  titulo: texto(80, 1),
  modelo: z.enum(MODELOS),
  formato: z.enum(['QUADRADO', 'RETRATO', 'STORY']),
  conteudo: conteudoSchema,
  legenda: texto(2200),
  status: z.enum(['RASCUNHO', 'PRONTO', 'PUBLICADO']),
  agendadoPara: data.nullable(),
});
export const editarPostSchema = postSchema.partial();

export const listarPostsQuery = z.object({ status: z.enum(['RASCUNHO', 'PRONTO', 'PUBLICADO']).optional() });
