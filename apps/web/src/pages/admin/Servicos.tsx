import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Tags, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { formatarCentavos, formatarDuracao } from '../../lib/formato';
import { useSalvar } from '../../lib/useSalvar';
import { Modal } from '../../components/Modal';
import { EntradaMoeda } from '../../components/EntradaMoeda';
import { AreaTexto, Aviso, Botao, Cabecalho, Campo, Carregando, Entrada, Interruptor, Selecao, Selo } from '../../components/ui';
import { useReautenticacao } from '../../components/Reautenticar';
import { UploadImagem } from '../../components/UploadImagem';
import { NOME_UNIDADE, numeroDoTexto, textoDoNumero, type Produto } from '../../lib/estoque';
import { useAuth } from '../../auth/AuthContext';

// RF12 e RF13

interface Categoria {
  id: string;
  nome: string;
}

interface MembroEquipe {
  funcionarioId: string;
  nome: string;
  ativo: boolean;
  precoCentavos: number | null;
  duracaoMin: number | null;
  comissaoPct: number | null; // RF54: null = padrão do profissional
}

interface Servico {
  id: string;
  nome: string;
  descricao: string | null;
  categoria: Categoria | null;
  duracaoMin: number;
  precoCentavos: number;
  intervaloLimpezaMin: number;
  ativo: boolean;
  fotoUrl: string | null;
  noSite: boolean;
  // RF15: custo da ficha técnica e margem
  custoCentavos: number;
  margemCentavos: number;
  margemPct: number | null;
  temFicha: boolean;
  motivoForaDoSite: string | null; // RF12: por que não aparece em /agendar
  equipe: MembroEquipe[];
  // RF28: sinal próprio
  sinalModo: 'HERDAR' | 'EXIGIR' | 'NAO_EXIGIR';
  sinalTipo: 'FIXO' | 'PERCENTUAL' | null;
  sinalValor: number | null;
  sinalPrazoMin: number | null;
}

interface Funcionario {
  id: string;
  nome: string;
  cargo: string | null;
  ativo: boolean;
  comissaoPadraoPct: number;
}

