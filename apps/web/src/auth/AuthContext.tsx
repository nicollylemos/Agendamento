import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { aoMudarSessao, encerrarSessao, renovarSessao, type UsuarioSessao } from '../lib/api';

type Estado = { status: 'carregando' } | { status: 'anonimo' } | { status: 'autenticado'; usuario: UsuarioSessao };

interface Contexto {
  estado: Estado;
  usuario: UsuarioSessao | null;
  sair: () => Promise<void>;
  pode: (permissao: string) => boolean;
}

const AuthContext = createContext<Contexto | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ status: 'carregando' });

  useEffect(() => {
    const parar = aoMudarSessao((u) => setEstado(u ? { status: 'autenticado', usuario: u } : { status: 'anonimo' }));
    // Ao abrir a página, tenta recuperar a sessão pelo cookie
    renovarSessao().then((ok) => {
      if (!ok) setEstado((e) => (e.status === 'carregando' ? { status: 'anonimo' } : e));
    });
    return () => {
      parar();
    };
  }, []);

  const usuario = estado.status === 'autenticado' ? estado.usuario : null;

  return (
    <AuthContext.Provider
      value={{
        estado,
        usuario,
        sair: encerrarSessao,
        // Só para esconder botões. Quem barra de verdade é a API (9.2).
        pode: (p) => Boolean(usuario?.permissoes.includes(p)),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
