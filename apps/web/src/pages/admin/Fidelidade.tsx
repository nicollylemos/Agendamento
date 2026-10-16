import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Pencil, Plus, Search, Ticket, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { formatarCentavos } from '../../lib/formato';
import { useSalvar } from '../../lib/useSalvar';
import {
  dataBr,
  NOME_TIPO_RECOMPENSA,
  NOME_VOUCHER,
  regraTexto,
  unidade,
  type Programa,
  type Recompensa,
  type ResumoCliente,
  type TipoRecompensa,
  type Voucher,
} from '../../lib/fidelidade';
import { Modal } from '../../components/Modal';
import { EntradaMoeda } from '../../components/EntradaMoeda';
import { CartaoFidelidade } from '../../components/fidelidade/CartaoFidelidade';
import { AreaTexto, Aviso, Botao, Cabecalho, Campo, Carregando, cx, Entrada, Interruptor, Secao, Selecao, Selo } from '../../components/ui';

// RF43 (programa), RF44 (recompensas e vouchers), RF45 (pontos ao concluir), RF46 (saldo, extrato, ajuste)

interface ClienteBusca {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
  saldo: number;
}

interface ServicoOpcao {
  id: string;
  nome: string;
}

const ABAS = [
  { id: 'clientes', rotulo: 'Clientes' },
  { id: 'recompensas', rotulo: 'Recompensas' },
  { id: 'programa', rotulo: 'Programa' },
] as const;

const telefone = (t: string) => t.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');

export function Fidelidade() {
  const programa = useQuery({ queryKey: ['fidelidade-programa'], queryFn: () => api<Programa>('/admin/fidelidade/programa') });
  const [aba, setAba] = useState<(typeof ABAS)[number]['id']>('clientes');
  useEffect(() => {
    if (programa.data && !programa.data.ativo) setAba('programa');
  }, [programa.data]);

  return (
    <>
      <Cabecalho titulo="Fidelidade" descricao={programa.data?.ativo ? regraTexto(programa.data) : 'Recompense quem volta. Configure o programa para começar.'} />
      <div role="tablist" className="mb-8 flex gap-1 overflow-x-auto border-b border-borda">
        {ABAS.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => setAba(a.id)}
            className={cx('-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium', aba === a.id ? 'border-destaque' : 'border-transparent text-tinta-suave hover:text-tinta')}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      {programa.isLoading ? (
        <Carregando />
      ) : aba === 'clientes' ? (
        <Clientes programa={programa.data!} />
      ) : aba === 'recompensas' ? (
        <Recompensas programa={programa.data!} />
      ) : (
        <FormPrograma programa={programa.data!} />
      )}
    </>
  );
}

// ─── RF43 ────────────────────────────────────────────────

