import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { api } from '../lib/api';
import { estiloDoTema, usePersonalizacao } from '../lib/site';

export interface EmpresaPublica {
  nome: string;
  whatsapp: string | null;
  telefone: string | null;
  instagram: string | null;
  politicaCancelamento: string | null;
  politicaAtraso: string | null;
  endereco: { logradouro: string | null; numero: string | null; bairro: string | null; cidade: string | null; uf: string | null };
}

export function useEmpresa() {
  return useQuery({
    queryKey: ['empresa-publica'],
    queryFn: () => api<EmpresaPublica>('/public/empresa', { semRenovar: true }).catch(() => null),
    staleTime: 5 * 60_000,
  });
}

export function linkWhatsapp(numero: string) {
  const digitos = numero.replace(/\D/g, '');
  return `https://wa.me/${digitos.length <= 11 ? `55${digitos}` : digitos}`;
}

// Páginas do cliente: cabeçalho com o nome do negócio e o contato
export function LayoutPublico({ children }: { children: ReactNode }) {
  const { data: empresa } = useEmpresa();
  const { data: p } = usePersonalizacao();
  const contato = empresa?.whatsapp ?? empresa?.telefone;

  // RF07: o mesmo visual do site (cores, fontes e logo publicados)
  return (
    <div className="min-h-dvh" style={estiloDoTema(p?.tema)}>
      <header className="border-b border-borda bg-superficie">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 h-16">
          <Link to="/" className="flex min-w-0 items-center gap-2.5">
            {p?.logoUrl && <img src={p.logoUrl} alt="" className="size-9 rounded object-contain" />}
            <span className="truncate font-titulo text-[1.0625rem] font-semibold text-tinta">{empresa?.nome ?? 'Agendamento'}</span>
          </Link>
          {contato && (
            <a
              href={linkWhatsapp(contato)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current"
            >
              <MessageCircle className="size-4" aria-hidden />
              Falar com a gente
            </a>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">{children}</main>
      <footer className="mx-auto max-w-2xl px-4 pb-10 text-sm text-tinta-suave">
        <Link to="/meus-agendamentos" className="underline decoration-[#c9c8c3] underline-offset-4 hover:text-tinta hover:decoration-current">
          Ver meus agendamentos
        </Link>
      </footer>
    </div>
  );
}
