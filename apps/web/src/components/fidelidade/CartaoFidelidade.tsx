import { Check } from 'lucide-react';
import { cx } from '../ui';
import { unidade, type TipoPrograma } from '../../lib/fidelidade';

// Saldo em destaque. No cartão de selos, desenha os selos até a próxima recompensa.
export function CartaoFidelidade({ saldo, tipo, proxima }: { saldo: number; tipo: TipoPrograma; proxima?: { nome: string; custo: number } | null }) {
  const falta = proxima ? Math.max(0, proxima.custo - saldo) : 0;
  return (
    <div className="grid gap-3 rounded-xl border border-borda p-5">
      <p className="text-sm text-tinta-suave">{tipo === 'SELOS' ? 'Seu cartão de selos' : 'Seus pontos'}</p>
      <p className="text-3xl font-semibold tabular-nums">{unidade(tipo, saldo)}</p>
      {tipo === 'SELOS' && proxima && proxima.custo <= 20 && (
        <ol className="flex flex-wrap gap-1.5" aria-label={`${Math.min(saldo, proxima.custo)} de ${proxima.custo} selos`}>
          {Array.from({ length: proxima.custo }, (_, i) => (
            <li key={i} className={cx('grid size-7 place-items-center rounded-full border', i < saldo ? 'border-tinta bg-tinta text-white' : 'border-[#d4d3cf]')}>
              {i < saldo && <Check className="size-3.5" strokeWidth={2} aria-hidden />}
            </li>
          ))}
        </ol>
      )}
      {proxima && (
        <p className="text-sm text-tinta-suave">
          {falta === 0 ? `Já dá para trocar por: ${proxima.nome}` : `Faltam ${unidade(tipo, falta)} para: ${proxima.nome}`}
        </p>
      )}
    </div>
  );
}
