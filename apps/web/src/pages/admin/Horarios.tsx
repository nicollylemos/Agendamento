import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { hojeISO, semanaVazia, somarDias, type Bloqueio, type DiaSemana, type Excecao } from '../../lib/horarios';
import { formatarDuracao } from '../../lib/formato';
import { useSalvar } from '../../lib/useSalvar';
import { EditorSemana } from '../../components/horarios/EditorSemana';
import { ListaBloqueios, ListaExcecoes } from '../../components/horarios/Excecoes';
import { Modal } from '../../components/Modal';
import { Aviso, Botao, Cabecalho, Campo, Carregando, cx, Entrada, Secao, Selecao } from '../../components/ui';

// RF16, RF17, RF18, RF20

interface Funcionario {
  id: string;
  nome: string;
  ativo: boolean;
}

interface Modelo {
  id: string;
  nome: string;
  semana: DiaSemana[];
}

const ABAS = [
  { id: 'equipe', rotulo: 'Por pessoa' },
  { id: 'modelos', rotulo: 'Modelos de jornada' },
  { id: 'livres', rotulo: 'Horários livres' },
] as const;

export function Horarios() {
  const [aba, setAba] = useState<(typeof ABAS)[number]['id']>('equipe');

  return (
    <>
      <Cabecalho titulo="Horários" descricao="Quando cada pessoa atende. A agenda online só oferece horários que estão dentro disso." />
      <div role="tablist" className="mb-8 flex gap-1 border-b border-borda">
        {ABAS.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => setAba(a.id)}
            className={cx(
              '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium',
              aba === a.id ? 'border-destaque text-tinta' : 'border-transparent text-tinta-suave hover:text-tinta',
            )}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      {aba === 'equipe' && <PorPessoa />}
      {aba === 'modelos' && <Modelos />}
      {aba === 'livres' && <HorariosLivres />}
    </>
  );
}

