// Marca do sistema: uma folha de agenda com o canto dobrado, em grafite, e o nome.
export function Marca({ className }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 text-[0.9375rem] font-semibold text-tinta ${className ?? ''}`}>
      <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
        <path d="M2 2h12v8l-4 4H2z" fill="currentColor" />
        <path d="M10 14v-4h4" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      Agendamento
    </span>
  );
}
