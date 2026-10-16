import type { Fonte } from './site';

// Posts para o Instagram: modelos, formatos e textos de partida

export type Modelo = 'SERVICO' | 'PROMOCAO' | 'HORARIOS' | 'DEPOIMENTO' | 'EQUIPE' | 'AVISO';
export type Formato = 'QUADRADO' | 'RETRATO' | 'STORY';
export type StatusPost = 'RASCUNHO' | 'PRONTO' | 'PUBLICADO';

export interface Conteudo {
  titulo: string;
  subtitulo: string;
  texto: string;
  destaque: string;
  rodape: string;
  itens: string[];
  imagemUrl: string | null;
  fundo: 'COR' | 'IMAGEM';
  corFundo: string;
  corTexto: string;
  corDestaque: string;
  fonteTitulos: Fonte;
  fonteTexto: Fonte;
  mostrarLogo: boolean;
  alinhamento: 'ESQUERDA' | 'CENTRO';
}

export interface Post {
  id: string;
  titulo: string;
  modelo: Modelo;
  formato: Formato;
  conteudo: Conteudo;
  legenda: string;
  status: StatusPost;
  agendadoPara: string | null;
  atualizadoEm: string;
}

export const FORMATOS: Record<Formato, { nome: string; largura: number; altura: number }> = {
  QUADRADO: { nome: 'Feed quadrado', largura: 1080, altura: 1080 },
  RETRATO: { nome: 'Feed retrato', largura: 1080, altura: 1350 },
  STORY: { nome: 'Story', largura: 1080, altura: 1920 },
};

export const NOME_STATUS_POST: Record<StatusPost, string> = { RASCUNHO: 'Rascunho', PRONTO: 'Pronto para postar', PUBLICADO: 'Publicado' };

// Rótulos dos campos mudam conforme o modelo (só o que o modelo usa aparece no formulário)
export const MODELOS: Record<
  Modelo,
  { nome: string; descricao: string; campos: Partial<Record<'titulo' | 'subtitulo' | 'texto' | 'destaque' | 'rodape' | 'itens', string>>; padrao: Partial<Conteudo> }
> = {
  SERVICO: {
    nome: 'Serviço em destaque',
    descricao: 'Foto, nome, preço e duração de um serviço.',
    campos: { titulo: 'Nome do serviço', subtitulo: 'Descrição', destaque: 'Preço', texto: 'Detalhe (ex.: duração)', rodape: 'Chamada final' },
    padrao: { titulo: 'Nome do serviço', subtitulo: 'Uma frase sobre o que torna esse serviço especial.', destaque: 'R$ 0,00', texto: '1 h', rodape: 'Agende pelo link da bio' },
  },
  PROMOCAO: {
    nome: 'Promoção',
    descricao: 'Um número grande (desconto ou preço) e as condições.',
    campos: { destaque: 'Número em destaque', titulo: 'Título', subtitulo: 'Condição', texto: 'Validade', rodape: 'Chamada final' },
    padrao: { destaque: '20% off', titulo: 'Na primeira visita', subtitulo: 'Válido para todos os serviços de cabelo.', texto: 'Até 31 de outubro', rodape: 'Agende pelo link da bio' },
  },
  HORARIOS: {
    nome: 'Horários livres',
    descricao: 'Os horários que ainda estão vagos num dia.',
    campos: { titulo: 'Título', subtitulo: 'Dia e serviço', itens: 'Horários (um por linha)', rodape: 'Chamada final' },
    padrao: { titulo: 'Horários livres', subtitulo: 'Sexta-feira, 16 de outubro', itens: ['09:00', '10:30', '14:00', '16:30'], rodape: 'Garanta o seu pelo link da bio' },
  },
  DEPOIMENTO: {
    nome: 'Depoimento',
    descricao: 'O que uma cliente disse, em destaque.',
    campos: { texto: 'Depoimento', subtitulo: 'Nome da cliente', destaque: 'Serviço feito', rodape: 'Chamada final' },
    padrao: { texto: 'Saí de lá me sentindo outra pessoa. Atendimento impecável do começo ao fim.', subtitulo: 'Mariana', destaque: 'Coloração', rodape: 'Agende pelo link da bio' },
  },
  EQUIPE: {
    nome: 'Equipe',
    descricao: 'Apresente quem atende, com foto.',
    campos: { titulo: 'Nome', subtitulo: 'Cargo', texto: 'Apresentação', rodape: 'Chamada final' },
    padrao: { titulo: 'Nome da profissional', subtitulo: 'Cabeleireira', texto: 'Especialista em cortes e coloração, há 8 anos cuidando de quem senta na cadeira.', rodape: 'Agende com ela pelo link da bio' },
  },
  AVISO: {
    nome: 'Aviso',
    descricao: 'Feriado, novidade, mudança de horário.',
    campos: { destaque: 'Etiqueta', titulo: 'Título', texto: 'Texto', rodape: 'Rodapé' },
    padrao: { destaque: 'Aviso', titulo: 'Feriado de 2 de novembro', texto: 'Não vamos abrir no feriado. Voltamos no dia 3, no horário de sempre.', rodape: '' },
  },
};

export function conteudoPadrao(modelo: Modelo, tema: { corPrimaria: string; fonteTitulos: Fonte; fonteTexto: Fonte }): Conteudo {
  return {
    titulo: '',
    subtitulo: '',
    texto: '',
    destaque: '',
    rodape: '',
    itens: [],
    imagemUrl: null,
    fundo: 'COR',
    corFundo: '#f4f2ee',
    corTexto: '#26292a',
    corDestaque: tema.corPrimaria,
    fonteTitulos: tema.fonteTitulos,
    fonteTexto: tema.fonteTexto,
    mostrarLogo: true,
    alinhamento: 'ESQUERDA',
    ...MODELOS[modelo].padrao,
  };
}

// Legenda de partida (a pessoa edita depois)
export function sugerirLegenda(modelo: Modelo, c: Conteudo, empresa: { nome: string; cidade?: string | null }) {
  const tag = (t: string) => `#${t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]/g, '').toLowerCase()}`;
  const tags = [tag(empresa.nome), empresa.cidade && tag(empresa.cidade), modelo === 'SERVICO' && c.titulo && tag(c.titulo)].filter(Boolean).join(' ');
  const fim = `\n\nAgende pelo link da bio.\n\n${tags}`;
  switch (modelo) {
    case 'SERVICO':
      return `${c.titulo}${c.destaque ? ` por ${c.destaque}` : ''}.\n${c.subtitulo}${fim}`;
    case 'PROMOCAO':
      return `${c.destaque} ${c.titulo.toLowerCase()}.\n${c.subtitulo}\n${c.texto}${fim}`;
    case 'HORARIOS':
      return `Ainda temos horários livres: ${c.subtitulo.toLowerCase()}.\n${c.itens.join(', ')}.\nCorre que acaba rápido.${fim}`;
    case 'DEPOIMENTO':
      return `"${c.texto}"\n${c.subtitulo}${c.destaque ? `, ${c.destaque.toLowerCase()}` : ''}.\n\nObrigada pela confiança!${fim}`;
    case 'EQUIPE':
      return `Conheça ${c.titulo}, ${c.subtitulo.toLowerCase()} aqui na ${empresa.nome}.\n${c.texto}${fim}`;
    default:
      return `${c.titulo}\n${c.texto}\n\n${tags}`;
  }
}
