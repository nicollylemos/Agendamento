import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Eye, EyeOff, ExternalLink, Monitor, Plus, Smartphone, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { FONTES, SECOES, type CampoExtra, type Fonte, type Personalizacao as Dados } from '../../lib/site';
import { Landing, type EmpresaSite, type MembroSite, type ServicoSite } from '../../components/site/Landing';
import { UploadImagem } from '../../components/UploadImagem';
import { AreaTexto, Aviso, Botao, Cabecalho, Campo, Carregando, cx, Entrada, Interruptor, Selecao, Selo } from '../../components/ui';

// RF07 (cores, fonte, logo, banner, textos, ordem dos serviços, campos extras),
// RF08 (prévia ao vivo antes de publicar), RF10 (seções e ordem)

interface Estado {
  rascunho: Dados;
  publicado: Dados | null;
  publicadoEm: string | null;
  temAlteracoes: boolean;
}

// Cores prontas, todas com contraste suficiente para texto branco (WCAG AA)
const CORES = ['#26292a', '#2f5d50', '#2c4a6b', '#5a4a6e', '#7a3b4b', '#8a5a2b', '#4a5a3a', '#6b6f6d'];

function contrasteComBranco(hex: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return 0;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * r! + 0.7152 * g! + 0.0722 * b! + 0.05);
}

const mover = <T,>(lista: T[], i: number, d: -1 | 1) => {
  const n = [...lista];
  const j = i + d;
  if (j < 0 || j >= n.length) return n;
  [n[i], n[j]] = [n[j]!, n[i]!];
  return n;
};

