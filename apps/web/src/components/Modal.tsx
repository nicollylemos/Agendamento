import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

// Usa o <dialog> nativo: foco preso dentro, Esc fecha e leitores de tela entendem.
export function Modal({
  aberto,
  aoFechar,
  titulo,
  children,
  largura = 'max-w-lg',
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  children: ReactNode;
  largura?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Fechamento vindo do estado (ex.: trocar de um modal para outro) não chama aoFechar,
  // senão ele apagaria o próximo modal que acabou de abrir.
  const fechandoPeloEstado = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) {
      fechandoPeloEstado.current = true;
      d.close();
    }
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      onClose={() => {
        if (fechandoPeloEstado.current) fechandoPeloEstado.current = false;
        else aoFechar();
      }}
      className={`w-[calc(100%-2rem)] ${largura} m-auto rounded-xl border border-borda bg-superficie p-0 text-tinta shadow-[0_24px_60px_-20px_rgba(20,22,22,0.25)] backdrop:bg-[#26292a]/25 backdrop:backdrop-blur-[2px]`}
    >
      {aberto && (
        <div className="flex flex-col max-h-[85vh]">
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <h2 className="text-lg font-medium">{titulo}</h2>
            <button onClick={aoFechar} className="rounded p-1 text-tinta-suave hover:text-tinta" aria-label="Fechar">
              <X className="size-5" strokeWidth={1.5} />
            </button>
          </div>
          <div className="overflow-y-auto px-6 pb-6">{children}</div>
        </div>
      )}
    </dialog>
  );
}