function FormPrograma({ programa }: { programa: Programa }) {
  const qc = useQueryClient();
  const servicos = useQuery({ queryKey: ['servicos'], queryFn: () => api<ServicoOpcao[]>('/admin/servicos') });
  const { salvando, erro, campos, salvo, executar } = useSalvar();
  const [d, setD] = useState(programa);
  const [todos, setTodos] = useState(programa.servicosElegiveis.length === 0);
  const set = (p: Partial<Programa>) => setD({ ...d, ...p });

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const ok = await executar(() => api('/admin/fidelidade/programa', { method: 'PUT', body: { ...d, servicosElegiveis: todos ? [] : d.servicosElegiveis } }).then(() => true));
    if (ok) qc.invalidateQueries({ queryKey: ['fidelidade-programa'] });
  }

  return (
    <form onSubmit={salvar} className="grid max-w-2xl grid-cols-1 gap-6">
      {erro && <Aviso>{erro}</Aviso>}
      {salvo && <Aviso tipo="sucesso">Programa salvo.</Aviso>}
      <Interruptor ligado={d.ativo} aoMudar={(v) => set({ ativo: v })} rotulo={d.ativo ? 'Programa ligado' : 'Programa desligado'} />

      <fieldset className="grid gap-3">
        <legend className="mb-2 font-semibold">Como o cliente ganha</legend>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
          {(
            [
              ['PONTOS', 'Pontos', 'Por real gasto e/ou por visita. Troca por recompensas de valores diferentes.'],
              ['SELOS', 'Cartão de selos', '1 selo por atendimento. Ex.: 10 cortes = 1 grátis.'],
            ] as const
          ).map(([t, rotulo, desc]) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={d.tipo === t}
              onClick={() => set({ tipo: t })}
              className={cx('grid gap-1 rounded-lg border p-4 text-left', d.tipo === t ? 'border-destaque bg-destaque-claro' : 'border-borda bg-superficie hover:border-destaque')}
            >
              <span className="font-semibold">{rotulo}</span>
              <span className="text-sm text-tinta-suave">{desc}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {d.tipo === 'PONTOS' && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo rotulo="Pontos a cada R$ 1 gasto" erro={campos.pontosPorReal}>
            {(id) => <Entrada id={id} type="number" min={0} max={100} className="w-28" value={d.pontosPorReal} onChange={(e) => set({ pontosPorReal: Number(e.target.value) })} />}
          </Campo>
          <Campo rotulo="Bônus por visita" erro={campos.pontosPorAtendimento}>
            {(id) => (
              <Entrada id={id} type="number" min={0} max={10000} className="w-28" value={d.pontosPorAtendimento} onChange={(e) => set({ pontosPorAtendimento: Number(e.target.value) })} />
            )}
          </Campo>
        </div>
      )}

      <Campo rotulo="Validade" dica="Pontos e selos vencem depois desse tempo. Quem gasta usa primeiro os que vencem antes.">
        {(id, desc) => (
          <Selecao id={id} aria-describedby={desc} value={d.validadeDias ?? ''} onChange={(e) => set({ validadeDias: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Não vencem</option>
            <option value={90}>3 meses</option>
            <option value={180}>6 meses</option>
            <option value={365}>1 ano</option>
            <option value={730}>2 anos</option>
          </Selecao>
        )}
      </Campo>

      <fieldset className="grid gap-3">
        <legend className="mb-2 font-semibold">Quais serviços participam</legend>
        <Interruptor ligado={todos} aoMudar={setTodos} rotulo="Todos os serviços" />
        {!todos && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {servicos.data?.map((s) => (
              <li key={s.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-destaque"
                    checked={d.servicosElegiveis.includes(s.id)}
                    onChange={(e) =>
                      set({ servicosElegiveis: e.target.checked ? [...d.servicosElegiveis, s.id] : d.servicosElegiveis.filter((x) => x !== s.id) })
                    }
                  />
                  {s.nome}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {d.ativo && <p className="rounded-md bg-fundo px-3 py-2 text-sm">{regraTexto(d)} Os pontos só entram quando o atendimento é concluído.</p>}
      <Botao type="submit" carregando={salvando} className="sm:justify-self-start">
        Salvar programa
      </Botao>
    </form>
  );
}

// ─── RF44 ────────────────────────────────────────────────

function Recompensas({ programa }: { programa: Programa }) {
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['recompensas'], queryFn: () => api<Recompensa[]>('/admin/fidelidade/recompensas?incluirInativas=true') });
  const [editando, setEditando] = useState<Recompensa | 'nova' | null>(null);
  const atualizar = () => (setEditando(null), qc.invalidateQueries({ queryKey: ['recompensas'] }));

  async function remover(r: Recompensa) {
    if (!window.confirm(`Remover "${r.nome}"? Vouchers já gerados continuam valendo.`)) return;
    await api(`/admin/fidelidade/recompensas/${r.id}`, { method: 'DELETE' });
    atualizar();
  }

  return (
    <div className="grid gap-4">
      <Botao className="justify-self-start" onClick={() => setEditando('nova')}>
        <Plus className="size-4" aria-hidden />
        Nova recompensa
      </Botao>
      {lista.isLoading ? (
        <Carregando />
      ) : !lista.data?.length ? (
        <p className="text-sm text-tinta-suave">Nenhuma recompensa ainda. Crie pelo menos uma para os clientes terem pelo que trocar.</p>
      ) : (
        <ul className="grid divide-y divide-borda rounded-lg border border-borda bg-superficie">
          {lista.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="grid gap-1">
                <p className={cx('font-semibold', !r.ativo && 'text-tinta-suave')}>{r.nome}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Selo cor="verde">{unidade(programa.tipo, r.custoPontos)}</Selo>
                  <Selo>{NOME_TIPO_RECOMPENSA[r.tipo]}{r.tipo === 'DESCONTO' && r.valorCentavos ? ` de ${formatarCentavos(r.valorCentavos)}` : ''}</Selo>
                  <Selo cor="cinza">voucher vale {r.validadeDias} dias</Selo>
                  {!r.ativo && <Selo cor="cinza">Pausada</Selo>}
                </div>
              </div>
              <div className="flex gap-1">
                <Botao variante="fantasma" className="h-9 px-2.5" aria-label={`Editar ${r.nome}`} onClick={() => setEditando(r)}>
                  <Pencil className="size-4" />
                </Botao>
                <Botao variante="fantasma" className="h-9 px-2.5 hover:text-erro" aria-label={`Remover ${r.nome}`} onClick={() => remover(r)}>
                  <Trash2 className="size-4" />
                </Botao>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal aberto={editando !== null} aoFechar={() => setEditando(null)} titulo={editando === 'nova' ? 'Nova recompensa' : 'Editar recompensa'}>
        {editando && <FormRecompensa recompensa={editando === 'nova' ? null : editando} tipoPrograma={programa.tipo} aoConcluir={atualizar} />}
      </Modal>
    </div>
  );
}

function FormRecompensa({ recompensa, tipoPrograma, aoConcluir }: { recompensa: Recompensa | null; tipoPrograma: Programa['tipo']; aoConcluir: () => void }) {
  const servicos = useQuery({ queryKey: ['servicos'], queryFn: () => api<ServicoOpcao[]>('/admin/servicos') });
  const { salvando, erro, campos, executar } = useSalvar();
  const [d, setD] = useState({
    nome: recompensa?.nome ?? '',
    descricao: recompensa?.descricao ?? '',
    tipo: recompensa?.tipo ?? ('DESCONTO' as TipoRecompensa),
    custoPontos: recompensa?.custoPontos ?? (tipoPrograma === 'SELOS' ? 10 : 100),
    valorCentavos: recompensa?.valorCentavos ?? null,
    servicoId: recompensa?.servicoId ?? '',
    validadeDias: recompensa?.validadeDias ?? 30,
    ativo: recompensa?.ativo ?? true,
  });
  const set = (p: Partial<typeof d>) => setD({ ...d, ...p });

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const corpo = { ...d, servicoId: d.servicoId || null };
    const ok = await executar(() =>
      (recompensa ? api(`/admin/fidelidade/recompensas/${recompensa.id}`, { method: 'PUT', body: corpo }) : api('/admin/fidelidade/recompensas', { method: 'POST', body: corpo })).then(() => true),
    );
    if (ok) aoConcluir();
  }

  return (
    <form onSubmit={salvar} className="grid gap-5">
      {erro && <Aviso>{erro}</Aviso>}
      <Campo rotulo="Tipo">
        {(id) => (
          <Selecao id={id} value={d.tipo} onChange={(e) => set({ tipo: e.target.value as TipoRecompensa })}>
            <option value="DESCONTO">Desconto em reais</option>
            <option value="SERVICO">Serviço grátis</option>
            <option value="PRODUTO">Brinde / produto</option>
          </Selecao>
        )}
      </Campo>
      {d.tipo === 'DESCONTO' && (
        <Campo rotulo="Valor do desconto" erro={campos.valorCentavos}>
          {(id) => <EntradaMoeda id={id} valor={d.valorCentavos} aoMudar={(v) => set({ valorCentavos: v, nome: d.nome || (v ? `${formatarCentavos(v)} de desconto` : '') })} />}
        </Campo>
      )}
      {d.tipo === 'SERVICO' && (
        <Campo rotulo="Serviço" erro={campos.servicoId}>
          {(id) => (
            <Selecao
              id={id}
              required
              value={d.servicoId}
              onChange={(e) => set({ servicoId: e.target.value, nome: d.nome || `${servicos.data?.find((s) => s.id === e.target.value)?.nome ?? ''} grátis` })}
            >
              <option value="">Escolha</option>
              {servicos.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
      )}
      <Campo rotulo="Nome que o cliente vê" erro={campos.nome}>
        {(id) => <Entrada id={id} required minLength={2} maxLength={80} value={d.nome} onChange={(e) => set({ nome: e.target.value })} />}
      </Campo>
      <div className="grid gap-5 sm:grid-cols-2">
        <Campo rotulo={tipoPrograma === 'SELOS' ? 'Custa quantos selos' : 'Custa quantos pontos'} erro={campos.custoPontos}>
          {(id) => <Entrada id={id} type="number" min={1} required value={d.custoPontos} onChange={(e) => set({ custoPontos: Number(e.target.value) })} />}
        </Campo>
        <Campo rotulo="Voucher vale (dias)" erro={campos.validadeDias}>
          {(id) => <Entrada id={id} type="number" min={1} max={365} required value={d.validadeDias} onChange={(e) => set({ validadeDias: Number(e.target.value) })} />}
        </Campo>
      </div>
      <Campo rotulo="Descrição (opcional)" erro={campos.descricao}>
        {(id) => <AreaTexto id={id} maxLength={300} className="min-h-16" value={d.descricao} onChange={(e) => set({ descricao: e.target.value })} />}
      </Campo>
      <Interruptor ligado={d.ativo} aoMudar={(v) => set({ ativo: v })} rotulo={d.ativo ? 'Disponível para troca' : 'Pausada'} />
      <Botao type="submit" carregando={salvando}>
        Salvar
      </Botao>
    </form>
  );
}

// ─── RF46: clientes, extrato, ajuste e vouchers ──────────

function Clientes({ programa }: { programa: Programa }) {
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [voucher, setVoucher] = useState<(Voucher & { cliente: { id: string; nome: string } }) | null>(null);
  const [erroVoucher, setErroVoucher] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setTermo(busca), 300);
    return () => clearTimeout(t);
  }, [busca]);
  const clientes = useQuery({ queryKey: ['fidelidade-clientes', termo], queryFn: () => api<ClienteBusca[]>(`/admin/fidelidade/clientes?busca=${encodeURIComponent(termo)}`) });

  async function procurarVoucher(e: FormEvent) {
    e.preventDefault();
    setErroVoucher(null);
    setVoucher(null);
    try {
      setVoucher(await api(`/admin/fidelidade/vouchers/${encodeURIComponent(codigo.trim())}`));
    } catch (err) {
      setErroVoucher(err instanceof ApiError ? err.message : 'Sem conexão.');
    }
  }

  return (
    <div>
      <Secao titulo="Usar voucher" descricao="O cliente mostra o código no atendimento.">
        <form onSubmit={procurarVoucher} className="flex flex-wrap gap-2">
          <Entrada aria-label="Código do voucher" placeholder="Ex.: K7M2Q9XA" className="w-48 font-mono uppercase" maxLength={12} value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          <Botao type="submit" variante="secundario">
            <Ticket className="size-4" aria-hidden />
            Conferir
          </Botao>
        </form>
        {erroVoucher && <Aviso>{erroVoucher}</Aviso>}
        {voucher && <CartaoVoucher voucher={voucher} cliente={voucher.cliente.nome} aoMudar={() => setVoucher(null)} />}
      </Secao>

      <Secao titulo="Clientes" descricao="Saldo, extrato, troca e ajuste de pontos.">
        <div className="relative sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-tinta-suave" aria-hidden />
          <Entrada aria-label="Buscar cliente" placeholder="Nome, telefone ou e-mail" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {clientes.isLoading ? (
          <Carregando />
        ) : !clientes.data?.length ? (
          <p className="text-sm text-tinta-suave">Nenhum cliente encontrado.</p>
        ) : (
          <ul className="grid divide-y divide-borda rounded-lg border border-borda bg-superficie">
            {clientes.data.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setAberto(c.id)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-fundo">
                  <span>
                    <span className="block font-medium">{c.nome}</span>
                    <span className="text-sm text-tinta-suave">{telefone(c.telefone)}</span>
                  </span>
                  <span className={cx('font-semibold tabular-nums', c.saldo ? 'text-destaque-forte' : 'text-tinta-suave')}>{unidade(programa.tipo, c.saldo)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Modal aberto={aberto !== null} aoFechar={() => setAberto(null)} titulo="Fidelidade do cliente" largura="max-w-xl">
        {aberto && <DetalheCliente clienteId={aberto} programa={programa} />}
      </Modal>
    </div>
  );
}

function CartaoVoucher({ voucher, cliente, aoMudar }: { voucher: Voucher; cliente?: string; aoMudar: () => void }) {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function acao(tipo: 'usar' | 'cancelar') {
    if (tipo === 'cancelar' && !window.confirm('Cancelar o voucher? Os pontos voltam para o cliente.')) return;
    setErro(null);
    setEnviando(true);
    try {
      await api(`/admin/fidelidade/vouchers/${voucher.id}/${tipo}`, { method: 'POST' });
      aoMudar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Sem conexão.');
    } finally {
      setEnviando(false);
    }
  }
  return (
    <div className="grid gap-3 rounded-lg border-2 border-dashed border-destaque bg-destaque-claro p-4">
      {erro && <Aviso>{erro}</Aviso>}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{voucher.recompensa.nome}</p>
          <p className="text-sm text-tinta-suave">
            {cliente && `${cliente} · `}
            {voucher.status === 'DISPONIVEL' ? `vale até ${dataBr(voucher.expiraEm)}` : voucher.usadoEm ? `usado em ${dataBr(voucher.usadoEm)}` : ''}
          </p>
        </div>
        <span className="font-mono font-semibold tracking-widest">{voucher.codigo}</span>
      </div>
      {voucher.status === 'DISPONIVEL' ? (
        <div className="flex flex-wrap gap-2">
          <Botao className="h-9" carregando={enviando} onClick={() => acao('usar')}>
            Marcar como usado
          </Botao>
          <Botao variante="fantasma" className="h-9" onClick={() => acao('cancelar')}>
            Cancelar e devolver pontos
          </Botao>
        </div>
      ) : (
        <Selo cor="cinza">{NOME_VOUCHER[voucher.status]}</Selo>
      )}
    </div>
  );
}

function DetalheCliente({ clienteId, programa }: { clienteId: string; programa: Programa }) {
  const qc = useQueryClient();
  const resumo = useQuery({ queryKey: ['fidelidade-cliente', clienteId], queryFn: () => api<ResumoCliente>(`/admin/fidelidade/clientes/${clienteId}`) });
  const recompensas = useQuery({ queryKey: ['recompensas-ativas'], queryFn: () => api<Recompensa[]>('/admin/fidelidade/recompensas') });
  const [modo, setModo] = useState<'ver' | 'ajuste' | 'trocar'>('ver');
  const { salvando, erro, campos, executar, limpar } = useSalvar();
  const [pontos, setPontos] = useState('');
  const [motivo, setMotivo] = useState('');
  const atualizar = () => {
    ['fidelidade-cliente', 'fidelidade-clientes'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    setModo('ver');
    limpar();
  };

  if (resumo.isLoading || !resumo.data) return <Carregando />;
  const r = resumo.data;
  const ordenadas = recompensas.data ?? [];
  const proxima = ordenadas.find((x) => x.custoPontos > r.saldo) ?? ordenadas.at(-1) ?? null;

  async function ajustar(e: FormEvent) {
    e.preventDefault();
    const ok = await executar(() => api(`/admin/fidelidade/clientes/${clienteId}/ajuste`, { method: 'POST', body: { pontos: Number(pontos), motivo } }).then(() => true));
    if (ok) (setPontos(''), setMotivo(''), atualizar());
  }
  async function trocar(rec: Recompensa) {
    const ok = await executar(() => api(`/admin/fidelidade/clientes/${clienteId}/resgates`, { method: 'POST', body: { recompensaId: rec.id } }).then(() => true));
    if (ok) atualizar();
  }

  return (
    <div className="grid gap-5">
      <div>
        <p className="text-lg font-semibold">{r.cliente.nome}</p>
        <p className="text-sm text-tinta-suave">{[r.cliente.telefone && telefone(r.cliente.telefone), r.cliente.email].filter(Boolean).join(' · ')}</p>
      </div>
      <CartaoFidelidade saldo={r.saldo} tipo={programa.tipo} proxima={proxima && { nome: proxima.nome, custo: proxima.custoPontos }} />
      {r.proximoVencimento && (
        <p className="text-sm text-tinta-suave">
          {unidade(programa.tipo, r.proximoVencimento.pontos)} vencem em {dataBr(r.proximoVencimento.em)}.
        </p>
      )}
      {erro && <Aviso>{erro}</Aviso>}

      {modo === 'ver' && (
        <div className="flex flex-wrap gap-2">
          <Botao onClick={() => (limpar(), setModo('trocar'))}>
            <Gift className="size-4" aria-hidden />
            Trocar por recompensa
          </Botao>
          <Botao variante="secundario" onClick={() => (limpar(), setModo('ajuste'))}>
            Ajustar pontos
          </Botao>
        </div>
      )}

      {modo === 'trocar' && (
        <div className="grid gap-2">
          {!ordenadas.length && <p className="text-sm text-tinta-suave">Cadastre recompensas na aba Recompensas.</p>}
          {ordenadas.map((rec) => (
            <div key={rec.id} className="flex items-center justify-between gap-3 rounded-md border border-borda px-4 py-2.5">
              <span>
                <span className="block font-medium">{rec.nome}</span>
                <span className="text-sm text-tinta-suave">{unidade(programa.tipo, rec.custoPontos)}</span>
              </span>
              <Botao className="h-9" disabled={r.saldo < rec.custoPontos} carregando={salvando} onClick={() => trocar(rec)}>
                Trocar
              </Botao>
            </div>
          ))}
          <Botao variante="fantasma" className="justify-self-start" onClick={() => setModo('ver')}>
            Voltar
          </Botao>
        </div>
      )}

      {modo === 'ajuste' && (
        <form onSubmit={ajustar} className="grid gap-4 rounded-lg border border-borda p-4">
          <Campo rotulo="Pontos" dica="Use número negativo para tirar. Ex.: -20" erro={campos.pontos}>
            {(id, desc) => <Entrada id={id} aria-describedby={desc} type="number" required className="w-32" value={pontos} onChange={(e) => setPontos(e.target.value)} />}
          </Campo>
          <Campo rotulo="Justificativa" dica="Fica registrada no extrato e na auditoria." erro={campos.motivo}>
            {(id, desc) => <Entrada id={id} aria-describedby={desc} required minLength={5} maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
          </Campo>
          <div className="flex gap-2">
            <Botao type="submit" carregando={salvando}>
              Salvar ajuste
            </Botao>
            <Botao type="button" variante="fantasma" onClick={() => setModo('ver')}>
              Voltar
            </Botao>
          </div>
        </form>
      )}

      {r.vouchers.some((v) => v.status === 'DISPONIVEL') && (
        <div className="grid gap-2">
          <p className="font-semibold">Vouchers</p>
          {r.vouchers
            .filter((v) => v.status === 'DISPONIVEL')
            .map((v) => (
              <CartaoVoucher key={v.id} voucher={v} aoMudar={atualizar} />
            ))}
        </div>
      )}

      <div className="grid gap-2">
        <p className="font-semibold">Extrato</p>
        {!r.extrato.length ? (
          <p className="text-sm text-tinta-suave">Nenhuma movimentação ainda.</p>
        ) : (
          <ul className="grid divide-y divide-borda text-sm">
            {r.extrato.map((e) => (
              <li key={e.id} className="grid grid-cols-[1fr_auto] gap-x-3 py-2">
                <span>
                  {e.descricao}
                  <span className="text-tinta-suave"> · {dataBr(e.criadoEm)}</span>
                </span>
                <span className={cx('text-right font-semibold tabular-nums', e.pontos < 0 ? 'text-erro' : 'text-destaque-forte')}>
                  {e.pontos > 0 ? '+' : ''}
                  {e.pontos.toLocaleString('pt-BR')}
                </span>
                {e.tipo === 'AJUSTE' && (
                  <span className="col-span-2 text-xs text-tinta-suave">
                    {e.motivo}
                    {e.usuario && ` · por ${e.usuario}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
