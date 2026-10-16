import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { api, ApiError, baixarArquivo } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useReautenticacao } from '../../components/Reautenticar';
import { CartaoGrafico } from '../../components/relatorios/Graficos';
import { Aviso, Botao, Cabecalho, Carregando, cx, Entrada, Selecao } from '../../components/ui';
import { formatar, periodoDo, PRESETS, presetDe, TIPOS, type Preset, type Relatorio, type Tabela, type TipoRelatorio } from '../../lib/relatorios';

// Fase 10: relatórios (RF47–RF54) e exportação em CSV/PDF (RF55).
// Admin e gerente veem tudo; o profissional vê só a própria produção (9.2, a API é que garante).

export function Relatorios() {
  const { pode } = useAuth();
  const gestao = pode('relatorios:ver');
  const base = gestao ? '/admin/relatorios' : '/staff/relatorios';
  const tipos = TIPOS.filter((t) => gestao || t.proprio);

  const [params, setParams] = useSearchParams();
  const padrao = periodoDo('mes');
  const tipo = (tipos.find((t) => t.tipo === params.get('tipo'))?.tipo ?? tipos[0]!.tipo) as TipoRelatorio;
  const de = params.get('de') ?? padrao.de;
  const ate = params.get('ate') ?? padrao.ate;
  const prof = gestao ? (params.get('prof') ?? '') : '';
  const info = TIPOS.find((t) => t.tipo === tipo)!;
  const [personalizado, setPersonalizado] = useState(() => presetDe(de, ate) === null);

  const mudar = (novo: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(novo)) {
          if (v) n.set(k, v);
          else n.delete(k);
        }
        return n;
      },
      { replace: true },
    );

  const filtro = new URLSearchParams({ de, ate, ...(prof && info.porProfissional && { funcionarioId: prof }) });
  const periodoValido = /^\d{4}-\d{2}-\d{2}$/.test(de) && /^\d{4}-\d{2}-\d{2}$/.test(ate) && de <= ate;

  const relatorio = useQuery({
    queryKey: ['relatorio', base, tipo, filtro.toString()],
    queryFn: () => api<Relatorio>(`${base}/${tipo}?${filtro}`),
    enabled: periodoValido,
    placeholderData: keepPreviousData, // ao trocar o filtro, mantém o anterior esmaecido (sem pulo de layout)
    retry: false,
  });
  const profissionais = useQuery({
    queryKey: ['relatorio-profissionais'],
    queryFn: () => api<{ id: string; nome: string; ativo: boolean }[]>('/admin/relatorios/profissionais'),
    enabled: gestao,
  });

  // RF55: exportar pede a senha de novo (9.1) e fica registrado na auditoria (9.7)
  const reauth = useReautenticacao();
  const [exportando, setExportando] = useState<'csv' | 'pdf' | null>(null);
  const [erroExportar, setErroExportar] = useState<string | null>(null);
  async function exportar(formato: 'csv' | 'pdf') {
    setErroExportar(null);
    const token = await reauth.pedir('Para exportar o relatório');
    if (!token) return;
    setExportando(formato);
    try {
      await baixarArquivo(`${base}/${tipo}/exportar?${filtro}&formato=${formato}`, { 'X-Reauth-Token': token });
    } catch (e) {
      setErroExportar(e instanceof ApiError ? e.message : 'Sem conexão com o servidor.');
    } finally {
      setExportando(null);
    }
  }

  const preset = personalizado ? 'personalizado' : (presetDe(de, ate) ?? 'personalizado');
  const r = relatorio.data;

  return (
    <>
      <Cabecalho
        titulo="Relatórios"
        descricao={gestao ? 'Números do negócio por período. Exporte em planilha (CSV) ou PDF.' : 'Sua produção, ocupação e comissões por período.'}
        acoes={
          <>
            <Botao variante="secundario" onClick={() => exportar('csv')} carregando={exportando === 'csv'} disabled={!r || exportando !== null}>
              <FileSpreadsheet className="size-4" strokeWidth={1.6} aria-hidden />
              CSV
            </Botao>
            <Botao variante="secundario" onClick={() => exportar('pdf')} carregando={exportando === 'pdf'} disabled={!r || exportando !== null}>
              <FileDown className="size-4" strokeWidth={1.6} aria-hidden />
              PDF
            </Botao>
          </>
        }
      />

      {/* Tipos de relatório: mesmas abas sublinhadas do resto do painel */}
      <div className="relative mb-8 overflow-x-auto border-b border-borda">
        <div role="tablist" aria-label="Relatório" className="flex w-max gap-1">
          {tipos.map((t) => (
            <button
              key={t.tipo}
              role="tab"
              type="button"
              aria-selected={t.tipo === tipo}
              onClick={() => mudar({ tipo: t.tipo })}
              className={cx(
                '-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                t.tipo === tipo ? 'border-tinta text-tinta' : 'border-transparent text-tinta-suave hover:text-tinta',
              )}
            >
              {t.rotulo}
            </button>
          ))}
        </div>
      </div>

      {/* Filtros: uma linha só, acima de tudo que eles afetam */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Período</span>
          <Selecao
            className="w-48"
            value={preset}
            onChange={(e) => {
              if (e.target.value === 'personalizado') return setPersonalizado(true);
              setPersonalizado(false);
              mudar(periodoDo(e.target.value as Preset));
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.rotulo}
              </option>
            ))}
            <option value="personalizado">Personalizado…</option>
          </Selecao>
        </label>
        {preset === 'personalizado' && (
          <>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">De</span>
              <Entrada type="date" className="w-40" value={de} max={ate} onChange={(e) => e.target.value && mudar({ de: e.target.value })} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Até</span>
              <Entrada type="date" className="w-40" value={ate} min={de} onChange={(e) => e.target.value && mudar({ ate: e.target.value })} />
            </label>
          </>
        )}
        {gestao && info.porProfissional && (
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Profissional</span>
            <Selecao className="w-52" value={prof} onChange={(e) => mudar({ prof: e.target.value || null })}>
              <option value="">Toda a equipe</option>
              {profissionais.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                  {!p.ativo && ' (desativado)'}
                </option>
              ))}
            </Selecao>
          </label>
        )}
      </div>

      {reauth.modal}
      {erroExportar && (
        <div className="mb-4">
          <Aviso>{erroExportar}</Aviso>
        </div>
      )}
      {!periodoValido && <Aviso tipo="alerta">Escolha uma data inicial antes da final.</Aviso>}
      {relatorio.error && (
        <Aviso>{relatorio.error instanceof ApiError ? relatorio.error.message : 'Sem conexão com o servidor.'}</Aviso>
      )}
      {relatorio.isLoading && <Carregando texto="Montando o relatório…" />}

      {r && (
        <div className={cx('grid gap-6 transition-opacity', relatorio.isFetching && 'opacity-60')} aria-busy={relatorio.isFetching}>
          <p className="max-w-2xl text-sm leading-relaxed text-tinta-suave">
            <span>
              {r.descricao}
              {r.profissional && <strong className="text-tinta"> Profissional: {r.profissional}.</strong>}
            </span>
          </p>

          {/* Números principais: sem caixas, só uma linha fina por cima */}
          <dl className={cx('grid grid-cols-2 gap-x-6 gap-y-6', r.indicadores.length >= 5 ? 'lg:grid-cols-5' : r.indicadores.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
            {r.indicadores.map((i, n) => (
              <div key={i.id} className="min-w-0 border-t border-borda pt-4">
                <dt className="truncate text-sm text-tinta-suave" title={i.rotulo}>
                  {i.rotulo}
                </dt>
                <dd className={cx('mt-1.5 truncate font-semibold tabular-nums tracking-[-0.02em]', n === 0 ? 'text-[2rem] leading-none' : 'text-2xl leading-none')}>
                  {formatar(i.valor, i.formato)}
                </dd>
                {i.ajuda && <dd className="mt-2 text-xs text-tinta-suave">{i.ajuda}</dd>}
              </div>
            ))}
          </dl>

          {r.graficos.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-2">
              {r.graficos.map((g) => (
                <div key={`${r.tipo}-${g.id}`} className={cx('min-w-0', (g.tipo !== 'barras' || r.graficos.filter((x) => x.tipo === 'barras').length < 2) && 'lg:col-span-2')}>
                  <CartaoGrafico grafico={g} />
                </div>
              ))}
            </div>
          )}

          {r.tabelas.map((t) => (
            <TabelaRelatorio key={`${r.tipo}-${t.id}`} tabela={t} />
          ))}
        </div>
      )}
    </>
  );
}