export function Personalizacao() {
  const qc = useQueryClient();
  const estado = useQuery({ queryKey: ['personalizacao'], queryFn: () => api<Estado>('/admin/personalizacao') });
  const empresa = useQuery({ queryKey: ['empresa-site'], queryFn: () => api<EmpresaSite>('/public/empresa', { semRenovar: true }), retry: false });
  const servicos = useQuery({ queryKey: ['catalogo'], queryFn: () => api<ServicoSite[]>('/public/servicos', { semRenovar: true }) });
  const equipe = useQuery({ queryKey: ['equipe-site'], queryFn: () => api<MembroSite[]>('/public/equipe', { semRenovar: true }) });

  const [d, setD] = useState<Dados | null>(null);
  const [salvoComo, setSalvoComo] = useState<string>('');
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState<'salvar' | 'publicar' | null>(null);
  const [tela, setTela] = useState<'computador' | 'celular'>('computador');
  const [aba, setAba] = useState<'editar' | 'previa'>('editar');

  useEffect(() => {
    if (estado.data && !d) {
      setD(estado.data.rascunho);
      setSalvoComo(JSON.stringify(estado.data.rascunho));
    }
  }, [estado.data, d]);

  if (!d || !estado.data) return <Carregando />;
  const set = (p: Partial<Dados>) => setD({ ...d, ...p });
  const naoSalvo = JSON.stringify(d) !== salvoComo;
  const naoPublicado = naoSalvo || estado.data.temAlteracoes;

  async function salvar(publicar: boolean) {
    setAviso(null);
    setEnviando(publicar ? 'publicar' : 'salvar');
    try {
      let r = await api<Estado>('/admin/personalizacao/rascunho', { method: 'PUT', body: d });
      if (publicar) r = await api<Estado>('/admin/personalizacao/publicar', { method: 'POST' });
      setD(r.rascunho);
      setSalvoComo(JSON.stringify(r.rascunho));
      qc.setQueryData(['personalizacao'], r);
      qc.invalidateQueries({ queryKey: ['personalizacao-publica'] });
      setAviso({ tipo: 'sucesso', texto: publicar ? 'Publicado! O site já está com o visual novo.' : 'Rascunho salvo. O site só muda quando você publicar.' });
    } catch (e) {
      const campos = e instanceof ApiError ? Object.values(e.campos).flat().filter(Boolean) : [];
      setAviso({ tipo: 'erro', texto: e instanceof ApiError ? [e.message, ...campos].join(' · ') : 'Sem conexão com o servidor.' });
    } finally {
      setEnviando(null);
    }
  }

  async function descartar() {
    if (!window.confirm('Descartar as alterações e voltar para o que está publicado?')) return;
    const r = await api<Estado>('/admin/personalizacao/descartar', { method: 'POST' });
    setD(r.rascunho);
    setSalvoComo(JSON.stringify(r.rascunho));
    qc.setQueryData(['personalizacao'], r);
  }

  const contraste = contrasteComBranco(d.tema.corPrimaria);

  const formulario = (
    <div className="grid min-w-0 gap-4">
      <Bloco titulo="Cores e fontes">
        <div className="grid gap-2">
          <p className="text-sm font-medium">Cor principal</p>
          <div className="flex flex-wrap items-center gap-2">
            {CORES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                aria-pressed={d.tema.corPrimaria.toLowerCase() === c}
                onClick={() => set({ tema: { ...d.tema, corPrimaria: c } })}
                className={cx('size-8 rounded-full ring-offset-2', d.tema.corPrimaria.toLowerCase() === c && 'ring-2 ring-tinta')}
                style={{ backgroundColor: c }}
              />
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(d.tema.corPrimaria) ? d.tema.corPrimaria : '#26292a'}
                onChange={(e) => set({ tema: { ...d.tema, corPrimaria: e.target.value } })}
                className="size-8 cursor-pointer rounded border border-borda"
                aria-label="Outra cor"
              />
              Outra
            </label>
          </div>
          {contraste < 4.5 && <p className="text-sm text-erro">Cor clara demais: o texto branco dos botões fica ilegível. Escolha um tom mais escuro.</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Fonte dos títulos">
            {(id) => (
              <Selecao id={id} value={d.tema.fonteTitulos} onChange={(e) => set({ tema: { ...d.tema, fonteTitulos: e.target.value as Fonte } })}>
                {(Object.keys(FONTES) as Fonte[]).map((f) => (
                  <option key={f} value={f}>
                    {FONTES[f].nome}
                  </option>
                ))}
              </Selecao>
            )}
          </Campo>
          <Campo rotulo="Fonte do texto">
            {(id) => (
              <Selecao id={id} value={d.tema.fonteTexto} onChange={(e) => set({ tema: { ...d.tema, fonteTexto: e.target.value as Fonte } })}>
                {(Object.keys(FONTES) as Fonte[]).map((f) => (
                  <option key={f} value={f}>
                    {FONTES[f].nome}
                  </option>
                ))}
              </Selecao>
            )}
          </Campo>
        </div>
      </Bloco>

      <Bloco titulo="Logo e banner">
        <UploadImagem finalidade="LOGO" rotulo="Logo" formato="aspect-square" valor={d.logoUrl} aoMudar={(url) => set({ logoUrl: url })} dica="Quadrada de preferência. JPG, PNG ou WebP, até 5 MB." />
        <UploadImagem finalidade="BANNER" rotulo="Foto do banner" valor={d.bannerUrl} aoMudar={(url) => set({ bannerUrl: url })} dica="Horizontal, aparece atrás do título. Até 5 MB." />
      </Bloco>

      <Bloco titulo="Textos">
        <Campo rotulo="Título">{(id) => <Entrada id={id} maxLength={80} value={d.textos.titulo} onChange={(e) => set({ textos: { ...d.textos, titulo: e.target.value } })} />}</Campo>
        <Campo rotulo="Subtítulo">
          {(id) => <AreaTexto id={id} maxLength={200} className="min-h-16" value={d.textos.subtitulo} onChange={(e) => set({ textos: { ...d.textos, subtitulo: e.target.value } })} />}
        </Campo>
        <Campo rotulo="Texto do botão">
          {(id) => <Entrada id={id} maxLength={30} value={d.textos.chamadaBotao} onChange={(e) => set({ textos: { ...d.textos, chamadaBotao: e.target.value } })} />}
        </Campo>
        <Campo rotulo="Sobre o negócio" dica="Aparece na seção Sobre. Texto simples (sem formatação).">
          {(id, desc) => (
            <AreaTexto id={id} aria-describedby={desc} maxLength={1500} value={d.textos.sobre} onChange={(e) => set({ textos: { ...d.textos, sobre: e.target.value } })} />
          )}
        </Campo>
        <Campo rotulo="Boas-vindas na tela de agendamento" dica="Ex.: chegue 10 minutos antes.">
          {(id, desc) => (
            <AreaTexto
              id={id}
              aria-describedby={desc}
              maxLength={300}
              className="min-h-16"
              value={d.textos.boasVindasAgendamento}
              onChange={(e) => set({ textos: { ...d.textos, boasVindasAgendamento: e.target.value } })}
            />
          )}
        </Campo>
      </Bloco>

      <Bloco titulo="Seções da página" descricao="Escolha o que aparece e em que ordem (RF10).">
        <ul className="grid divide-y divide-borda rounded-md border border-borda">
          {d.secoes.map((s, i) => (
            <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className={cx('text-sm font-medium', !s.visivel && 'text-tinta-suave line-through')}>{SECOES[s.id]}</span>
              <span className="flex gap-1">
                <IconeBotao rotulo={s.visivel ? `Esconder ${SECOES[s.id]}` : `Mostrar ${SECOES[s.id]}`} onClick={() => set({ secoes: d.secoes.map((x, j) => (j === i ? { ...x, visivel: !x.visivel } : x)) })}>
                  {s.visivel ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </IconeBotao>
                <IconeBotao rotulo="Subir" desativado={i === 0} onClick={() => set({ secoes: mover(d.secoes, i, -1) })}>
                  <ArrowUp className="size-4" />
                </IconeBotao>
                <IconeBotao rotulo="Descer" desativado={i === d.secoes.length - 1} onClick={() => set({ secoes: mover(d.secoes, i, 1) })}>
                  <ArrowDown className="size-4" />
                </IconeBotao>
              </span>
            </li>
          ))}
        </ul>
      </Bloco>

      <OrdemServicos servicos={servicos.data ?? []} />

      <Bloco titulo="Galeria" descricao={`${d.galeria.length} de 24 fotos.`}>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {d.galeria.map((g, i) => (
            <li key={g.url} className="grid gap-1">
              <div className="relative">
                <img src={g.url} alt="" className="aspect-square w-full rounded-md object-cover" />
                <button
                  type="button"
                  aria-label="Tirar da galeria"
                  onClick={() => set({ galeria: d.galeria.filter((_, j) => j !== i) })}
                  className="absolute top-1 right-1 grid size-7 place-items-center rounded-full bg-white/90 text-tinta hover:text-erro"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <Entrada
                aria-label="Legenda"
                placeholder="Legenda (opcional)"
                maxLength={80}
                className="h-8 text-xs"
                value={g.legenda}
                onChange={(e) => set({ galeria: d.galeria.map((x, j) => (j === i ? { ...x, legenda: e.target.value } : x)) })}
              />
            </li>
          ))}
        </ul>
        {d.galeria.length < 24 && (
          <UploadImagem finalidade="GALERIA" rotulo="Adicionar foto" formato="aspect-square" valor={null} aoMudar={(url) => url && set({ galeria: [...d.galeria, { url, legenda: '' }] })} />
        )}
      </Bloco>

      <Bloco titulo="Depoimentos" descricao="Use só depoimentos reais, com autorização dos clientes.">
        {d.depoimentos.map((dep, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-borda p-3">
            <div className="flex items-center gap-2">
              <Entrada
                aria-label="Nome"
                placeholder="Nome do cliente"
                maxLength={60}
                value={dep.nome}
                onChange={(e) => set({ depoimentos: d.depoimentos.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)) })}
              />
              <IconeBotao rotulo="Remover depoimento" onClick={() => set({ depoimentos: d.depoimentos.filter((_, j) => j !== i) })}>
                <Trash2 className="size-4" />
              </IconeBotao>
            </div>
            <AreaTexto
              aria-label="Depoimento"
              maxLength={400}
              className="min-h-16"
              value={dep.texto}
              onChange={(e) => set({ depoimentos: d.depoimentos.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)) })}
            />
          </div>
        ))}
        {d.depoimentos.length < 12 && (
          <Botao type="button" variante="secundario" className="h-9 justify-self-start" onClick={() => set({ depoimentos: [...d.depoimentos, { nome: '', texto: '' }] })}>
            <Plus className="size-4" aria-hidden />
            Depoimento
          </Botao>
        )}
      </Bloco>

      <Bloco titulo="Perguntas no agendamento" descricao="Até 5 perguntas a mais no formulário (ex.: alergias). As respostas aparecem na agenda.">
        {d.camposExtras.map((c, i) => (
          <CampoExtraEditor
            key={c.id}
            campo={c}
            aoMudar={(n) => set({ camposExtras: d.camposExtras.map((x, j) => (j === i ? n : x)) })}
            aoRemover={() => set({ camposExtras: d.camposExtras.filter((_, j) => j !== i) })}
          />
        ))}
        {d.camposExtras.length < 5 && (
          <Botao
            type="button"
            variante="secundario"
            className="h-9 justify-self-start"
            onClick={() => set({ camposExtras: [...d.camposExtras, { id: `campo-${Date.now().toString(36)}`, rotulo: '', tipo: 'TEXTO', obrigatorio: false }] })}
          >
            <Plus className="size-4" aria-hidden />
            Pergunta
          </Botao>
        )}
      </Bloco>
    </div>
  );

  const previa = (
    <div className="grid gap-3 lg:sticky lg:top-6">
      <div className="flex items-center justify-between gap-2">
        <div role="group" aria-label="Tamanho da prévia" className="flex rounded-md border border-borda bg-superficie p-0.5">
          {(
            [
              ['computador', 'Computador', Monitor],
              ['celular', 'Celular', Smartphone],
            ] as const
          ).map(([id, rotulo, Icone]) => (
            <button
              key={id}
              type="button"
              aria-pressed={tela === id}
              onClick={() => setTela(id)}
              className={cx('inline-flex h-8 items-center gap-1.5 rounded px-3 text-sm font-medium', tela === id ? 'bg-destaque-claro text-destaque-forte' : 'text-tinta-suave hover:text-tinta')}
            >
              <Icone className="size-4" aria-hidden />
              {rotulo}
            </button>
          ))}
        </div>
        <a href="/" target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm font-medium text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
          Site publicado
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      <Previa largura={tela === 'computador' ? 1200 : 390}>
        <Landing empresa={empresa.data ?? null} p={d} servicos={servicos.data ?? []} equipe={equipe.data ?? []} previa />
      </Previa>
    </div>
  );

  return (
    <>
      <Cabecalho
        titulo="Site"
        descricao="Visual da página inicial e da tela de agendamento. Edite, confira na prévia e publique."
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            {naoPublicado ? <Selo cor="alerta">{naoSalvo ? 'Alterações não salvas' : 'Rascunho não publicado'}</Selo> : <Selo cor="verde">Publicado</Selo>}
          </div>
        }
      />
      {aviso && (
        <div className="mb-4">
          <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>
        </div>
      )}
      <div className="sticky top-0 z-20 -mx-4 mb-6 flex flex-wrap items-center gap-2 border-b border-borda bg-fundo/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12">
        <Botao carregando={enviando === 'publicar'} disabled={!naoPublicado || contraste < 4.5} onClick={() => salvar(true)}>
          Publicar
        </Botao>
        <Botao variante="secundario" carregando={enviando === 'salvar'} disabled={!naoSalvo} onClick={() => salvar(false)}>
          Salvar rascunho
        </Botao>
        {estado.data.temAlteracoes && (
          <Botao variante="fantasma" onClick={descartar}>
            Descartar alterações
          </Botao>
        )}
        <div role="tablist" className="ml-auto flex gap-1 lg:hidden">
          {(['editar', 'previa'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={aba === t}
              onClick={() => setAba(t)}
              className={cx('h-9 rounded-md px-3 text-sm font-medium', aba === t ? 'bg-destaque-claro text-destaque-forte' : 'text-tinta-suave')}
            >
              {t === 'editar' ? 'Editar' : 'Prévia'}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className={cx(aba === 'previa' && 'hidden lg:block')}>{formulario}</div>
        <div className={cx(aba === 'editar' && 'hidden lg:block')}>{previa}</div>
      </div>
    </>
  );
}

// RF08: a mesma Landing do site, reduzida para caber no painel
function Previa({ largura, children }: { largura: number; children: ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.5);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setZoom(Math.min(1, el.clientWidth / largura));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [largura]);
  return (
    <div ref={caixa} className="h-[70vh] overflow-y-auto overflow-x-hidden rounded-lg border border-borda bg-superficie shadow-sm" aria-label="Prévia do site">
      <div style={{ width: largura, zoom }} className="mx-auto">
        {children}
      </div>
    </div>
  );
}

