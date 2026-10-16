import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { BarChart3, Building2, Images, CalendarDays, Clock, Gift, Home, LogOut, Menu, Package, Palette, QrCode, Scissors, UserCircle, Users, X, type LucideIcon } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { cx } from '../components/ui';
import { Marca } from '../components/Marca';
import { NOME_PERFIL } from '../lib/formato';

interface Item {
  para: string;
  rotulo: string;
  icone: LucideIcon;
  permissao?: string; // 'a|b' = basta uma
  fim?: boolean;
}

// Menu em três grupos: o que se usa todo dia, o que organiza o negócio e o que se configura uma vez
const GRUPOS: { titulo: string | null; itens: Item[] }[] = [
  {
    titulo: null,
    itens: [
      { para: '/painel', rotulo: 'Início', icone: Home, fim: true },
      { para: '/painel/agenda', rotulo: 'Agenda', icone: CalendarDays, permissao: 'agenda:ver_propria' },
      { para: '/painel/meus-horarios', rotulo: 'Meus horários', icone: Clock, permissao: 'agenda:ver_propria' },
    ],
  },
  {
    titulo: 'Negócio',
    itens: [
      { para: '/painel/servicos', rotulo: 'Serviços', icone: Scissors, permissao: 'servicos:gerenciar' },
      { para: '/painel/equipe', rotulo: 'Equipe', icone: Users, permissao: 'usuarios:gerenciar' },
      { para: '/painel/horarios', rotulo: 'Horários da equipe', icone: Clock, permissao: 'horarios:gerenciar' },
      { para: '/painel/estoque', rotulo: 'Estoque', icone: Package, permissao: 'estoque:ver' },
      { para: '/painel/fidelidade', rotulo: 'Fidelidade', icone: Gift, permissao: 'fidelidade:gerenciar' },
      { para: '/painel/instagram', rotulo: 'Instagram', icone: Images, permissao: 'marketing:gerenciar' },
      { para: '/painel/relatorios', rotulo: 'Relatórios', icone: BarChart3, permissao: 'relatorios:ver|relatorios:ver_proprios' }, // RF47–RF55
    ],
  },
  {
    titulo: 'Configurações',
    itens: [
      { para: '/painel/empresa', rotulo: 'Empresa', icone: Building2, permissao: 'empresa:gerenciar' },
      { para: '/painel/site', rotulo: 'Site', icone: Palette, permissao: 'empresa:gerenciar' },
      { para: '/painel/pagamentos', rotulo: 'Sinal e Pix', icone: QrCode, permissao: 'sinal:gerenciar' },
      { para: '/painel/conta', rotulo: 'Minha conta', icone: UserCircle },
    ],
  },
];

export function LayoutPainel() {
  const { usuario, pode, sair } = useAuth();
  const [menuAberto, setMenuAberto] = useState(false);
  const permitido = (i: Item) => !i.permissao || i.permissao.split('|').some(pode);

  const menu = (
    <nav className="flex h-full flex-col" aria-label="Menu do painel">
      <div className="flex h-16 items-center px-6">
        <Marca />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-6">
        {GRUPOS.map((g) => {
          const itens = g.itens.filter(permitido);
          if (!itens.length) return null;
          return (
            <div key={g.titulo ?? 'principal'} className="mt-6 first:mt-2">
              {g.titulo && <p className="mb-1.5 px-3 text-xs text-tinta-suave">{g.titulo}</p>}
              <ul className="grid gap-px">
                {itens.map((i) => (
                  <li key={i.para}>
                    <NavLink
                      to={i.para}
                      end={i.fim}
                      onClick={() => setMenuAberto(false)}
                      className={({ isActive }) =>
                        cx(
                          'flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
                          isActive ? 'bg-fundo font-medium text-tinta' : 'text-tinta-suave hover:bg-fundo/70 hover:text-tinta',
                        )
                      }
                    >
                      <i.icone className="size-4" strokeWidth={1.6} aria-hidden />
                      {i.rotulo}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-borda px-6 py-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{usuario?.nome}</p>
          <p className="text-xs text-tinta-suave">{usuario && NOME_PERFIL[usuario.perfil]}</p>
        </div>
        <button onClick={sair} title="Sair" className="rounded-lg p-2 text-tinta-suave transition-colors hover:bg-fundo hover:text-tinta">
          <LogOut className="size-4" strokeWidth={1.6} aria-hidden />
          <span className="sr-only">Sair</span>
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-borda lg:block">{menu}</aside>

      {/* Celular: barra no topo e menu deslizante */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-borda bg-superficie/95 px-4 backdrop-blur lg:hidden">
        <Marca />
        <button onClick={() => setMenuAberto(true)} aria-label="Abrir menu" className="rounded-lg p-2 text-tinta hover:bg-fundo">
          <Menu className="size-5" strokeWidth={1.6} />
        </button>
      </div>
      {menuAberto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-[#26292a]/25" onClick={() => setMenuAberto(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-borda bg-superficie">
            <button onClick={() => setMenuAberto(false)} aria-label="Fechar menu" className="absolute right-3 top-3.5 rounded-lg p-2 text-tinta-suave hover:bg-fundo">
              <X className="size-5" strokeWidth={1.6} />
            </button>
            {menu}
          </aside>
        </div>
      )}

      <main className="px-4 py-8 sm:px-8 lg:px-14 lg:py-14">
        <div className="max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