function TabelaRelatorio({ tabela: t }: { tabela: Tabela }) {
  const direita = (f: string) => f !== 'texto' && f !== 'data';
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-borda bg-superficie">
      <h3 className="px-5 pt-4 pb-3 font-medium">{t.titulo}</h3>
      {t.linhas.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-tinta-suave">{t.vazio}</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-borda text-tinta-suave">
                {t.colunas.map((c) => (
                  <th key={c.id} scope="col" className={cx('whitespace-nowrap px-4 py-2.5 font-normal first:pl-5 last:pr-5', direita(c.formato) ? 'text-right' : 'text-left')}>
                    {c.rotulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {t.linhas.map((l, i) => (
                <tr key={i} className="hover:bg-fundo/70">
                  {t.colunas.map((c, ci) => (
                    <td
                      key={c.id}
                      className={cx(
                        'px-4 py-2.5 first:pl-5 last:pr-5',
                        direita(c.formato) ? 'whitespace-nowrap text-right tabular-nums' : 'min-w-36',
                        ci === 0 && 'font-medium',
                      )}
                    >
                      {formatar(l[c.id], c.formato)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {t.total && (
              <tfoot>
                <tr className="border-t border-[#d9d8d4] font-medium">
                  {t.colunas.map((c) => (
                    <td key={c.id} className={cx('px-4 py-2.5 first:pl-5 last:pr-5', direita(c.formato) && 'whitespace-nowrap text-right tabular-nums')}>
                      {t.total![c.id] === undefined ? '' : formatar(t.total![c.id], c.formato)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {t.limitada && <p className="border-t border-borda px-5 py-2.5 text-xs text-tinta-suave">Mostrando as primeiras {t.linhas.length} linhas. O arquivo exportado também.</p>}
    </section>
  );
}
