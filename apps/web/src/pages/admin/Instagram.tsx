import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toPng } from 'html-to-image';
import { ArrowLeft, Copy, Download, Plus, Share2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { formatarCentavos, formatarDuracao } from '../../lib/formato';
import { hojeISO, somarDias } from '../../lib/horarios';
import { formatarDataLonga } from '../../lib/agenda';
import { FONTES, usePersonalizacao, type Fonte } from '../../lib/site';
import { conteudoPadrao, FORMATOS, MODELOS, NOME_STATUS_POST, sugerirLegenda, type Conteudo, type Formato, type Modelo, type Post, type StatusPost } from '../../lib/posts';
import { ArtePost, Miniatura, type Marca } from '../../components/posts/ArtePost';
import { UploadImagem } from '../../components/UploadImagem';
import { AreaTexto, Aviso, Botao, Cabecalho, Campo, Carregando, cx, Entrada, Interruptor, Selecao } from '../../components/ui';

// Posts para o Instagram: modelos prontos, preenchidos com os dados do sistema
// (serviços, preços, fotos, equipe, horários livres, cores e logo do site).

interface EmpresaPublica {
  nome: string;
  instagram: string | null;
  endereco: { cidade: string | null };
}
interface ServicoPublico {
  id: string;
  nome: string;
  descricao: string | null;
  duracaoMin: number;
  precoCentavos: number;
  fotoUrl: string | null;
  profissionais: { id: string; nome: string; precoCentavos: number }[];
}
interface MembroPublico {
  id: string;
  nome: string;
  cargo: string | null;
  bio: string | null;
  fotoUrl: string | null;
}

function useMarca(): Marca & { cidade: string | null } {
  const empresa = useQuery({ queryKey: ['empresa-site'], queryFn: () => api<EmpresaPublica>('/public/empresa', { semRenovar: true }), retry: false });
  const p = usePersonalizacao();
  return {
    nome: empresa.data?.nome ?? 'Seu negócio',
    instagram: empresa.data?.instagram?.replace(/^@/, '').replace(/[^\w.]/g, '') || null,
    logoUrl: p.data?.logoUrl ?? null,
    cidade: empresa.data?.endereco.cidade ?? null,
  };
}

export function Instagram() {
  const { id } = useParams();
  return id ? <Editor id={id === 'novo' ? null : id} /> : <Lista />;
}

// ─── Lista ───────────────────────────────────────────────

function Lista() {
  const [filtro, setFiltro] = useState<StatusPost | 'TODOS'>('TODOS');
  const posts = useQuery({ queryKey: ['posts'], queryFn: () => api<Post[]>('/admin/posts') });
  const marca = useMarca();
  const lista = (posts.data ?? []).filter((p) => filtro === 'TODOS' || p.status === filtro);

  return (
    <>
      <Cabecalho
        titulo="Instagram"
        descricao="Monte posts e stories com os serviços, preços, fotos e horários do sistema. Baixe a imagem e poste."
        acoes={
          <Link to="/painel/instagram/novo" className="inline-flex h-10 items-center gap-2 rounded-lg bg-tinta px-4 text-sm font-medium text-white hover:bg-tinta/85">
            <Plus className="size-4" aria-hidden />
            Novo post
          </Link>
        }
      />
      <div role="tablist" className="mb-8 flex gap-1 overflow-x-auto border-b border-borda">
        {(['TODOS', 'RASCUNHO', 'PRONTO', 'PUBLICADO'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={filtro === s}
            onClick={() => setFiltro(s)}
            className={cx('-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium', filtro === s ? 'border-tinta' : 'border-transparent text-tinta-suave hover:text-tinta')}
          >
            {s === 'TODOS' ? 'Todos' : s === 'RASCUNHO' ? 'Rascunhos' : s === 'PRONTO' ? 'Prontos' : 'Publicados'}
            {posts.data && <span className="ml-1.5 text-tinta-suave">{s === 'TODOS' ? posts.data.length : posts.data.filter((p) => p.status === s).length}</span>}
          </button>
        ))}
      </div>

      {posts.isLoading ? (
        <Carregando />
      ) : posts.isError ? (
        <Aviso>Não foi possível carregar os posts.</Aviso>
      ) : lista.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-borda px-6 py-16 text-center">
          <p className="font-medium">{filtro === 'TODOS' ? 'Nenhum post ainda' : 'Nada por aqui'}</p>
          <p className="max-w-sm text-sm text-tinta-suave">Escolha um modelo, preencha com um serviço ou com os horários livres e baixe a imagem pronta para o Instagram.</p>
          <Link to="/painel/instagram/novo" className="text-sm underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
            Criar o primeiro post
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {lista.map((p) => (
            <li key={p.id}>
              <Link to={`/painel/instagram/${p.id}`} className="group grid gap-3">
                <Miniatura formato={p.formato} className="rounded-lg ring-1 ring-borda transition group-hover:ring-[#c9c8c3]">
                  <ArtePost modelo={p.modelo} formato={p.formato} c={p.conteudo} marca={marca} />
                </Miniatura>
                <div>
                  <p className="truncate text-sm font-medium">{p.titulo}</p>
                  <p className="text-xs text-tinta-suave">
                    {NOME_STATUS_POST[p.status]}
                    {p.agendadoPara && `, ${formatarDataLonga(p.agendadoPara).replace(/^\w+-?\w*, /, '')}`}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ─── Editor ──────────────────────────────────────────────

interface Estado {
  titulo: string;
  modelo: Modelo;
  formato: Formato;
  conteudo: Conteudo;
  legenda: string;
  status: StatusPost;
  agendadoPara: string | null;
}

function Editor({ id }: { id: string | null }) {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const marca = useMarca();
  const site = usePersonalizacao();
  const existente = useQuery({ enabled: Boolean(id), queryKey: ['post', id], queryFn: () => api<Post>(`/admin/posts/${id}`) });
  const [e, setE] = useState<Estado | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const arte = useRef<HTMLDivElement>(null);

  const tema = site.data?.tema ?? { corPrimaria: '#26292a', fonteTitulos: 'instrument' as Fonte, fonteTexto: 'instrument' as Fonte };

  // Estado inicial: o post salvo ou um novo com as cores e fontes do site
  useEffect(() => {
    if (e) return;
    if (id && existente.data) {
      const { titulo, modelo, formato, conteudo, legenda, status, agendadoPara } = existente.data;
      setE({ titulo, modelo, formato, conteudo, legenda, status, agendadoPara });
    } else if (!id && site.isFetched) {
      setE({ titulo: 'Novo post', modelo: 'SERVICO', formato: 'RETRATO', conteudo: conteudoPadrao('SERVICO', tema), legenda: '', status: 'RASCUNHO', agendadoPara: null });
    }
  }, [id, existente.data, site.isFetched, e, tema]);

  if (id && existente.isError) return <Aviso>Post não encontrado.</Aviso>;
  if (!e) return <Carregando />;

  const set = (p: Partial<Estado>) => setE({ ...e, ...p });
  const setC = (p: Partial<Conteudo>) => setE({ ...e, conteudo: { ...e.conteudo, ...p } });
  const campos = MODELOS[e.modelo].campos;

  function trocarModelo(m: Modelo) {
    const base = conteudoPadrao(m, tema);
    // Mantém o visual escolhido; troca só os textos de partida
    setE({ ...e!, modelo: m, conteudo: { ...base, corFundo: e!.conteudo.corFundo, corTexto: e!.conteudo.corTexto, corDestaque: e!.conteudo.corDestaque, fonteTitulos: e!.conteudo.fonteTitulos, fonteTexto: e!.conteudo.fonteTexto, mostrarLogo: e!.conteudo.mostrarLogo, alinhamento: e!.conteudo.alinhamento } });
  }

  async function salvar() {
    setAviso(null);
    setSalvando(true);
    try {
      // Sem nome? Usa o modelo e o título da arte para achar depois na lista
      const nome = e!.titulo.trim();
      const corpo = { ...e, titulo: !nome || nome === 'Novo post' ? `${MODELOS[e!.modelo].nome}: ${e!.conteudo.titulo || e!.conteudo.destaque}`.slice(0, 80) : nome };
      const r = id ? await api<Post>(`/admin/posts/${id}`, { method: 'PATCH', body: corpo }) : await api<Post>('/admin/posts', { method: 'POST', body: corpo });
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.setQueryData(['post', r.id], r);
      setE((atual) => (atual ? { ...atual, titulo: r.titulo } : atual));
      setAviso({ tipo: 'sucesso', texto: 'Post salvo.' });
      if (!id) navegar(`/painel/instagram/${r.id}`, { replace: true });
    } catch (err) {
      setAviso({ tipo: 'erro', texto: err instanceof ApiError ? err.message : 'Sem conexão com o servidor.' });
    } finally {
      setSalvando(false);
    }
  }

  async function gerarPng() {
    const { largura, altura } = FORMATOS[e!.formato];
    await document.fonts.ready;
    return toPng(arte.current!, { width: largura, height: altura, pixelRatio: 1, cacheBust: true });
  }
  const nomeArquivo = () => `${(e!.titulo || 'post').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').toLowerCase()}.png`;

  async function baixar() {
    setBaixando(true);
    try {
      const a = document.createElement('a');
      a.href = await gerarPng();
      a.download = nomeArquivo();
      a.click();
    } catch {
      setAviso({ tipo: 'erro', texto: 'Não foi possível gerar a imagem. Tente de novo.' });
    } finally {
      setBaixando(false);
    }
  }

  // Celular: abre a folha de compartilhar (dá para mandar direto para o Instagram)
  const podeCompartilhar = typeof navigator !== 'undefined' && 'canShare' in navigator;
  async function compartilhar() {
    try {
      const blob = await (await fetch(await gerarPng())).blob();
      const arquivo = new File([blob], nomeArquivo(), { type: 'image/png' });
      if (navigator.canShare?.({ files: [arquivo] })) await navigator.share({ files: [arquivo], text: e!.legenda });
      else await baixar();
    } catch {
      /* a pessoa fechou a folha de compartilhar */
    }
  }

  async function copiarLegenda() {
    await navigator.clipboard.writeText(e!.legenda);
    setAviso({ tipo: 'sucesso', texto: 'Legenda copiada.' });
  }

  async function excluir() {
    if (!id || !window.confirm('Apagar este post?')) return;
    await api(`/admin/posts/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['posts'] });
    navegar('/painel/instagram');
  }

  const { largura, altura } = FORMATOS[e.formato];

  return (
    <>
      <Link to="/painel/instagram" className="mb-6 inline-flex items-center gap-1.5 text-sm text-tinta-suave hover:text-tinta">
        <ArrowLeft className="size-4" strokeWidth={1.6} aria-hidden />
        Posts
      </Link>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <input
          aria-label="Nome do post"
          value={e.titulo}
          maxLength={80}
          onChange={(x) => set({ titulo: x.target.value })}
          className="min-w-0 flex-1 border-b border-transparent bg-transparent text-[1.75rem] font-semibold leading-tight outline-none hover:border-borda focus:border-tinta"
        />
        <div className="flex flex-wrap gap-2">
          {id && (
            <Botao variante="fantasma" className="hover:text-erro" onClick={excluir}>
              Apagar
            </Botao>
          )}
          <Botao carregando={salvando} onClick={salvar}>
            Salvar
          </Botao>
        </div>
      </div>

      {aviso && (
        <div className="mb-6">
          <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>
        </div>
      )}

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Prévia */}
        <div className="grid gap-4 lg:sticky lg:top-8">
          <div role="group" aria-label="Formato" className="flex justify-self-start rounded-lg border border-borda p-0.5">
            {(Object.keys(FORMATOS) as Formato[]).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={e.formato === f}
                onClick={() => set({ formato: f })}
                className={cx('h-8 rounded-md px-3 text-sm font-medium transition-colors', e.formato === f ? 'bg-tinta text-white' : 'text-tinta-suave hover:text-tinta')}
              >
                {FORMATOS[f].nome}
              </button>
            ))}
          </div>
          <div className="mx-auto w-full" style={{ maxWidth: e.formato === 'STORY' ? 360 : 520 }}>
            <Miniatura formato={e.formato} className="rounded-lg ring-1 ring-borda">
              <ArtePost modelo={e.modelo} formato={e.formato} c={e.conteudo} marca={marca} />
            </Miniatura>
          </div>
          <p className="text-center text-xs text-tinta-suave">
            {largura} × {altura} px
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Botao variante="secundario" carregando={baixando} onClick={baixar}>
              <Download className="size-4" strokeWidth={1.6} aria-hidden />
              Baixar imagem
            </Botao>
            {podeCompartilhar && (
              <Botao variante="secundario" onClick={compartilhar} className="sm:hidden">
                <Share2 className="size-4" strokeWidth={1.6} aria-hidden />
                Compartilhar
              </Botao>
            )}
            <Botao variante="secundario" onClick={copiarLegenda} disabled={!e.legenda}>
              <Copy className="size-4" strokeWidth={1.6} aria-hidden />
              Copiar legenda
            </Botao>
          </div>
          {/* Arte em tamanho real, fora da tela: é ela que vira o PNG */}
          <div aria-hidden style={{ position: 'fixed', left: -100000, top: 0, pointerEvents: 'none' }}>
            <ArtePost ref={arte} modelo={e.modelo} formato={e.formato} c={e.conteudo} marca={marca} />
          </div>
        </div>

        {/* Formulário */}
        <div className="grid gap-8">
          <Bloco titulo="Modelo">
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(MODELOS) as Modelo[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={e.modelo === m}
                  onClick={() => trocarModelo(m)}
                  className={cx('rounded-lg border px-3 py-2.5 text-left transition-colors', e.modelo === m ? 'border-tinta bg-fundo' : 'border-borda hover:bg-fundo/70')}
                >
                  <span className="block text-sm font-medium">{MODELOS[m].nome}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-tinta-suave">{MODELOS[m].descricao}</span>
                </button>
              ))}
            </div>
          </Bloco>

          <Preencher modelo={e.modelo} setC={setC} />

          <Bloco titulo="Textos">
            {campos.destaque && e.modelo !== 'SERVICO' && e.modelo !== 'DEPOIMENTO' && (
              <Campo rotulo={campos.destaque}>{(i) => <Entrada id={i} maxLength={40} value={e.conteudo.destaque} onChange={(x) => setC({ destaque: x.target.value })} />}</Campo>
            )}
            {campos.titulo && <Campo rotulo={campos.titulo}>{(i) => <Entrada id={i} maxLength={120} value={e.conteudo.titulo} onChange={(x) => setC({ titulo: x.target.value })} />}</Campo>}
            {campos.subtitulo && <Campo rotulo={campos.subtitulo}>{(i) => <AreaTexto id={i} maxLength={200} className="min-h-16" value={e.conteudo.subtitulo} onChange={(x) => setC({ subtitulo: x.target.value })} />}</Campo>}
            {(e.modelo === 'SERVICO' || e.modelo === 'DEPOIMENTO') && campos.destaque && (
              <Campo rotulo={campos.destaque}>{(i) => <Entrada id={i} maxLength={40} value={e.conteudo.destaque} onChange={(x) => setC({ destaque: x.target.value })} />}</Campo>
            )}
            {campos.texto && <Campo rotulo={campos.texto}>{(i) => <AreaTexto id={i} maxLength={600} className="min-h-20" value={e.conteudo.texto} onChange={(x) => setC({ texto: x.target.value })} />}</Campo>}
            {campos.itens && (
              <Campo rotulo={campos.itens} dica="Até 12.">
                {(i, d) => (
                  <AreaTexto
                    id={i}
                    aria-describedby={d}
                    className="min-h-28 font-normal tabular-nums"
                    value={e.conteudo.itens.join('\n')}
                    onChange={(x) => setC({ itens: x.target.value.split('\n').slice(0, 12).map((l) => l.slice(0, 40)) })}
                  />
                )}
              </Campo>
            )}
            {campos.rodape !== undefined && <Campo rotulo={campos.rodape}>{(i) => <Entrada id={i} maxLength={120} value={e.conteudo.rodape} onChange={(x) => setC({ rodape: x.target.value })} />}</Campo>}
          </Bloco>

          <Bloco titulo="Imagem e cores">
            <UploadImagem finalidade="POST" rotulo="Imagem" formato="aspect-[4/5]" valor={e.conteudo.imagemUrl} aoMudar={(url) => setC({ imagemUrl: url, ...(url ? {} : { fundo: 'COR' }) })} dica="JPG, PNG ou WebP, até 5 MB." />
            {e.conteudo.imagemUrl && (
              <Interruptor
                ligado={e.conteudo.fundo === 'IMAGEM'}
                aoMudar={(v) => setC(v ? { fundo: 'IMAGEM', corTexto: '#ffffff' } : { fundo: 'COR', corTexto: '#26292a' })}
                rotulo="Usar a imagem como fundo inteiro"
              />
            )}
            <div className="grid grid-cols-3 gap-3">
              <Cor rotulo="Fundo" valor={e.conteudo.corFundo} aoMudar={(v) => setC({ corFundo: v })} />
              <Cor rotulo="Texto" valor={e.conteudo.corTexto} aoMudar={(v) => setC({ corTexto: v })} />
              <Cor rotulo="Destaque" valor={e.conteudo.corDestaque} aoMudar={(v) => setC({ corDestaque: v })} />
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ['Claro', '#f4f2ee', '#26292a'],
                ['Branco', '#ffffff', '#26292a'],
                ['Escuro', '#26292a', '#ffffff'],
                ['Cor do site', tema.corPrimaria, '#ffffff'],
              ].map(([n, f, t]) => (
                <button key={n} type="button" onClick={() => setC({ corFundo: f!, corTexto: t!, fundo: 'COR' })} className="inline-flex items-center gap-2 rounded-lg border border-borda px-2.5 py-1.5 text-xs hover:bg-fundo">
                  <span className="size-3.5 rounded ring-1 ring-borda" style={{ background: f }} aria-hidden />
                  {n}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Fonte dos títulos">
                {(i) => (
                  <Selecao id={i} value={e.conteudo.fonteTitulos} onChange={(x) => setC({ fonteTitulos: x.target.value as Fonte })}>
                    {Object.entries(FONTES).map(([k, f]) => (
                      <option key={k} value={k}>
                        {f.nome}
                      </option>
                    ))}
                  </Selecao>
                )}
              </Campo>
              <Campo rotulo="Fonte do texto">
                {(i) => (
                  <Selecao id={i} value={e.conteudo.fonteTexto} onChange={(x) => setC({ fonteTexto: x.target.value as Fonte })}>
                    {Object.entries(FONTES).map(([k, f]) => (
                      <option key={k} value={k}>
                        {f.nome}
                      </option>
                    ))}
                  </Selecao>
                )}
              </Campo>
            </div>
            <Interruptor ligado={e.conteudo.mostrarLogo} aoMudar={(v) => setC({ mostrarLogo: v })} rotulo="Mostrar logo e nome" />
            <Interruptor ligado={e.conteudo.alinhamento === 'CENTRO'} aoMudar={(v) => setC({ alinhamento: v ? 'CENTRO' : 'ESQUERDA' })} rotulo="Centralizar" />
          </Bloco>

          <Bloco titulo="Legenda">
            <Campo rotulo="Texto do post" dica={`${e.legenda.length} de 2.200 caracteres`}>
              {(i, d) => <AreaTexto id={i} aria-describedby={d} maxLength={2200} className="min-h-40" value={e.legenda} onChange={(x) => set({ legenda: x.target.value })} />}
            </Campo>
            <Botao variante="secundario" className="justify-self-start" onClick={() => set({ legenda: sugerirLegenda(e.modelo, e.conteudo, { nome: marca.nome, cidade: marca.cidade }) })}>
              Sugerir legenda
            </Botao>
          </Bloco>

          <Bloco titulo="Planejamento">
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Situação">
                {(i) => (
                  <Selecao id={i} value={e.status} onChange={(x) => set({ status: x.target.value as StatusPost })}>
                    {Object.entries(NOME_STATUS_POST).map(([k, n]) => (
                      <option key={k} value={k}>
                        {n}
                      </option>
                    ))}
                  </Selecao>
                )}
              </Campo>
              <Campo rotulo="Postar em">
                {(i) => <Entrada id={i} type="date" value={e.agendadoPara ?? ''} onChange={(x) => set({ agendadoPara: x.target.value || null })} />}
              </Campo>
            </div>
            <Botao carregando={salvando} onClick={salvar} className="justify-self-start">
              Salvar
            </Botao>
          </Bloco>
        </div>
      </div>
    </>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-borda pt-6 first:border-t-0 first:pt-0">
      <h2 className="font-medium">{titulo}</h2>
      {children}
    </section>
  );
}

function Cor({ rotulo, valor, aoMudar }: { rotulo: string; valor: string; aoMudar: (v: string) => void }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{rotulo}</span>
      <span className="relative flex h-10 items-center gap-2 rounded-lg border border-borda-campo px-2">
        <span className="size-6 shrink-0 rounded ring-1 ring-borda" style={{ background: valor }} aria-hidden />
        <span className="text-xs tabular-nums text-tinta-suave">{valor}</span>
        <input type="color" value={valor} onChange={(x) => aoMudar(x.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
      </span>
    </label>
  );
}

// Preenche o post com dados do sistema (o que muda conforme o modelo)
function Preencher({ modelo, setC }: { modelo: Modelo; setC: (p: Partial<Conteudo>) => void }) {
  const servicos = useQuery({ queryKey: ['catalogo'], queryFn: () => api<ServicoPublico[]>('/public/servicos', { semRenovar: true }) });
  const equipe = useQuery({ queryKey: ['equipe-site'], queryFn: () => api<MembroPublico[]>('/public/equipe', { semRenovar: true }) });
  const site = usePersonalizacao();
  const [servicoId, setServicoId] = useState('');
  const [profissionalId, setProfissionalId] = useState('');
  const [data, setData] = useState(somarDias(hojeISO(), 1));
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (modelo === 'PROMOCAO' || modelo === 'AVISO') return null;

  const preco = (s: ServicoPublico) => {
    const precos = s.profissionais.map((p) => p.precoCentavos);
    const min = Math.min(...precos, s.precoCentavos);
    return min === Math.max(...precos, s.precoCentavos) ? formatarCentavos(min) : `A partir de ${formatarCentavos(min)}`;
  };

  async function buscarHorarios() {
    setErro(null);
    setBuscando(true);
    try {
      const r = await api<{ profissionais: { id: string; nome: string; horarios: string[] }[] }>(
        `/public/disponibilidade?servicoId=${servicoId}&data=${data}${profissionalId ? `&funcionarioId=${profissionalId}` : ''}`,
        { semRenovar: true },
      );
      const horarios = [...new Set(r.profissionais.flatMap((p) => p.horarios))].sort();
      // Muitos horários seguidos? Mostra de hora em hora para caber
      const resumidos = horarios.length > 12 ? horarios.filter((h) => h.endsWith(':00')).slice(0, 12) : horarios;
      const s = servicos.data?.find((x) => x.id === servicoId);
      const dia = formatarDataLonga(data);
      setC({ itens: resumidos, subtitulo: `${dia}${s ? `, ${s.nome.toLowerCase()}` : ''}` });
      if (!resumidos.length) setErro('Nenhum horário livre nesse dia.');
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível buscar os horários.');
    } finally {
      setBuscando(false);
    }
  }

  return (
    <Bloco titulo="Preencher com dados do sistema">
      {erro && <Aviso>{erro}</Aviso>}
      {(modelo === 'SERVICO' || modelo === 'HORARIOS') && (
        <Campo rotulo="Serviço">
          {(i) => (
            <Selecao
              id={i}
              value={servicoId}
              onChange={(x) => {
                setServicoId(x.target.value);
                const s = servicos.data?.find((y) => y.id === x.target.value);
                if (s && modelo === 'SERVICO') {
                  setC({ titulo: s.nome, subtitulo: s.descricao ?? '', destaque: preco(s), texto: formatarDuracao(s.duracaoMin), imagemUrl: s.fotoUrl });
                }
              }}
            >
              <option value="">Escolha um serviço</option>
              {servicos.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
      )}
      {modelo === 'HORARIOS' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Dia">{(i) => <Entrada id={i} type="date" min={hojeISO()} value={data} onChange={(x) => x.target.value && setData(x.target.value)} />}</Campo>
            <Campo rotulo="Profissional">
              {(i) => (
                <Selecao id={i} value={profissionalId} onChange={(x) => setProfissionalId(x.target.value)}>
                  <option value="">Qualquer um</option>
                  {servicos.data
                    ?.find((s) => s.id === servicoId)
                    ?.profissionais.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                </Selecao>
              )}
            </Campo>
          </div>
          <Botao variante="secundario" className="justify-self-start" disabled={!servicoId} carregando={buscando} onClick={buscarHorarios}>
            Buscar horários livres
          </Botao>
        </>
      )}
      {modelo === 'EQUIPE' && (
        <Campo rotulo="Profissional">
          {(i) => (
            <Selecao
              id={i}
              defaultValue=""
              onChange={(x) => {
                const m = equipe.data?.find((y) => y.id === x.target.value);
                if (m) setC({ titulo: m.nome, subtitulo: m.cargo ?? '', texto: m.bio ?? '', imagemUrl: m.fotoUrl });
              }}
            >
              <option value="">Escolha quem apresentar</option>
              {equipe.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
      )}
      {modelo === 'DEPOIMENTO' && (
        <Campo rotulo="Depoimento do site" dica={site.data?.depoimentos.length ? undefined : 'Cadastre depoimentos em Site para escolher aqui, ou escreva abaixo.'}>
          {(i, d) => (
            <Selecao
              id={i}
              aria-describedby={d}
              defaultValue=""
              disabled={!site.data?.depoimentos.length}
              onChange={(x) => {
                const dp = site.data?.depoimentos[Number(x.target.value)];
                if (dp) setC({ texto: dp.texto, subtitulo: dp.nome });
              }}
            >
              <option value="">Escolha um depoimento</option>
              {site.data?.depoimentos.map((dp, n) => (
                <option key={n} value={n}>
                  {dp.nome}: {dp.texto.slice(0, 40)}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
      )}
    </Bloco>
  );
}
