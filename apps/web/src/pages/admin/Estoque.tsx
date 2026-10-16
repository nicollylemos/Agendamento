import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, History, Package, Pencil, Plus, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { formatarCentavos } from '../../lib/formato';
import { useSalvar } from '../../lib/useSalvar';
import { useAuth } from '../../auth/AuthContext';
import {
  formatarCustoUnitario,
  formatarQuantidade,
  NOME_UNIDADE,
  numeroDoTexto,
  textoDoNumero,
  UNIDADE_LONGA,
  type Produto,
  type Unidade,
} from '../../lib/estoque';
import { Modal } from '../../components/Modal';
import { EntradaMoeda } from '../../components/EntradaMoeda';
import { Aviso, Botao, Cabecalho, Campo, Carregando, cx, Entrada, Interruptor, Selecao, Selo } from '../../components/ui';

// RF38 (produtos), RF39 (movimentações), RF41 (alertas), RF42 (custo médio)

type Acao =
  | { tipo: 'produto'; produto: Produto | null }
  | { tipo: 'entrada' | 'baixa' | 'ajuste' | 'historico'; produto: Produto };

interface Movimento {
  id: string;
  tipo: 'ENTRADA' | 'SAIDA' | 'AJUSTE' | 'PERDA' | 'CONSUMO';
  quantidade: number;
  custoUnitarioCentavos: number;
  saldoApos: number;
  motivo: string | null;
  usuario: string | null;
  atendimento: string | null;
  criadoEm: string;
}

const NOME_MOVIMENTO: Record<Movimento['tipo'], string> = {
  ENTRADA: 'Entrada',
  SAIDA: 'Saída',
  AJUSTE: 'Inventário',
  PERDA: 'Perda',
  CONSUMO: 'Atendimento',
};

const dataCurta = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR');

