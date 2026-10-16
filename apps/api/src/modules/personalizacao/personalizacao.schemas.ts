import { z } from 'zod';
import { ehUrlDeArquivo } from '../../lib/armazenamento.js';

// RF07, RF10 e seção 9.4: tudo que vai para o site passa por aqui.
// - Cores: só #RRGGBB, e com contraste mínimo com o texto branco dos botões (WCAG AA, RNF07).
// - Fontes: só as da lista (são as que o site carrega).
// - Textos: texto puro. Tags HTML são removidas e o React ainda escapa na hora de mostrar;
//   o site nunca renderiza HTML vindo do banco (dangerouslySetInnerHTML proibido).
// - Imagens: só URLs de arquivos que nós mesmos guardamos (nada de link externo).

export const FONTES = ['instrument', 'figtree', 'dm-sans', 'nunito', 'lora', 'playfair'] as const;
export const SECOES = ['sobre', 'servicos', 'equipe', 'galeria', 'depoimentos', 'contato', 'comoFunciona', 'politicas'] as const;

// Contraste WCAG entre uma cor e o branco
function luminancia(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export const contrasteComBranco = (hex: string) => 1.05 / (luminancia(hex) + 0.05);

const semTags = (v: string) =>
  v
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
export const texto = (max: number, min = 0) => z.string().max(max * 2).transform(semTags).pipe(z.string().min(min).max(max));

const cor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #RRGGBB')
  .refine((c) => contrasteComBranco(c) >= 4.5, 'Cor clara demais: o texto branco dos botões ficaria ilegível. Escolha um tom mais escuro.');

export const urlImagem = z.string().max(300).refine(ehUrlDeArquivo, 'Imagem inválida: envie pelo próprio painel');

export const personalizacaoSchema = z.object({
  tema: z.object({
    corPrimaria: cor,
    fonteTitulos: z.enum(FONTES),
    fonteTexto: z.enum(FONTES),
  }),
  logoUrl: urlImagem.nullable(),
  bannerUrl: urlImagem.nullable(),
  textos: z.object({
    titulo: texto(80, 2),
    subtitulo: texto(200),
    chamadaBotao: texto(30, 2),
    sobre: texto(1500),
    boasVindasAgendamento: texto(300),
  }),
  // RF10: todas as seções, na ordem escolhida, cada uma ligada ou não
  // Seção nova (que ainda não estava no que foi salvo) entra no fim, visível
  secoes: z
    .array(z.object({ id: z.enum(SECOES), visivel: z.boolean() }))
    .max(SECOES.length)
    .refine((l) => new Set(l.map((s) => s.id)).size === l.length, 'Seção repetida')
    .transform((l) => [...l, ...SECOES.filter((id) => !l.some((s) => s.id === id)).map((id) => ({ id, visivel: true }))]),
  galeria: z.array(z.object({ url: urlImagem, legenda: texto(80) })).max(24),
  depoimentos: z.array(z.object({ nome: texto(60, 2), texto: texto(400, 5) })).max(12),
  // RF07: perguntas a mais no formulário de agendamento
  camposExtras: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{1,30}$/),
        rotulo: texto(80, 2),
        tipo: z.enum(['TEXTO', 'SIM_NAO']),
        obrigatorio: z.boolean(),
      }),
    )
    .max(5)
    .refine((l) => new Set(l.map((c) => c.id)).size === l.length, 'Campo repetido'),
});

export type Personalizacao = z.infer<typeof personalizacaoSchema>;

export const PADRAO: Personalizacao = {
  tema: { corPrimaria: '#26292a', fonteTitulos: 'instrument', fonteTexto: 'instrument' },
  logoUrl: null,
  bannerUrl: null,
  textos: {
    titulo: 'Seu horário, do seu jeito',
    subtitulo: 'Escolha o serviço, o profissional e o melhor horário. Leva menos de um minuto.',
    chamadaBotao: 'Agendar horário',
    sobre: '',
    boasVindasAgendamento: '',
  },
  secoes: [
    { id: 'comoFunciona', visivel: true },
    { id: 'servicos', visivel: true },
    { id: 'sobre', visivel: true },
    { id: 'equipe', visivel: true },
    { id: 'galeria', visivel: false },
    { id: 'depoimentos', visivel: false },
    { id: 'politicas', visivel: true },
    { id: 'contato', visivel: true },
  ],
  galeria: [],
  depoimentos: [],
  camposExtras: [],
};