function Bloco({ titulo, descricao, children }: { titulo: string; descricao?: string; children: ReactNode }) {
  return (
    <details open className="group rounded-lg border border-borda bg-superficie">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold">
        {titulo}
        <ArrowDown className="size-4 text-tinta-suave transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="grid gap-4 border-t border-borda px-4 py-4">
        {descricao && <p className="-mt-1 text-sm text-tinta-suave">{descricao}</p>}
        {children}
      </div>
    </details>
  );
}

function IconeBotao({ rotulo, onClick, desativado, children }: { rotulo: string; onClick: () => void; desativado?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={rotulo} title={rotulo} disabled={desativado} onClick={onClick} className="grid size-8 place-items-center rounded text-tinta-suave hover:bg-fundo hover:text-tinta disabled:opacity-30">
      {children}
    </button>
  );
}

function CampoExtraEditor({ campo, aoMudar, aoRemover }: { campo: CampoExtra; aoMudar: (c: CampoExtra) => void; aoRemover: () => void }) {
  return (
    <div className="grid gap-2 rounded-md border border-borda p-3">
      <div className="flex items-center gap-2">
        <Entrada aria-label="Pergunta" placeholder="Ex.: Tem alergia a algum produto?" maxLength={80} value={campo.rotulo} onChange={(e) => aoMudar({ ...campo, rotulo: e.target.value })} />
        <IconeBotao rotulo="Remover pergunta" onClick={aoRemover}>
          <Trash2 className="size-4" />
        </IconeBotao>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Selecao aria-label="Tipo de resposta" className="w-auto" value={campo.tipo} onChange={(e) => aoMudar({ ...campo, tipo: e.target.value as CampoExtra['tipo'] })}>
          <option value="TEXTO">Resposta escrita</option>
          <option value="SIM_NAO">Caixa de marcar</option>
        </Selecao>
        <Interruptor ligado={campo.obrigatorio} aoMudar={(v) => aoMudar({ ...campo, obrigatorio: v })} rotulo="Obrigatória" />
      </div>
    </div>
  );
}