export function Estoque() {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const editar = pode('estoque:editar');
  const [busca, setBusca] = useState('');
  const [soAlertas, setSoAlertas] = useState(false);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const produtos = useQuery({ queryKey: ['produtos'], queryFn: () => api<Produto[]>('/admin/estoque/produtos?incluirInativos=true') });
  const atualizar = (texto?: string) => {
    setAcao(null);
    if (texto) setAviso(texto);
    ['produtos', 'estoque-alertas', 'servicos'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const todos = produtos.data ?? [];
  const termo = busca.trim().toLowerCase();
  const lista = todos.filter(
    (p) =>
      (!soAlertas || p.abaixoDoMinimo || p.vencido || p.venceEmBreve) &&
      (!termo || [p.nome, p.sku, p.categoria].some((x) => x?.toLowerCase().includes(termo))),
  );
  const ativos = todos.filter((p) => p.ativo);
  const valorTotal = ativos.reduce((t, p) => t + p.valorEmEstoqueCentavos, 0);
  const abaixo = ativos.filter((p) => p.abaixoDoMinimo).length;
  const validade = ativos.filter((p) => p.vencido || p.venceEmBreve).length;

  return (
    <>
      <Cabecalho
        titulo="Estoque"
        descricao="Produtos, compras e o que cada atendimento gasta."
        acoes={
          editar && (
            <Botao onClick={() => setAcao({ tipo: 'produto', produto: null })}>
              <Plus className="size-4" aria-hidden />
              Novo produto
            </Botao>
          )
        }
      />

      {aviso && (
        <div className="mb-6">
          <Aviso tipo="sucesso">{aviso}</Aviso>
        </div>
      )}

      {produtos.isLoading ? (
        <Carregando />
      ) : !todos.length ? (
        <div className="grid place-items-center gap-3 rounded-lg border border-dashed border-borda px-6 py-16 text-center">
          <Package className="size-8 text-tinta-suave" aria-hidden />
          <p className="font-semibold">Nenhum produto cadastrado</p>
          <p className="max-w-sm text-sm text-tinta-suave">Cadastre o que você usa nos atendimentos. Depois, diga em cada serviço quanto ele gasta e a baixa sai sozinha.</p>
          {editar && <Botao onClick={() => setAcao({ tipo: 'produto', produto: null })}>Cadastrar primeiro produto</Botao>}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Resumo rotulo="Valor em estoque" valor={formatarCentavos(valorTotal)} dica="pelo custo médio" />
            <Resumo rotulo="Abaixo do mínimo" valor={String(abaixo)} alerta={abaixo > 0} dica={abaixo ? 'precisam de reposição' : 'tudo certo'} />
            <Resumo rotulo="Validade" valor={String(validade)} alerta={validade > 0} dica={validade ? 'vencidos ou vencendo em 30 dias' : 'nada vencendo'} />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="relative min-w-56 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-tinta-suave" aria-hidden />
              <Entrada aria-label="Buscar produto" placeholder="Buscar por nome, SKU ou categoria" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <Interruptor ligado={soAlertas} aoMudar={setSoAlertas} rotulo="Só o que precisa de atenção" />
          </div>

          {!lista.length ? (
            <p className="py-8 text-center text-sm text-tinta-suave">Nenhum produto encontrado.</p>
          ) : (
            <div className="relative overflow-x-auto rounded-lg border border-borda bg-superficie">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-borda text-left text-tinta-suave">
                  <tr>
                    <th className="px-4 py-3 font-medium">Produto</th>
                    <th className="px-4 py-3 text-right font-medium">Em estoque</th>
                    <th className="px-4 py-3 font-medium">Custo médio</th>
                    <th className="px-4 py-3 font-medium">Validade</th>
                    <th className="px-4 py-3">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borda">
                  {lista.map((p) => (
                    <tr key={p.id} className={cx(!p.ativo && 'text-tinta-suave')}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{p.nome}</p>
                        <p className="text-xs text-tinta-suave">{[p.categoria, p.sku && `SKU ${p.sku}`, !p.ativo && 'inativo'].filter(Boolean).join(' · ') || '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <p className={cx('font-semibold tabular-nums', (p.abaixoDoMinimo || p.semEstoque) && 'text-erro')}>{formatarQuantidade(p.estoqueAtual, p.unidade)}</p>
                        <p className="text-xs text-tinta-suave">mín. {formatarQuantidade(p.estoqueMinimo, p.unidade)}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums">{p.custoMedioCentavos ? formatarCustoUnitario(p.custoMedioCentavos, p.unidade) : '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {p.validade ? (
                          <div className="grid justify-items-start gap-1">
                            <span>{dataCurta(p.validade)}</span>
                            {p.vencido && <Selo cor="alerta">Vencido</Selo>}
                            {p.venceEmBreve && <Selo cor="alerta">{p.diasParaVencer === 0 ? 'Vence hoje' : `Vence em ${p.diasParaVencer} d`}</Selo>}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          {editar && p.ativo && (
                            <>
                              <BotaoIcone rotulo="Entrada" onClick={() => setAcao({ tipo: 'entrada', produto: p })}>
                                <ArrowDownToLine className="size-4" />
                              </BotaoIcone>
                              <BotaoIcone rotulo="Baixa" onClick={() => setAcao({ tipo: 'baixa', produto: p })}>
                                <ArrowUpFromLine className="size-4" />
                              </BotaoIcone>
                              <BotaoIcone rotulo="Inventário" onClick={() => setAcao({ tipo: 'ajuste', produto: p })}>
                                <ClipboardCheck className="size-4" />
                              </BotaoIcone>
                            </>
                          )}
                          <BotaoIcone rotulo="Histórico" onClick={() => setAcao({ tipo: 'historico', produto: p })}>
                            <History className="size-4" />
                          </BotaoIcone>
                          {editar && (
                            <BotaoIcone rotulo="Editar" onClick={() => setAcao({ tipo: 'produto', produto: p })}>
                              <Pencil className="size-4" />
                            </BotaoIcone>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Modal aberto={acao?.tipo === 'produto'} aoFechar={() => setAcao(null)} titulo={acao?.tipo === 'produto' && acao.produto ? 'Editar produto' : 'Novo produto'}>
        {acao?.tipo === 'produto' && <FormProduto produto={acao.produto} aoConcluir={atualizar} />}
      </Modal>
      <Modal aberto={acao?.tipo === 'entrada'} aoFechar={() => setAcao(null)} titulo="Entrada (compra)">
        {acao?.tipo === 'entrada' && <FormEntrada produto={acao.produto} aoConcluir={atualizar} />}
      </Modal>
      <Modal aberto={acao?.tipo === 'baixa'} aoFechar={() => setAcao(null)} titulo="Baixa manual">
        {acao?.tipo === 'baixa' && <FormBaixa produto={acao.produto} aoConcluir={atualizar} />}
      </Modal>
      <Modal aberto={acao?.tipo === 'ajuste'} aoFechar={() => setAcao(null)} titulo="Inventário">
        {acao?.tipo === 'ajuste' && <FormAjuste produto={acao.produto} aoConcluir={atualizar} />}
      </Modal>
      <Modal aberto={acao?.tipo === 'historico'} aoFechar={() => setAcao(null)} titulo={acao?.tipo === 'historico' ? `Histórico: ${acao.produto.nome}` : ''} largura="max-w-2xl">
        {acao?.tipo === 'historico' && <Historico produto={acao.produto} />}
      </Modal>
    </>
  );
}

function Resumo({ rotulo, valor, dica, alerta }: { rotulo: string; valor: string; dica: string; alerta?: boolean }) {
  return (
    <div className={cx('rounded-lg border px-4 py-3', alerta ? 'border-alerta/30 bg-alerta-claro' : 'border-borda bg-superficie')}>
      <p className={cx('flex items-center gap-1.5 text-sm', alerta ? 'text-alerta' : 'text-tinta-suave')}>
        {alerta && <AlertTriangle className="size-4" aria-hidden />}
        {rotulo}
      </p>
      <p className="text-2xl font-semibold tabular-nums">{valor}</p>
      <p className="text-xs text-tinta-suave">{dica}</p>
    </div>
  );
}

function BotaoIcone({ rotulo, onClick, children }: { rotulo: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={rotulo} aria-label={rotulo} className="grid size-9 place-items-center rounded-md text-tinta-suave hover:bg-fundo hover:text-tinta">
      {children}
    </button>
  );
}

// Campo de quantidade com a unidade do lado (aceita vírgula)
function CampoQuantidade({
  rotulo,
  unidade,
  valor,
  aoMudar,
  erro,
  dica,
  obrigatorio = true,
}: {
  rotulo: string;
  unidade: Unidade;
  valor: string;
  aoMudar: (v: string) => void;
  erro?: string;
  dica?: string;
  obrigatorio?: boolean;
}) {
  return (
    <Campo rotulo={rotulo} erro={erro} dica={dica}>
      {(id, desc) => (
        <div className="flex items-center gap-2">
          <Entrada id={id} aria-describedby={desc} inputMode="decimal" required={obrigatorio} className="w-36" value={valor} onChange={(e) => aoMudar(e.target.value)} />
          <span className="text-tinta-suave">{NOME_UNIDADE[unidade]}</span>
        </div>
      )}
    </Campo>
  );
}

function FormProduto({ produto, aoConcluir }: { produto: Produto | null; aoConcluir: (texto: string) => void }) {
  const { salvando, erro, campos, executar } = useSalvar();
  const [d, setD] = useState({
    nome: produto?.nome ?? '',
    unidade: produto?.unidade ?? ('ML' as Unidade),
    sku: produto?.sku ?? '',
    categoria: produto?.categoria ?? '',
    fornecedor: produto?.fornecedor ?? '',
    validade: produto?.validade ?? '',
    estoqueMinimo: textoDoNumero(produto?.estoqueMinimo ?? 0),
    ativo: produto?.ativo ?? true,
    estoqueInicial: '',
    custoInicial: null as number | null,
  });
  const set = (p: Partial<typeof d>) => setD({ ...d, ...p });

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const comum = {
      nome: d.nome,
      sku: d.sku,
      categoria: d.categoria,
      fornecedor: d.fornecedor,
      validade: d.validade || null,
      estoqueMinimo: numeroDoTexto(d.estoqueMinimo) ?? 0,
    };
    const inicial = numeroDoTexto(d.estoqueInicial);
    const ok = await executar(() =>
      (produto
        ? api(`/admin/estoque/produtos/${produto.id}`, { method: 'PATCH', body: { ...comum, ativo: d.ativo } })
        : api('/admin/estoque/produtos', {
            method: 'POST',
            body: { ...comum, unidade: d.unidade, ...(inicial && { estoqueInicial: inicial, custoTotalInicialCentavos: d.custoInicial ?? 0 }) },
          })
      ).then(() => true),
    );
    if (ok) aoConcluir(produto ? 'Produto salvo.' : `${d.nome} cadastrado.`);
  }

  return (
    <form onSubmit={salvar} className="grid gap-5">
      {erro && <Aviso>{erro}</Aviso>}
      <Campo rotulo="Nome" erro={campos.nome}>
        {(id) => <Entrada id={id} required minLength={2} maxLength={120} autoFocus value={d.nome} onChange={(e) => set({ nome: e.target.value })} placeholder="Ex.: Shampoo neutro 1 L" />}
      </Campo>
      <div className="grid gap-5 sm:grid-cols-2">
        <Campo rotulo="Controlar em" dica={produto ? 'Não muda depois de criado.' : 'Como você mede o gasto em cada atendimento.'}>
          {(id, desc) => (
            <Selecao id={id} aria-describedby={desc} disabled={Boolean(produto)} value={d.unidade} onChange={(e) => set({ unidade: e.target.value as Unidade })}>
              {(Object.keys(UNIDADE_LONGA) as Unidade[]).map((u) => (
                <option key={u} value={u}>
                  {UNIDADE_LONGA[u]}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <CampoQuantidade
          rotulo="Estoque mínimo"
          unidade={d.unidade}
          valor={d.estoqueMinimo}
          aoMudar={(v) => set({ estoqueMinimo: v })}
          erro={campos.estoqueMinimo}
          dica="Abaixo disso, avisamos por e-mail."
          obrigatorio={false}
        />
        <Campo rotulo="Categoria" erro={campos.categoria}>
          {(id) => <Entrada id={id} maxLength={60} value={d.categoria} onChange={(e) => set({ categoria: e.target.value })} placeholder="Ex.: Cabelo" />}
        </Campo>
        <Campo rotulo="SKU / código" erro={campos.sku}>
          {(id) => <Entrada id={id} maxLength={60} value={d.sku} onChange={(e) => set({ sku: e.target.value })} />}
        </Campo>
        <Campo rotulo="Fornecedor" erro={campos.fornecedor}>
          {(id) => <Entrada id={id} maxLength={120} value={d.fornecedor} onChange={(e) => set({ fornecedor: e.target.value })} />}
        </Campo>
        <Campo rotulo="Validade" erro={campos.validade}>
          {(id) => <Entrada id={id} type="date" value={d.validade} onChange={(e) => set({ validade: e.target.value })} />}
        </Campo>
      </div>

      {!produto ? (
        <fieldset className="grid gap-4 border-t border-borda pt-5">
          <legend className="font-semibold">Estoque inicial (opcional)</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <CampoQuantidade rotulo="Quantidade que tem hoje" unidade={d.unidade} valor={d.estoqueInicial} aoMudar={(v) => set({ estoqueInicial: v })} obrigatorio={false} />
            <Campo rotulo="Quanto pagou por essa quantidade" dica="Vira o custo médio do produto.">
              {(id, desc) => <EntradaMoeda id={id} aria-describedby={desc} valor={d.custoInicial} aoMudar={(v) => set({ custoInicial: v })} placeholder="R$ 0,00" />}
            </Campo>
          </div>
        </fieldset>
      ) : (
        <Interruptor ligado={d.ativo} aoMudar={(v) => set({ ativo: v })} rotulo={d.ativo ? 'Em uso' : 'Inativo (some das listas)'} />
      )}

      <Botao type="submit" carregando={salvando}>
        {produto ? 'Salvar' : 'Cadastrar produto'}
      </Botao>
    </form>
  );
}

// RF39, RF42: compra. Informa o total pago; o sistema calcula o custo por unidade e a média.
function FormEntrada({ produto, aoConcluir }: { produto: Produto; aoConcluir: (texto: string) => void }) {
  const { salvando, erro, campos, executar } = useSalvar();
  const [quantidade, setQuantidade] = useState('');
  const [total, setTotal] = useState<number | null>(null);
  const [validade, setValidade] = useState('');
  const [motivo, setMotivo] = useState('');
  const q = numeroDoTexto(quantidade);
  const unitario = q && total ? total / q : null;
  const saldo = Math.max(0, produto.estoqueAtual);
  const novoMedio = unitario && q ? (saldo <= 0 ? unitario : (saldo * produto.custoMedioCentavos + total!) / (saldo + q)) : null;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const ok = await executar(() =>
      api('/admin/estoque/movimentos', {
        method: 'POST',
        body: { tipo: 'ENTRADA', produtoId: produto.id, quantidade: q, custoTotalCentavos: total ?? 0, validade: validade || undefined, motivo },
      }).then(() => true),
    );
    if (ok) aoConcluir(`Entrada de ${formatarQuantidade(q!, produto.unidade)} em ${produto.nome}.`);
  }

  return (
    <form onSubmit={salvar} className="grid gap-5">
      <p className="text-sm text-tinta-suave">
        {produto.nome}: hoje {formatarQuantidade(produto.estoqueAtual, produto.unidade)}
      </p>
      {erro && <Aviso>{erro}</Aviso>}
      <div className="grid gap-5 sm:grid-cols-2">
        <CampoQuantidade rotulo="Quantidade comprada" unidade={produto.unidade} valor={quantidade} aoMudar={setQuantidade} erro={campos.quantidade} />
        <Campo rotulo="Valor total pago" erro={campos.custoTotalCentavos}>
          {(id) => <EntradaMoeda id={id} valor={total} aoMudar={setTotal} placeholder="R$ 0,00" />}
        </Campo>
      </div>
      {unitario !== null && novoMedio !== null && (
        <p className="rounded-md bg-fundo px-3 py-2 text-sm">
          Esta compra: {formatarCustoUnitario(unitario, produto.unidade)} · novo custo médio: <strong>{formatarCustoUnitario(novoMedio, produto.unidade)}</strong>
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <Campo rotulo="Validade deste lote (opcional)">{(id) => <Entrada id={id} type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />}</Campo>
        <Campo rotulo="Observação (opcional)">{(id) => <Entrada id={id} maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: nota 1234" />}</Campo>
      </div>
      <Botao type="submit" carregando={salvando} disabled={!q || total === null}>
        Lançar entrada
      </Botao>
    </form>
  );
}

function FormBaixa({ produto, aoConcluir }: { produto: Produto; aoConcluir: (texto: string) => void }) {
  const { salvando, erro, campos, executar } = useSalvar();
  const [tipo, setTipo] = useState<'SAIDA' | 'PERDA'>('PERDA');
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState('');
  const q = numeroDoTexto(quantidade);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const ok = await executar(() => api('/admin/estoque/movimentos', { method: 'POST', body: { tipo, produtoId: produto.id, quantidade: q, motivo } }).then(() => true));
    if (ok) aoConcluir(`Baixa de ${formatarQuantidade(q!, produto.unidade)} em ${produto.nome}.`);
  }

  return (
    <form onSubmit={salvar} className="grid gap-5">
      <p className="text-sm text-tinta-suave">
        {produto.nome}: hoje {formatarQuantidade(produto.estoqueAtual, produto.unidade)}. A baixa dos atendimentos é automática; use aqui para o resto.
      </p>
      {erro && <Aviso>{erro}</Aviso>}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de baixa">
        {(
          [
            ['PERDA', 'Perda (venceu, quebrou)'],
            ['SAIDA', 'Saída (uso interno, devolução)'],
          ] as const
        ).map(([t, rotulo]) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={tipo === t}
            onClick={() => setTipo(t)}
            className={cx('h-10 rounded-md border px-3 text-sm font-medium', tipo === t ? 'border-destaque bg-destaque-claro text-destaque-forte' : 'border-borda text-tinta-suave hover:text-tinta')}
          >
            {rotulo}
          </button>
        ))}
      </div>
      <CampoQuantidade rotulo="Quantidade" unidade={produto.unidade} valor={quantidade} aoMudar={setQuantidade} erro={campos.quantidade} />
      <Campo rotulo="Motivo" erro={campos.motivo}>
        {(id) => <Entrada id={id} required minLength={3} maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      </Campo>
      <Botao type="submit" carregando={salvando} disabled={!q}>
        Dar baixa
      </Botao>
    </form>
  );
}

function FormAjuste({ produto, aoConcluir }: { produto: Produto; aoConcluir: (texto: string) => void }) {
  const { salvando, erro, campos, executar } = useSalvar();
  const [contado, setContado] = useState('');
  const [motivo, setMotivo] = useState('Contagem de estoque');
  const n = numeroDoTexto(contado);
  const diferenca = n === null ? null : n - produto.estoqueAtual;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const ok = await executar(() => api('/admin/estoque/movimentos', { method: 'POST', body: { tipo: 'AJUSTE', produtoId: produto.id, saldoContado: n, motivo } }).then(() => true));
    if (ok) aoConcluir(`${produto.nome} ajustado para ${formatarQuantidade(n!, produto.unidade)}.`);
  }

  return (
    <form onSubmit={salvar} className="grid gap-5">
      <p className="text-sm text-tinta-suave">
        O sistema diz que há {formatarQuantidade(produto.estoqueAtual, produto.unidade)}. Conte o que tem de verdade e informe abaixo.
      </p>
      {erro && <Aviso>{erro}</Aviso>}
      <CampoQuantidade rotulo="Quantidade contada" unidade={produto.unidade} valor={contado} aoMudar={setContado} erro={campos.saldoContado} />
      {diferenca !== null && diferenca !== 0 && (
        <p className={cx('rounded-md px-3 py-2 text-sm', diferenca < 0 ? 'bg-erro-claro text-erro' : 'bg-destaque-claro text-destaque-forte')}>
          Diferença: {diferenca > 0 ? '+' : ''}
          {formatarQuantidade(diferenca, produto.unidade)}
        </p>
      )}
      <Campo rotulo="Motivo" erro={campos.motivo}>
        {(id) => <Entrada id={id} required minLength={3} maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      </Campo>
      <Botao type="submit" carregando={salvando} disabled={n === null || diferenca === 0}>
        Salvar inventário
      </Botao>
    </form>
  );
}

function Historico({ produto }: { produto: Produto }) {
  const h = useQuery({ queryKey: ['movimentos', produto.id], queryFn: () => api<Movimento[]>(`/admin/estoque/produtos/${produto.id}/movimentos`) });
  if (h.isLoading) return <Carregando />;
  if (!h.data?.length) return <p className="text-sm text-tinta-suave">Nenhuma movimentação ainda.</p>;
  return (
    <ul className="grid divide-y divide-borda">
      {h.data.map((m) => (
        <li key={m.id} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 py-3 text-sm">
          <p className="font-medium">
            {NOME_MOVIMENTO[m.tipo]}
            <span className="font-normal text-tinta-suave"> · {new Date(m.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </p>
          <p className={cx('text-right font-semibold tabular-nums', m.quantidade < 0 ? 'text-erro' : 'text-destaque-forte')}>
            {m.quantidade > 0 ? '+' : ''}
            {formatarQuantidade(m.quantidade, produto.unidade)}
          </p>
          <p className="text-tinta-suave">{[m.atendimento, m.motivo, m.usuario && `por ${m.usuario}`].filter(Boolean).join(' · ')}</p>
          <p className="text-right text-tinta-suave tabular-nums">saldo {formatarQuantidade(m.saldoApos, produto.unidade)}</p>
        </li>
      ))}
    </ul>
  );
}