function PorPessoa() {
  const funcionarios = useQuery({ queryKey: ['funcionarios'], queryFn: () => api<Funcionario[]>('/admin/funcionarios') });
  const [id, setId] = useState<string>('');

  useEffect(() => {
    if (!id && funcionarios.data?.[0]) setId(funcionarios.data[0].id);
  }, [funcionarios.data, id]);

  if (funcionarios.isLoading) return <Carregando />;
  if (!funcionarios.data?.length) return <Aviso tipo="alerta">Nenhum profissional cadastrado ainda. Cadastre em Equipe → Novo profissional.</Aviso>;

  return (
    <>
      <div className="mb-6 max-w-xs">
        <Campo rotulo="Pessoa">
          {(cid) => (
            <Selecao id={cid} value={id} onChange={(e) => setId(e.target.value)}>
              {funcionarios.data.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                  {!f.ativo ? ' (desativado)' : ''}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
      </div>
      {id && <HorariosDaPessoa key={id} funcionarioId={id} />}
    </>
  );
}

function HorariosDaPessoa({ funcionarioId }: { funcionarioId: string }) {
  const qc = useQueryClient();
  const de = hojeISO();
  const ate = somarDias(de, 90);
  const jornada = useQuery({ queryKey: ['jornada', funcionarioId], queryFn: () => api<DiaSemana[]>(`/admin/horarios/funcionarios/${funcionarioId}/jornada`) });
  const modelos = useQuery({ queryKey: ['modelos'], queryFn: () => api<Modelo[]>('/admin/horarios/modelos') });
  const excecoes = useQuery({ queryKey: ['excecoes', funcionarioId], queryFn: () => api<Excecao[]>(`/admin/horarios/excecoes?de=${de}&ate=${ate}&funcionarioId=${funcionarioId}`) });
  const bloqueios = useQuery({ queryKey: ['bloqueios', funcionarioId], queryFn: () => api<Bloqueio[]>(`/admin/horarios/bloqueios?de=${de}&ate=${ate}&funcionarioId=${funcionarioId}`) });
  const [semana, setSemana] = useState<DiaSemana[] | null>(null);
  const [modeloId, setModeloId] = useState('');
  const { salvando, erro, salvo, executar } = useSalvar();

  useEffect(() => {
    if (jornada.data) setSemana(jornada.data);
  }, [jornada.data]);

  async function salvar() {
    const r = await executar(() => api<DiaSemana[]>(`/admin/horarios/funcionarios/${funcionarioId}/jornada`, { method: 'PUT', body: { semana } }));
    if (r) qc.setQueryData(['jornada', funcionarioId], r);
  }

  async function aplicar() {
    const r = await executar(() =>
      api<DiaSemana[]>(`/admin/horarios/funcionarios/${funcionarioId}/jornada/aplicar-modelo`, { method: 'POST', body: { modeloId } }),
    );
    if (r) qc.setQueryData(['jornada', funcionarioId], r);
  }

  if (!semana) return <Carregando />;

  return (
    <>
      <Secao titulo="Jornada da semana" descricao="Use mais de uma faixa no mesmo dia para marcar o intervalo de almoço.">
        {erro && <Aviso>{erro}</Aviso>}
        {salvo && <Aviso tipo="sucesso">Jornada salva.</Aviso>}
        {Boolean(modelos.data?.length) && (
          <div className="flex flex-wrap items-end gap-2">
            <Campo rotulo="Começar a partir de um modelo" className="min-w-56">
              {(id) => (
                <Selecao id={id} value={modeloId} onChange={(e) => setModeloId(e.target.value)}>
                  <option value="">Escolha um modelo</option>
                  {modelos.data!.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
                </Selecao>
              )}
            </Campo>
            <Botao variante="secundario" disabled={!modeloId} onClick={aplicar} carregando={salvando}>
              Aplicar modelo
            </Botao>
          </div>
        )}
        <EditorSemana valor={semana} aoMudar={setSemana} />
        <Botao onClick={salvar} carregando={salvando} className="justify-self-start">
          Salvar jornada
        </Botao>
      </Secao>

      <Secao titulo="Folgas e horários especiais" descricao="Para um dia específico, substituem a jornada da semana.">
        <ListaExcecoes
          base="/admin/horarios"
          funcionarioId={funcionarioId}
          itens={excecoes.data ?? []}
          podeEditar
          permiteGeral
          aoMudar={() => qc.invalidateQueries({ queryKey: ['excecoes'] })}
        />
      </Secao>

      <Secao titulo="Bloqueios" descricao="Um período em que a pessoa não pode atender, como uma consulta ou reunião.">
        <ListaBloqueios
          base="/admin/horarios"
          funcionarioId={funcionarioId}
          itens={bloqueios.data ?? []}
          podeEditar
          aoMudar={() => qc.invalidateQueries({ queryKey: ['bloqueios', funcionarioId] })}
        />
      </Secao>
    </>
  );
}

// RF16
function Modelos() {
  const qc = useQueryClient();
  const modelos = useQuery({ queryKey: ['modelos'], queryFn: () => api<Modelo[]>('/admin/horarios/modelos') });
  const [editando, setEditando] = useState<Modelo | 'novo' | null>(null);

  async function remover(id: string) {
    await api(`/admin/horarios/modelos/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['modelos'] });
  }

  if (modelos.isLoading) return <Carregando />;

  return (
    <div className="grid gap-4">
      <p className="max-w-xl text-sm text-tinta-suave">
        Um modelo é um ponto de partida, como "Comercial seg a sex". Ao aplicar, a jornada é copiada para a pessoa e pode ser ajustada sem mudar o modelo.
      </p>
      {modelos.data?.length ? (
        <ul className="grid divide-y divide-borda rounded-lg border border-borda bg-superficie">
          {modelos.data.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-3">
              <button onClick={() => setEditando(m)} className="font-semibold hover:text-destaque">
                {m.nome}
              </button>
              <button onClick={() => remover(m.id)} className="rounded p-1 text-tinta-suave hover:text-erro" aria-label={`Excluir modelo ${m.nome}`}>
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-tinta-suave">Nenhum modelo ainda.</p>
      )}
      <Botao variante="secundario" onClick={() => setEditando('novo')} className="justify-self-start">
        <Plus className="size-4" aria-hidden />
        Novo modelo
      </Botao>

      <Modal aberto={editando !== null} aoFechar={() => setEditando(null)} titulo={editando === 'novo' ? 'Novo modelo' : 'Editar modelo'} largura="max-w-3xl">
        {editando && (
          <FormModelo
            modelo={editando === 'novo' ? null : editando}
            aoConcluir={() => {
              setEditando(null);
              qc.invalidateQueries({ queryKey: ['modelos'] });
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function FormModelo({ modelo, aoConcluir }: { modelo: Modelo | null; aoConcluir: () => void }) {
  const [nome, setNome] = useState(modelo?.nome ?? '');
  const [semana, setSemana] = useState<DiaSemana[]>(modelo?.semana ?? semanaVazia());
  const { salvando, erro, campos, executar } = useSalvar();

  async function salvar() {
    const ok = await executar(() =>
      (modelo
        ? api(`/admin/horarios/modelos/${modelo.id}`, { method: 'PATCH', body: { nome, semana } })
        : api('/admin/horarios/modelos', { method: 'POST', body: { nome, semana } })
      ).then(() => true),
    );
    if (ok) aoConcluir();
  }

  return (
    <div className="grid gap-5">
      {erro && <Aviso>{erro}</Aviso>}
      <Campo rotulo="Nome do modelo" erro={campos.nome}>
        {(id) => <Entrada id={id} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} placeholder="Ex.: Comercial seg a sex" />}
      </Campo>
      <EditorSemana valor={semana} aoMudar={setSemana} />
      <Botao onClick={salvar} carregando={salvando} className="justify-self-end">
        {modelo ? 'Salvar modelo' : 'Criar modelo'}
      </Botao>
    </div>
  );
}

// RF20: o que o cliente vai ver ao escolher serviço e data
function HorariosLivres() {
  const servicos = useQuery({ queryKey: ['servicos-ativos'], queryFn: () => api<{ id: string; nome: string }[]>('/admin/servicos') });
  const [servicoId, setServicoId] = useState('');
  const [data, setData] = useState(hojeISO());
  const livres = useQuery({
    enabled: Boolean(servicoId),
    queryKey: ['livres', servicoId, data],
    queryFn: () =>
      api<{ profissionais: { id: string; nome: string; duracaoMin: number; horarios: string[] }[] }>(
        `/admin/horarios/disponibilidade?servicoId=${servicoId}&data=${data}`,
      ),
  });

  return (
    <div className="grid gap-6">
      <p className="max-w-xl text-sm text-tinta-suave">Confira os horários que um cliente veria para um serviço numa data. Já desconta folgas, bloqueios e o intervalo de limpeza.</p>
      <div className="grid gap-4 sm:grid-cols-2 sm:max-w-xl">
        <Campo rotulo="Serviço">
          {(id) => (
            <Selecao id={id} value={servicoId} onChange={(e) => setServicoId(e.target.value)}>
              <option value="">Escolha um serviço</option>
              {servicos.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo="Data">{(id) => <Entrada id={id} type="date" value={data} min={hojeISO()} max={somarDias(hojeISO(), 60)} onChange={(e) => setData(e.target.value)} />}</Campo>
      </div>

      {livres.isLoading && <Carregando />}
      {livres.error && <Aviso>{(livres.error as Error).message}</Aviso>}
      {livres.data &&
        (livres.data.profissionais.length === 0 ? (
          <Aviso tipo="alerta">Ninguém faz esse serviço ainda. Defina quem faz em Serviços.</Aviso>
        ) : (
          <div className="grid gap-5">
            {livres.data.profissionais.map((p) => (
              <div key={p.id} className="grid gap-2">
                <p className="font-semibold">
                  {p.nome} <span className="font-normal text-tinta-suave">({formatarDuracao(p.duracaoMin)})</span>
                </p>
                {p.horarios.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {p.horarios.map((h) => (
                      <li key={h} className="rounded-md border border-borda bg-superficie px-3 py-1.5 text-sm">
                        {h}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-tinta-suave">Sem horários livres nesse dia.</p>
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