// RF07: ordem dos serviços (salva na hora, vale para o site e para a tela de agendamento)
function OrdemServicos({ servicos }: { servicos: ServicoSite[] }) {
  const qc = useQueryClient();
  const [lista, setLista] = useState(servicos);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => setLista(servicos), [servicos]);
  if (servicos.length < 2) return null;

  async function trocar(i: number, d: -1 | 1) {
    const nova = mover(lista, i, d);
    setLista(nova);
    setErro(null);
    try {
      await api('/admin/servicos/ordem', { method: 'PUT', body: { ids: nova.map((s) => s.id) } });
      qc.invalidateQueries({ queryKey: ['catalogo'] });
      qc.invalidateQueries({ queryKey: ['servicos'] });
    } catch {
      setErro('Não foi possível salvar a ordem.');
      setLista(lista);
    }
  }

  return (
    <Bloco titulo="Ordem dos serviços" descricao="Muda na hora, no site e na tela de agendamento.">
      {erro && <Aviso>{erro}</Aviso>}
      <ul className="grid divide-y divide-borda rounded-md border border-borda">
        {lista.map((s, i) => (
          <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="truncate text-sm font-medium">{s.nome}</span>
            <span className="flex gap-1">
              <IconeBotao rotulo={`Subir ${s.nome}`} desativado={i === 0} onClick={() => trocar(i, -1)}>
                <ArrowUp className="size-4" />
              </IconeBotao>
              <IconeBotao rotulo={`Descer ${s.nome}`} desativado={i === lista.length - 1} onClick={() => trocar(i, 1)}>
                <ArrowDown className="size-4" />
              </IconeBotao>
            </span>
          </li>
        ))}
      </ul>
    </Bloco>
  );
}
