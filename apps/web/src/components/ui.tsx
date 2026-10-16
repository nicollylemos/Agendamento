import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

type Variante = 'primario' | 'secundario' | 'perigo' | 'fantasma';

const estilosBotao: Record<Variante, string> = {
  primario: 'bg-destaque text-white hover:bg-destaque/85',
  secundario: 'bg-superficie text-tinta border border-[#dddcd8] hover:border-[#c9c8c3] hover:bg-fundo',
  perigo: 'bg-superficie text-erro border border-[#dddcd8] hover:border-erro/40 hover:bg-erro-claro',
  fantasma: 'text-tinta-suave hover:text-tinta hover:bg-fundo',
};

export const Botao = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; carregando?: boolean }
>(({ variante = 'primario', carregando, disabled, className, children, ...props }, ref) => (
  <button
    ref={ref}
    disabled={disabled || carregando}
    className={cx(
      'inline-flex items-center justify-center gap-2 rounded-lg px-4 h-10 text-sm font-medium transition-colors',
      'disabled:opacity-60 disabled:cursor-not-allowed',
      estilosBotao[variante],
      className,
    )}
    {...props}
  >
    {carregando && <Loader2 className="size-4 animate-spin" aria-hidden />}
    {children}
  </button>
));

interface CampoProps {
  rotulo: string;
  erro?: string;
  dica?: string;
  children: (id: string, descricao: string | undefined) => ReactNode;
  className?: string;
}

export function Campo({ rotulo, erro, dica, children, className }: CampoProps) {
  const id = useId();
  const descId = erro || dica ? `${id}-desc` : undefined;
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-tinta">
        {rotulo}
      </label>
      {children(id, descId)}
      {(erro || dica) && (
        <p id={descId} className={cx('text-sm [overflow-wrap:anywhere]', erro ? 'text-erro' : 'text-tinta-suave')}>
          {erro ?? dica}
        </p>
      )}
    </div>
  );
}

const baseEntrada =
  'w-full rounded-lg border bg-superficie px-3 text-base sm:text-sm placeholder:text-tinta-suave/60 transition-colors hover:border-tinta-suave focus-visible:border-tinta focus-visible:outline-1 focus-visible:outline-offset-0 disabled:bg-fundo disabled:text-tinta-suave';

// Largura própria (w-28, w-auto...) substitui o w-full: no Tailwind as duas classes juntas
// brigam e quem ganha é a ordem do CSS, não a ordem no className.
const comLargura = (base: string, className?: string) =>
  className && /(^|\s)w-/.test(className) ? base.replace('w-full ', '') : base;

export const Entrada = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalido?: boolean }>(
  ({ invalido, className, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalido || undefined}
      className={cx(comLargura(baseEntrada, className), 'h-10', invalido ? 'border-erro' : 'border-borda-campo', className)}
      {...props}
    />
  ),
);

export const AreaTexto = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalido?: boolean }>(
  ({ invalido, className, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalido || undefined}
      className={cx(baseEntrada, 'py-2 min-h-24', invalido ? 'border-erro' : 'border-borda-campo', className)}
      {...props}
    />
  ),
);

export const Selecao = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalido?: boolean }>(
  ({ invalido, className, ...props }, ref) => (
    <select
      ref={ref}
      aria-invalid={invalido || undefined}
      className={cx(comLargura(baseEntrada, className), 'h-10', invalido ? 'border-erro' : 'border-borda-campo', className)}
      {...props}
    />
  ),
);

// Aviso discreto: fundo branco, linha fina; a cor fica só no ícone (e no texto do erro)
export function Aviso({ tipo = 'erro', children }: { tipo?: 'erro' | 'sucesso' | 'alerta'; children: ReactNode }) {
  const estilos = {
    erro: 'border-erro/25 bg-erro-claro/60 text-erro',
    sucesso: 'border-borda bg-superficie text-tinta',
    alerta: 'border-borda bg-superficie text-tinta',
  };
  const icone = { erro: 'text-erro', sucesso: 'text-ok', alerta: 'text-alerta' };
  const Icone = tipo === 'sucesso' ? CheckCircle2 : AlertCircle;
  return (
    <div role={tipo === 'erro' ? 'alert' : 'status'} className={cx('flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm', estilos[tipo])}>
      <Icone className={cx('mt-0.5 size-4 shrink-0', icone[tipo])} strokeWidth={1.75} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-tinta-suave py-8" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {texto}
    </div>
  );
}

export function Cabecalho({ titulo, descricao, acoes }: { titulo: string; descricao?: string; acoes?: ReactNode }) {
  return (
    <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-xl">
        <h1 className="text-[1.75rem] font-semibold leading-tight">{titulo}</h1>
        {descricao && <p className="mt-2 text-[0.9375rem] text-tinta-suave">{descricao}</p>}
      </div>
      {acoes && <div className="flex gap-2">{acoes}</div>}
    </header>
  );
}

export function Secao({ titulo, descricao, children }: { titulo: string; descricao?: string; children: ReactNode }) {
  return (
    // grid-cols-1 (= minmax(0, 1fr)): sem isso, um conteúdo largo estica a coluna e a página rola de lado no celular (RNF06)
    <section className="grid grid-cols-1 gap-6 py-8 border-t border-borda first:border-t-0 first:pt-0 md:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <h2 className="font-medium">{titulo}</h2>
        {descricao && <p className="mt-1.5 text-sm leading-relaxed text-tinta-suave">{descricao}</p>}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4">{children}</div>
    </section>
  );
}

// Situação: pílula neutra com um pontinho de cor (a cor nunca é a única pista: o texto diz)
export function Selo({ cor = 'neutro', children }: { cor?: 'neutro' | 'verde' | 'cinza' | 'alerta'; children: ReactNode }) {
  const ponto = { neutro: 'bg-tinta', verde: 'bg-ok', cinza: null, alerta: 'bg-alerta' }[cor];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border border-borda px-2 py-0.5 text-xs font-medium',
        cor === 'cinza' ? 'text-tinta-suave' : 'text-tinta',
      )}
    >
      {ponto && <span className={cx('size-1.5 rounded-full', ponto)} aria-hidden />}
      {children}
    </span>
  );
}

export function Interruptor({
  ligado,
  aoMudar,
  rotulo,
  disabled,
}: {
  ligado: boolean;
  aoMudar: (v: boolean) => void;
  rotulo: string;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-3 cursor-pointer select-none">
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={ligado}
        disabled={disabled}
        onChange={(e) => aoMudar(e.target.checked)}
      />
      <span
        aria-hidden
        className={cx(
          'relative h-6 w-10 rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-tinta',
          ligado ? 'bg-tinta' : 'bg-[#d9d8d4]',
        )}
      >
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform', ligado ? 'translate-x-4.5' : 'translate-x-0.5')} />
      </span>
      <span className="text-sm">{rotulo}</span>
    </label>
  );
}