// RF54: "12,5" → 12.5; vazio = padrão do profissional
function pctDoTexto(t: string): number | null {
  const v = t.trim().replace(',', '.');
  if (!v) return null;
  const n = Math.round(Number(v) * 100) / 100;
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

const DURACOES = [15, 20, 30, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 240, 300, 360];
const LIMPEZAS = [0, 5, 10, 15, 20, 30];

export function Servicos() {
  const qc = useQueryClient();
  const servicos = useQuery({ queryKey: ['servicos'], queryFn: () => api<Servico[]>('/admin/servicos?incluirInativos=true') });
  const [editando, setEditando] = useState<Servico | 'novo' | null>(null);
  const [categoriasAberto, setCategoriasAberto] = useState(false);

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ['servicos'] });
    qc.invalidateQueries({ queryKey: ['progresso-inicial'] });
  };

  return (
    <>
      <Cabecalho
        titulo="Serviços"
        descricao="O que os clientes podem agendar, quanto custa e quem faz."
        acoes={
          <>
            <Botao variante="secundario" onClick={() => setCategoriasAberto(true)}>
              <Tags className="size-4" aria-hidden />
              Categorias
            </Botao>
            <Botao onClick={() => setEditando('novo')}>
              <Plus className="size-4" aria-hidden />
              Novo serviço
            </Botao>
          </>
        }
      />

      {servicos.isLoading ? (
        <Carregando />
      ) : servicos.data?.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-lg border border-dashed border-borda px-6 py-16 text-center">
          <p className="font-semibold">Nenhum serviço cadastrado</p>
          <p className="max-w-sm text-sm text-tinta-suave">Comece pelo serviço mais procurado. Dá para ajustar preço e duração depois.</p>
          <Botao onClick={() => setEditando('novo')}>Criar primeiro serviço</Botao>
        </div>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-borda bg-superficie">
          <table className="w-full text-sm">
            <thead className="border-b border-borda text-left text-tinta-suave">
              <tr>
                <th className="px-4 py-3 font-medium">Serviço</th>
                <th className="px-4 py-3 font-medium">Duração</th>
                <th className="px-4 py-3 font-medium text-right">Preço</th>
                <th className="px-4 py-3 font-medium text-right">Margem</th>
                <th className="px-4 py-3 font-medium">Quem faz</th>
                <th className="px-4 py-3 font-medium">No site</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {servicos.data?.map((s) => (
                <tr key={s.id} className="hover:bg-fundo">
                  <td className="px-4 py-3">
                    <button onClick={() => setEditando(s)} className="text-left font-semibold hover:text-destaque">
                      {s.nome}
                    </button>
                    {s.categoria && <p className="text-tinta-suave">{s.categoria.nome}</p>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatarDuracao(s.duracaoMin)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{formatarCentavos(s.precoCentavos)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {s.temFicha ? (
                      <>
                        <span className={s.margemPct !== null && s.margemPct < 30 ? 'font-semibold text-alerta' : 'font-semibold'}>{(s.margemPct ?? 0).toLocaleString('pt-BR')}%</span>
                        <span className="block text-xs text-tinta-suave">custo {formatarCentavos(s.custoCentavos)}</span>
                      </>
                    ) : (
                      <span className="text-xs text-tinta-suave">sem ficha</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {s.equipe.length ? (
                      s.equipe.map((m) => (
                        <span key={m.funcionarioId} className={m.ativo ? '' : 'text-tinta-suave line-through'}>
                          {m.nome.split(' ')[0]}
                        </span>
                      )).reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, ', ', el] : [el]), [])
                    ) : (
                      <button onClick={() => setEditando(s)} className="text-left">
                        <Selo cor="alerta">Ninguém ainda</Selo>
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {s.noSite ? (
                      <Selo cor="verde">Aparece</Selo>
                    ) : (
                      <div className="grid justify-items-start gap-1">
                        <Selo cor={s.ativo ? 'alerta' : 'cinza'}>Não aparece</Selo>
                        <span className="text-xs text-tinta-suave">{s.motivoForaDoSite}</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal aberto={editando !== null} aoFechar={() => setEditando(null)} titulo={editando === 'novo' ? 'Novo serviço' : 'Editar serviço'} largura="max-w-2xl">
        {editando && <FormServico servico={editando === 'novo' ? null : editando} aoConcluir={() => (setEditando(null), atualizar())} />}
      </Modal>

      <Modal aberto={categoriasAberto} aoFechar={() => setCategoriasAberto(false)} titulo="Categorias">
        <GerenciarCategorias aoMudar={atualizar} />
      </Modal>
    </>
  );
}

function FormServico({ servico, aoConcluir }: { servico: Servico | null; aoConcluir: () => void }) {
  const categorias = useQuery({ queryKey: ['categorias'], queryFn: () => api<Categoria[]>('/admin/servicos/categorias') });
  const funcionarios = useQuery({ queryKey: ['funcionarios'], queryFn: () => api<Funcionario[]>('/admin/funcionarios') });
  const { salvando, erro, campos, executar } = useSalvar();

  const [dados, setDados] = useState({
    nome: servico?.nome ?? '',
    categoriaId: servico?.categoria?.id ?? '',
    descricao: servico?.descricao ?? '',
    duracaoMin: servico?.duracaoMin ?? 60,
    precoCentavos: servico?.precoCentavos ?? null as number | null,
    intervaloLimpezaMin: servico?.intervaloLimpezaMin ?? 0,
    ativo: servico?.ativo ?? true,
    fotoUrl: servico?.fotoUrl ?? null, // RF12
  });
  // RF13: quem executa, com preço/duração próprios opcionais
  const [equipe, setEquipe] = useState<Record<string, { precoCentavos: number | null; duracaoMin: number | null; comissao: string }>>(
    Object.fromEntries(
      (servico?.equipe ?? []).map((m) => [
        m.funcionarioId,
        { precoCentavos: m.precoCentavos, duracaoMin: m.duracaoMin, comissao: m.comissaoPct === null ? '' : String(m.comissaoPct).replace('.', ',') },
      ]),
    ),
  );
  // RF13: serviço novo já vem com todos os profissionais ativos marcados (desmarque quem não faz)
  const [equipeTocada, setEquipeTocada] = useState(Boolean(servico));
  useEffect(() => {
    if (equipeTocada || !funcionarios.data) return;
    setEquipe(Object.fromEntries(funcionarios.data.filter((f) => f.ativo).map((f) => [f.id, { precoCentavos: null, duracaoMin: null, comissao: '' }])));
    setEquipeTocada(true);
  }, [equipeTocada, funcionarios.data]);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  // RF28: sinal do serviço (salvo à parte: pede senha de novo)
  const { pode } = useAuth();
  const reauth = useReautenticacao();
  const sinalInicial = {
    sinalModo: servico?.sinalModo ?? 'HERDAR',
    sinalTipo: servico?.sinalTipo ?? null,
    sinalValor: servico?.sinalValor ?? null,
    sinalPrazoMin: servico?.sinalPrazoMin ?? null,
  };
  const [sinal, setSinal] = useState(sinalInicial);

  // RF14: ficha técnica (produtos por atendimento + custos extras)
  const podeFicha = pode('estoque:ver');
  const produtos = useQuery({ enabled: podeFicha, queryKey: ['produtos'], queryFn: () => api<Produto[]>('/admin/estoque/produtos?incluirInativos=true') });
  const fichaSalva = useQuery({
    enabled: podeFicha && Boolean(servico),
    queryKey: ['ficha', servico?.id],
    queryFn: () => api<{ itens: { produtoId: string; quantidade: number }[]; extras: { descricao: string; valorCentavos: number }[] }>(`/admin/servicos/${servico!.id}/ficha`),
  });
  const [ficha, setFicha] = useState<{ itens: { produtoId: string; quantidade: string }[]; extras: { descricao: string; valorCentavos: number | null }[] } | null>(null);
  useEffect(() => {
    if (ficha) return;
    if (!servico) setFicha({ itens: [], extras: [] });
    else if (fichaSalva.data)
      setFicha({ itens: fichaSalva.data.itens.map((i) => ({ produtoId: i.produtoId, quantidade: textoDoNumero(i.quantidade) })), extras: fichaSalva.data.extras });
  }, [fichaSalva.data, servico, ficha]);
  const fichaParaApi = (f: NonNullable<typeof ficha>) => ({
    itens: f.itens.filter((i) => i.produtoId && numeroDoTexto(i.quantidade)).map((i) => ({ produtoId: i.produtoId, quantidade: numeroDoTexto(i.quantidade)! })),
    extras: f.extras.filter((e) => e.descricao.trim().length >= 2).map((e) => ({ descricao: e.descricao.trim(), valorCentavos: e.valorCentavos ?? 0 })),
  });
  const fichaInicial = fichaSalva.data ? JSON.stringify({ itens: fichaSalva.data.itens.map(({ produtoId, quantidade }) => ({ produtoId, quantidade })), extras: fichaSalva.data.extras.map(({ descricao, valorCentavos }) => ({ descricao, valorCentavos })) }) : JSON.stringify({ itens: [], extras: [] });
  const fichaMudou = ficha !== null && JSON.stringify(fichaParaApi(ficha)) !== fichaInicial;
  const porId = new Map((produtos.data ?? []).map((p) => [p.id, p]));
  const custoFicha = ficha
    ? Math.round(ficha.itens.reduce((t, i) => t + (numeroDoTexto(i.quantidade) ?? 0) * (porId.get(i.produtoId)?.custoMedioCentavos ?? 0), 0)) +
      ficha.extras.reduce((t, e) => t + (e.valorCentavos ?? 0), 0)
    : 0;
  const sinalMudou = JSON.stringify(sinal) !== JSON.stringify(sinalInicial);

  const mudar = <K extends keyof typeof dados>(k: K, v: (typeof dados)[K]) => setDados((d) => ({ ...d, [k]: v }));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const tokenSinal = sinalMudou ? await reauth.pedir('Para mudar o sinal deste serviço') : null;
    if (sinalMudou && !tokenSinal) return;
    const ok = await executar(async () => {
      const corpo = { ...dados, categoriaId: dados.categoriaId || null, precoCentavos: dados.precoCentavos ?? 0 };
      const salvo = servico
        ? await api<Servico>(`/admin/servicos/${servico.id}`, { method: 'PATCH', body: corpo })
        : await api<Servico>('/admin/servicos', { method: 'POST', body: corpo });
      await api(`/admin/servicos/${salvo.id}/equipe`, {
        method: 'PUT',
        body: Object.entries(equipe).map(([funcionarioId, { comissao, ...v }]) => ({ funcionarioId, ...v, comissaoPct: pctDoTexto(comissao) })),
      });
      if (tokenSinal) await api(`/admin/servicos/${salvo.id}/sinal`, { method: 'PUT', body: sinal, headers: { 'X-Reauth-Token': tokenSinal } });
      if (ficha && fichaMudou) await api(`/admin/servicos/${salvo.id}/ficha`, { method: 'PUT', body: fichaParaApi(ficha) });
      return true;
    });
    if (ok) aoConcluir();
  }

  async function excluir() {
    const ok = await executar(() => api(`/admin/servicos/${servico!.id}`, { method: 'DELETE' }).then(() => true));
    if (ok) aoConcluir();
  }

  return (
    <>
    <form onSubmit={salvar} className="grid gap-5">
      {erro && <Aviso>{erro}</Aviso>}

      <Campo rotulo="Nome" erro={campos.nome}>
        {(id) => <Entrada id={id} required maxLength={120} value={dados.nome} onChange={(e) => mudar('nome', e.target.value)} invalido={Boolean(campos.nome)} autoFocus />}
      </Campo>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Preço" erro={campos.precoCentavos}>
          {(id) => <EntradaMoeda id={id} valor={dados.precoCentavos} aoMudar={(v) => mudar('precoCentavos', v)} invalido={Boolean(campos.precoCentavos)} placeholder="R$ 0,00" />}
        </Campo>
        <Campo rotulo="Categoria">
          {(id) => (
            <Selecao id={id} value={dados.categoriaId} onChange={(e) => mudar('categoriaId', e.target.value)}>
              <option value="">Sem categoria</option>
              {categorias.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo="Duração" erro={campos.duracaoMin}>
          {(id) => (
            <Selecao id={id} value={dados.duracaoMin} onChange={(e) => mudar('duracaoMin', Number(e.target.value))}>
              {[...new Set([...DURACOES, dados.duracaoMin])].sort((a, b) => a - b).map((d) => (
                <option key={d} value={d}>
                  {formatarDuracao(d)}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo="Intervalo depois" dica="Tempo para limpar e preparar antes do próximo cliente.">
          {(id, desc) => (
            <Selecao id={id} aria-describedby={desc} value={dados.intervaloLimpezaMin} onChange={(e) => mudar('intervaloLimpezaMin', Number(e.target.value))}>
              {[...new Set([...LIMPEZAS, dados.intervaloLimpezaMin])].sort((a, b) => a - b).map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? 'Nenhum' : formatarDuracao(d)}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
      </div>

      <Campo rotulo="Descrição" dica="Aparece para o cliente ao escolher o serviço." erro={campos.descricao}>
        {(id, desc) => <AreaTexto id={id} aria-describedby={desc} maxLength={2000} value={dados.descricao} onChange={(e) => mudar('descricao', e.target.value)} />}
      </Campo>

      <UploadImagem finalidade="SERVICO" rotulo="Foto do serviço" formato="aspect-[4/3]" valor={dados.fotoUrl} aoMudar={(url) => mudar('fotoUrl', url)} dica="Aparece no site. JPG, PNG ou WebP, até 5 MB." />

      <Interruptor ligado={dados.ativo} aoMudar={(v) => mudar('ativo', v)} rotulo={dados.ativo ? 'Disponível para agendar' : 'Fora do ar (não aparece para clientes)'} />

      <fieldset className="grid gap-3 border-t border-borda pt-5">
        <legend className="font-semibold">Quem faz este serviço</legend>
        <p className="text-sm text-tinta-suave -mt-1">Deixe preço e duração em branco para usar os do serviço, e a comissão em branco para usar a padrão do profissional.</p>
        {funcionarios.isLoading ? (
          <Carregando />
        ) : funcionarios.data?.length === 0 ? (
          <Aviso tipo="alerta">Nenhum profissional cadastrado ainda. Cadastre em Equipe → Novo profissional.</Aviso>
        ) : (
          <ul className="grid divide-y divide-borda rounded-lg border border-borda">
            {funcionarios.data?.map((f) => {
              const marcado = f.id in equipe;
              return (
                <li key={f.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_120px_152px_112px] sm:items-center">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-destaque size-4"
                      checked={marcado}
                      onChange={(e) =>
                        setEquipe((eq) => {
                          const novo = { ...eq };
                          if (e.target.checked) novo[f.id] = { precoCentavos: null, duracaoMin: null, comissao: '' };
                          else delete novo[f.id];
                          return novo;
                        })
                      }
                    />
                    <span className="font-medium">{f.nome}</span>
                    {!f.ativo && <Selo cor="cinza">Desativado</Selo>}
                  </label>
                  {marcado && (
                    <>
                      <EntradaMoeda
                        aria-label={`Preço de ${f.nome}`}
                        placeholder="Preço próprio"
                        valor={equipe[f.id]!.precoCentavos}
                        aoMudar={(v) => setEquipe((eq) => ({ ...eq, [f.id]: { ...eq[f.id]!, precoCentavos: v } }))}
                      />
                      <Selecao
                        aria-label={`Duração de ${f.nome}`}
                        value={equipe[f.id]!.duracaoMin ?? ''}
                        onChange={(e) => setEquipe((eq) => ({ ...eq, [f.id]: { ...eq[f.id]!, duracaoMin: e.target.value ? Number(e.target.value) : null } }))}
                      >
                        <option value="">Duração padrão</option>
                        {DURACOES.map((d) => (
                          <option key={d} value={d}>
                            {formatarDuracao(d)}
                          </option>
                        ))}
                      </Selecao>
                      {/* RF54: comissão deste profissional neste serviço */}
                      <div className="relative">
                        <Entrada
                          aria-label={`Comissão de ${f.nome} neste serviço, em %`}
                          inputMode="decimal"
                          maxLength={6}
                          className="pr-7"
                          placeholder={`${String(f.comissaoPadraoPct ?? 0).replace('.', ',')} (padrão)`}
                          value={equipe[f.id]!.comissao}
                          onChange={(e) => setEquipe((eq) => ({ ...eq, [f.id]: { ...eq[f.id]!, comissao: e.target.value.replace(/[^\d,.]/g, '') } }))}
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-tinta-suave" aria-hidden>
                          %
                        </span>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      {podeFicha && ficha && (
        <fieldset className="grid gap-3 border-t border-borda pt-5">
          <legend className="font-semibold">Ficha técnica</legend>
          <p className="-mt-1 text-sm text-tinta-suave">O que um atendimento gasta. Ao concluir, a baixa no estoque sai sozinha.</p>
          {!produtos.data?.length ? (
            <Aviso tipo="alerta">Cadastre os produtos em Estoque para montar a ficha.</Aviso>
          ) : (
            <ul className="grid gap-2">
              {ficha.itens.map((item, idx) => {
                const p = porId.get(item.produtoId);
                return (
                  <li key={idx} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                    <Selecao
                      aria-label="Produto"
                      value={item.produtoId}
                      onChange={(e) => setFicha({ ...ficha, itens: ficha.itens.map((x, j) => (j === idx ? { ...x, produtoId: e.target.value } : x)) })}
                    >
                      <option value="">Escolha o produto</option>
                      {produtos.data
                        .filter((pr) => (pr.ativo && !ficha.itens.some((x, j) => j !== idx && x.produtoId === pr.id)) || pr.id === item.produtoId)
                        .map((pr) => (
                          <option key={pr.id} value={pr.id}>
                            {pr.nome}
                          </option>
                        ))}
                    </Selecao>
                    <div className="flex items-center gap-1.5">
                      <Entrada
                        aria-label="Quantidade por atendimento"
                        inputMode="decimal"
                        className="w-24"
                        value={item.quantidade}
                        onChange={(e) => setFicha({ ...ficha, itens: ficha.itens.map((x, j) => (j === idx ? { ...x, quantidade: e.target.value } : x)) })}
                      />
                      <span className="w-6 text-sm text-tinta-suave">{p ? NOME_UNIDADE[p.unidade] : ''}</span>
                    </div>
                    <button
                      type="button"
                      aria-label="Tirar da ficha"
                      className="rounded p-2 text-tinta-suave hover:text-erro"
                      onClick={() => setFicha({ ...ficha, itens: ficha.itens.filter((_, j) => j !== idx) })}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {ficha.extras.map((ex, idx) => (
            <div key={`ex${idx}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
              <Entrada
                aria-label="Descrição do custo extra"
                placeholder="Ex.: descartáveis"
                maxLength={80}
                value={ex.descricao}
                onChange={(e) => setFicha({ ...ficha, extras: ficha.extras.map((x, j) => (j === idx ? { ...x, descricao: e.target.value } : x)) })}
              />
              <div className="w-[7.5rem]">
                <EntradaMoeda aria-label="Valor do custo extra" valor={ex.valorCentavos} aoMudar={(v) => setFicha({ ...ficha, extras: ficha.extras.map((x, j) => (j === idx ? { ...x, valorCentavos: v } : x)) })} />
              </div>
              <button type="button" aria-label="Tirar custo extra" className="rounded p-2 text-tinta-suave hover:text-erro" onClick={() => setFicha({ ...ficha, extras: ficha.extras.filter((_, j) => j !== idx) })}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {Boolean(produtos.data?.length) && (
              <Botao type="button" variante="secundario" className="h-9" onClick={() => setFicha({ ...ficha, itens: [...ficha.itens, { produtoId: '', quantidade: '' }] })}>
                <Plus className="size-4" aria-hidden />
                Produto
              </Botao>
            )}
            <Botao type="button" variante="secundario" className="h-9" onClick={() => setFicha({ ...ficha, extras: [...ficha.extras, { descricao: '', valorCentavos: null }] })}>
              <Plus className="size-4" aria-hidden />
              Custo extra
            </Botao>
          </div>
          {(ficha.itens.length > 0 || ficha.extras.length > 0) && (
            <p className="rounded-md bg-fundo px-3 py-2 text-sm">
              Custo por atendimento: <strong>{formatarCentavos(custoFicha)}</strong>
              {dados.precoCentavos ? (
                <>
                  {' '}
                  · margem <strong>{formatarCentavos(dados.precoCentavos - custoFicha)}</strong> ({(Math.round(((dados.precoCentavos - custoFicha) / dados.precoCentavos) * 1000) / 10).toLocaleString('pt-BR')}%)
                </>
              ) : null}
            </p>
          )}
        </fieldset>
      )}

      {pode('sinal:gerenciar') && (
        <fieldset className="grid gap-3 border-t border-borda pt-5">
          <legend className="font-semibold">Sinal</legend>
          <Selecao aria-label="Regra do sinal" value={sinal.sinalModo} onChange={(e) => setSinal({ ...sinal, sinalModo: e.target.value as Servico['sinalModo'] })}>
            <option value="HERDAR">Seguir a regra geral (Sinal e Pix)</option>
            <option value="EXIGIR">Sempre cobrar sinal neste serviço</option>
            <option value="NAO_EXIGIR">Nunca cobrar sinal neste serviço</option>
          </Selecao>
          {sinal.sinalModo === 'EXIGIR' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Selecao
                aria-label="Tipo do sinal"
                value={sinal.sinalTipo ?? ''}
                onChange={(e) => {
                  const t = (e.target.value || null) as Servico['sinalTipo'];
                  setSinal({ ...sinal, sinalTipo: t, sinalValor: t === 'PERCENTUAL' ? 3000 : t === 'FIXO' ? 2000 : null });
                }}
              >
                <option value="">Valor da regra geral</option>
                <option value="PERCENTUAL">Porcentagem</option>
                <option value="FIXO">Valor fixo</option>
              </Selecao>
              {sinal.sinalTipo === 'PERCENTUAL' && (
                <div className="flex items-center gap-2">
                  <Entrada
                    aria-label="Porcentagem do sinal"
                    type="number"
                    min={1}
                    max={100}
                    value={(sinal.sinalValor ?? 0) / 100}
                    onChange={(e) => setSinal({ ...sinal, sinalValor: Math.round(Number(e.target.value) * 100) })}
                  />
                  <span className="text-tinta-suave">%</span>
                </div>
              )}
              {sinal.sinalTipo === 'FIXO' && (
                <EntradaMoeda aria-label="Valor do sinal" valor={sinal.sinalValor} aoMudar={(v) => setSinal({ ...sinal, sinalValor: v })} />
              )}
              <Selecao
                aria-label="Prazo para pagar"
                value={sinal.sinalPrazoMin ?? ''}
                onChange={(e) => setSinal({ ...sinal, sinalPrazoMin: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Prazo da regra geral</option>
                {[10, 15, 30, 60, 120, 240, 1440].map((m) => (
                  <option key={m} value={m}>
                    Pagar em {m < 60 ? `${m} min` : `${m / 60} h`}
                  </option>
                ))}
              </Selecao>
            </div>
          )}
          {sinalMudou && <p className="text-sm text-tinta-suave">Ao salvar, vamos pedir sua senha de novo (mexe com dinheiro).</p>}
        </fieldset>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borda pt-5">
        {servico ? (
          confirmarExclusao ? (
            <div className="flex items-center gap-2 text-sm">
              <span>Excluir este serviço?</span>
              <Botao type="button" variante="perigo" onClick={excluir} carregando={salvando}>
                Excluir
              </Botao>
              <Botao type="button" variante="fantasma" onClick={() => setConfirmarExclusao(false)}>
                Cancelar
              </Botao>
            </div>
          ) : (
            <Botao type="button" variante="fantasma" onClick={() => setConfirmarExclusao(true)}>
              <Trash2 className="size-4" aria-hidden />
              Excluir serviço
            </Botao>
          )
        ) : (
          <span />
        )}
        <Botao type="submit" carregando={salvando}>
          {servico ? 'Salvar alterações' : 'Criar serviço'}
        </Botao>
      </div>
    </form>
    {reauth.modal}
    </>
  );
}

function GerenciarCategorias({ aoMudar }: { aoMudar: () => void }) {
  const qc = useQueryClient();
  const categorias = useQuery({ queryKey: ['categorias'], queryFn: () => api<Categoria[]>('/admin/servicos/categorias') });
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = () => {
    qc.invalidateQueries({ queryKey: ['categorias'] });
    aoMudar();
  };

  async function criar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const nome = String(new FormData(form).get('nome') ?? '');
    setErro(null);
    try {
      await api('/admin/servicos/categorias', { method: 'POST', body: { nome } });
      form.reset();
      recarregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Sem conexão com o servidor.');
    }
  }

  async function remover(id: string) {
    await api(`/admin/servicos/categorias/${id}`, { method: 'DELETE' });
    recarregar();
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-tinta-suave">Agrupam os serviços na página do cliente. Ao excluir uma categoria, os serviços dela ficam sem categoria.</p>
      {erro && <Aviso>{erro}</Aviso>}
      <form onSubmit={criar} className="flex gap-2">
        <Entrada name="nome" required minLength={2} maxLength={60} placeholder="Ex.: Unhas" aria-label="Nova categoria" />
        <Botao type="submit">Adicionar</Botao>
      </form>
      <ul className="grid divide-y divide-borda rounded-lg border border-borda">
        {categorias.data?.length === 0 && <li className="px-4 py-3 text-sm text-tinta-suave">Nenhuma categoria ainda.</li>}
        {categorias.data?.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-2">
            <span>{c.nome}</span>
            <button onClick={() => remover(c.id)} className="rounded p-1 text-tinta-suave hover:text-erro" aria-label={`Excluir ${c.nome}`}>
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
