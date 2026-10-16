import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

// Fase 9: personalização do site (RF07–RF10)

export const FONTES = {
  instrument: { nome: 'Instrument Sans (padrão)', css: "'Instrument Sans Variable'" },
  figtree: { nome: 'Figtree', css: "'Figtree Variable'" },
  'dm-sans': { nome: 'DM Sans', css: "'DM Sans Variable'" },
  nunito: { nome: 'Nunito', css: "'Nunito Variable'" },
  lora: { nome: 'Lora (serifada)', css: "'Lora Variable'" },
  playfair: { nome: 'Playfair Display (elegante)', css: "'Playfair Display Variable'" },
} as const;
export type Fonte = keyof typeof FONTES;

export const SECOES = {
  servicos: 'Serviços',
  sobre: 'Sobre',
  equipe: 'Equipe',
  galeria: 'Galeria',
  depoimentos: 'Depoimentos',
  contato: 'Contato e mapa',
  comoFunciona: 'Como funciona',
  politicas: 'Antes de vir (políticas)',
} as const;
export type Secao = keyof typeof SECOES;

export interface CampoExtra {
  id: string;
  rotulo: string;
  tipo: 'TEXTO' | 'SIM_NAO';
  obrigatorio: boolean;
}

export interface Personalizacao {
  tema: { corPrimaria: string; fonteTitulos: Fonte; fonteTexto: Fonte };
  logoUrl: string | null;
  bannerUrl: string | null;
  textos: { titulo: string; subtitulo: string; chamadaBotao: string; sobre: string; boasVindasAgendamento: string };
  secoes: { id: Secao; visivel: boolean }[];
  galeria: { url: string; legenda: string }[];
  depoimentos: { nome: string; texto: string }[];
  camposExtras: CampoExtra[];
}

export function usePersonalizacao() {
  return useQuery({
    queryKey: ['personalizacao-publica'],
    queryFn: () => api<Personalizacao>('/public/personalizacao', { semRenovar: true }).catch(() => null),
    // Sempre confere ao abrir/voltar para a aba: o que o admin publica aparece na hora
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

// Mistura a cor com preto ou branco (0 a 1) para gerar os tons derivados
function misturar(hex: string, com: '#000000' | '#ffffff', peso: number) {
  const c = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const canal = (i: number) => Math.round(c(hex, i) * (1 - peso) + c(com, i) * peso);
  return `#${[1, 3, 5].map((i) => canal(i).toString(16).padStart(2, '0')).join('')}`;
}

// Tema do site como variáveis CSS (o Tailwind usa essas variáveis nas classes de cor e fonte).
// A cor já chega validada pela API (#RRGGBB com contraste mínimo), então não há como injetar CSS.
export function estiloDoTema(tema: Personalizacao['tema'] | undefined | null): CSSProperties {
  if (!tema || !/^#[0-9a-fA-F]{6}$/.test(tema.corPrimaria)) return {};
  const cor = tema.corPrimaria;
  return {
    '--color-destaque': cor,
    '--color-destaque-forte': misturar(cor, '#000000', 0.2),
    '--color-destaque-claro': misturar(cor, '#ffffff', 0.88),
    '--color-pinho': misturar(cor, '#000000', 0.45),
    '--color-pinho-claro': misturar(cor, '#000000', 0.35),
    '--site-fonte-titulos': FONTES[tema.fonteTitulos]?.css,
    '--site-fonte-texto': FONTES[tema.fonteTexto]?.css,
    fontFamily: `${FONTES[tema.fonteTexto]?.css ?? "'Instrument Sans Variable'"}, system-ui, sans-serif`,
  } as CSSProperties;
}
