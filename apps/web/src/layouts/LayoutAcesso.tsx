import type { ReactNode } from 'react';
import { Marca } from '../components/Marca';

// Tela estreita para login, convite e senha
export function LayoutAcesso({ titulo, descricao, children }: { titulo: string; descricao?: string; children: ReactNode }) {
  return (
    <main className="min-h-dvh grid place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Marca className="mb-14" />
        <h1 className="text-[1.75rem] font-semibold leading-tight">{titulo}</h1>
        {descricao && <p className="mt-2 text-[0.9375rem] leading-relaxed text-tinta-suave">{descricao}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}
