import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ticket } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { formatarCentavos } from '../../lib/formato';
import { dataBr, NOME_VOUCHER, regraTexto, unidade, type Programa, type Recompensa, type ResumoCliente } from '../../lib/fidelidade';
import { CartaoFidelidade } from './CartaoFidelidade';
import { Aviso, Botao, Selo, cx } from '../ui';

// RF46: o cliente vê saldo, extrato e vouchers, e troca pontos por recompensa (logado pelo código do e-mail)

interface Dados {
  programa: (Pick<Programa, 'tipo' | 'pontosPorReal' | 'pontosPorAtendimento' | 'validadeDias'> & { servicos: string[] | null }) | null;
  contas: ResumoCliente[];
  recompensas: Recompensa[];
}

export function FidelidadeCliente({ token }: { token: string }) {
  const qc = useQueryClient();
  const auth = { Authorization: `Bearer ${token}` };
  const dados = useQuery({ queryKey: ['minha-fidelidade', token], queryFn: () => api<Dados>('/public/clientes/fidelidade', { headers: auth, semRenovar: true }) });
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [trocando, setTrocando] = useState<string | null>(null);
  const [verExtrato, setVerExtrato] = useState(false);

  if (!dados.data?.programa || !dados.data.contas.length) return null;
  const { programa, recompensas } = dados.data;
  // Mais de um cadastro com o mesmo e-mail é raro; mostra o de maior saldo
  const conta = [...dados.data.contas].sort((a, b) => b.saldo - a.saldo)[0]!;
  const proxima = recompensas.find((r) => r.custoPontos > conta.saldo) ?? recompensas.at(-1) ?? null;
  const vouchers = dados.data.contas.flatMap((c) => c.vouchers).filter((v) => v.status === 'DISPONIVEL');

  async function trocar(r: Recompensa) {
    if (!window.confirm(`Trocar ${unidade(programa!.tipo, r.custoPontos)} por "${r.nome}"?`)) return;
    setAviso(null);
    setTrocando(r.id);
    try {
      const v = await api<{ codigo: string }>('/public/clientes/fidelidade/resgatar', { method: 'POST', body: { recompensaId: r.id }, headers: auth, semRenovar: true });
      setAviso({ tipo: 'sucesso', texto: `Pronto! Seu código é ${v.codigo}. Mostre no atendimento (também mandamos por e-mail).` });
      await qc.invalidateQueries({ queryKey: ['minha-fidelidade', token] });
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof ApiError ? e.message : 'Sem conexão. Tente de novo.' });
    } finally {
      setTrocando(null);
    }
  }

  return (
    <section className="grid gap-4" aria-labelledby="titulo-fidelidade">
      <h2 id="titulo-fidelidade" className="text-lg font-semibold">
        Fidelidade
      </h2>
      <CartaoFidelidade saldo={conta.saldo} tipo={programa.tipo} proxima={proxima && { nome: proxima.nome, custo: proxima.custoPontos }} />
      <p className="text-sm text-tinta-suave">
        {regraTexto(programa)}
        {programa.servicos && ` Vale para: ${programa.servicos.join(', ')}.`}
        {conta.proximoVencimento && ` ${unidade(programa.tipo, conta.proximoVencimento.pontos)} vencem em ${dataBr(conta.proximoVencimento.em)}.`}
      </p>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {vouchers.length > 0 && (
        <ul className="grid gap-2">
          {vouchers.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-dashed border-destaque bg-destaque-claro px-4 py-3">
              <div>
                <p className="font-semibold">{v.recompensa.nome}</p>
                <p className="text-sm text-tinta-suave">Vale até {dataBr(v.expiraEm)}</p>
              </div>
              <p className="flex items-center gap-2 font-mono text-lg font-semibold tracking-widest">
                <Ticket className="size-5 text-destaque" aria-hidden />
                {v.codigo}
              </p>
            </li>
          ))}
        </ul>
      )}

      {recompensas.length > 0 && (
        <ul className="grid divide-y divide-borda rounded-lg border border-borda bg-superficie">
          {recompensas.map((r) => {
            const da = conta.saldo >= r.custoPontos;
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium">{r.nome}</p>
                  <p className="text-sm text-tinta-suave">
                    {unidade(programa.tipo, r.custoPontos)}
                    {r.tipo === 'DESCONTO' && r.valorCentavos ? ` · ${formatarCentavos(r.valorCentavos)} de desconto` : ''}
                  </p>
                </div>
                <Botao variante={da ? 'primario' : 'secundario'} className="h-9" disabled={!da} carregando={trocando === r.id} onClick={() => trocar(r)}>
                  {da ? 'Trocar' : `Faltam ${(r.custoPontos - conta.saldo).toLocaleString('pt-BR')}`}
                </Botao>
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" className="justify-self-start text-sm font-medium text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current" onClick={() => setVerExtrato(!verExtrato)} aria-expanded={verExtrato}>
        {verExtrato ? 'Esconder extrato' : 'Ver extrato'}
      </button>
      {verExtrato && (
        <ul className="grid divide-y divide-borda text-sm">
          {conta.extrato.map((e) => (
            <li key={e.id} className="flex justify-between gap-3 py-2">
              <span>
                {e.descricao}
                <span className="text-tinta-suave"> · {dataBr(e.criadoEm)}</span>
              </span>
              <span className={cx('font-semibold tabular-nums', e.pontos < 0 ? 'text-erro' : 'text-destaque-forte')}>
                {e.pontos > 0 ? '+' : ''}
                {e.pontos.toLocaleString('pt-BR')}
              </span>
            </li>
          ))}
          {dados.data.contas.flatMap((c) => c.vouchers).filter((v) => v.status !== 'DISPONIVEL').map((v) => (
            <li key={v.id} className="flex justify-between gap-3 py-2 text-tinta-suave">
              <span>Voucher {v.recompensa.nome}</span>
              <Selo cor="cinza">{NOME_VOUCHER[v.status]}</Selo>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
