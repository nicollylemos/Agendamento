import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, MessageCircle, Phone, ShieldCheck, UserPlus } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { NOME_PERFIL } from '../../lib/formato';
import { useSalvar } from '../../lib/useSalvar';
import { useAuth } from '../../auth/AuthContext';
import { Modal } from '../../components/Modal';
import { UploadImagem } from '../../components/UploadImagem';
import { AreaTexto, Aviso, Botao, Cabecalho, Campo, Carregando, Entrada, Interruptor, Secao, Selecao, Selo } from '../../components/ui';

// RF13 (profissional cadastrado direto, sem login), RF02 (acesso ao painel opcional, com mensagem
// pronta para o WhatsApp), RF05 (desativar), RF19/RF54 (permissão de horário e comissão), 9.2 (perfil com reautenticação)

type Perfil = keyof typeof NOME_PERFIL;

interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  totpAtivo: boolean;
}

interface Profissional {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  ativo: boolean;
  acesso: { usuarioId: string; email: string; perfil: Perfil; ativo: boolean } | null;
  convitePendente: boolean;
  cargo: string | null;
  bio: string | null;
  comissaoPadraoPct: number;
  podeEditarHorario: boolean;
  exibirNoSite: boolean;
  fotoUrl: string | null;
  servicoIds: string[];
}

interface Convite {
  link: string;
  mensagem: string;
  expiraEm: string;
}

type Acao =
  | { tipo: 'profissional'; profissional: Profissional | null; usuarioId?: string; nomeSugerido?: string }
  | { tipo: 'acesso'; profissional: Profissional }
  | { tipo: 'convite'; convite: Convite; telefone: string | null; nome: string }
  | { tipo: 'convidar-avulso' }
  | { tipo: 'perfil'; usuario: Usuario };

const formatarTelefone = (t: string) =>
  t.length === 11 ? `(${t.slice(0, 2)}) ${t.slice(2, 7)}-${t.slice(7)}` : `(${t.slice(0, 2)}) ${t.slice(2, 6)}-${t.slice(6)}`;

const linkTexto = 'justify-self-start text-left text-sm font-medium text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current';

export function Equipe() {
  const qc = useQueryClient();
  const { usuario: eu } = useAuth();
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => api<Usuario[]>('/admin/usuarios') });
  const profissionais = useQuery({ queryKey: ['funcionarios'], queryFn: () => api<Profissional[]>('/admin/funcionarios') });
  const [acao, setAcao] = useState<Acao | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);

  const atualizar = () => {
    ['usuarios', 'funcionarios', 'servicos', 'progresso-inicial', 'agenda-opcoes'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  async function executar(fn: () => Promise<unknown>, sucesso: string) {
    setAviso(null);
    try {
      await fn();
      setAviso({ tipo: 'sucesso', texto: sucesso });
      atualizar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof ApiError ? e.message : 'Sem conexão com o servidor.' });
    }
  }

  const alternarProfissional = (p: Profissional) =>
    executar(
      () => api(`/admin/funcionarios/${p.id}`, { method: 'PATCH', body: { ativo: !p.ativo } }),
      p.ativo ? `${p.nome} não recebe mais agendamentos.` : `${p.nome} voltou a receber agendamentos.`,
    );

  const alternarUsuario = (u: Usuario) =>
    executar(
      () => api(`/admin/usuarios/${u.id}/status`, { method: 'PATCH', body: { ativo: !u.ativo } }),
      u.ativo ? `${u.nome} perdeu o acesso e saiu de todos os dispositivos.` : `${u.nome} voltou a ter acesso.`,
    );

  const euAtendo = profissionais.data?.some((p) => p.acesso?.usuarioId === eu?.id);
  const lista = profissionais.data ?? [];

  return (
    <>
      <Cabecalho
        titulo="Equipe"
        descricao="Cadastre quem atende. Dar acesso ao painel é opcional."
        acoes={
          <Botao onClick={() => setAcao({ tipo: 'profissional', profissional: null })}>
            <UserPlus className="size-4" aria-hidden />
            Novo profissional
          </Botao>
        }
      />

      {aviso && (
        <div className="mb-6">
          <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>
        </div>
      )}

      {usuarios.isLoading || profissionais.isLoading ? (
        <Carregando />
      ) : (
        <div>
          <Secao titulo="Profissionais" descricao="Quem aparece na agenda e pode ser escolhido pelos clientes.">
            {!lista.length ? (
              <div className="rounded-lg border border-dashed border-borda bg-superficie px-5 py-8 text-center">
                <p className="font-semibold">Nenhum profissional ainda</p>
                <p className="mt-1 text-sm text-tinta-suave">Cadastre quem atende para os serviços aparecerem na página de agendamento.</p>
              </div>
            ) : (
              <ul className="grid divide-y divide-borda rounded-lg border border-borda bg-superficie">
                {lista.map((p) => (
                  <li key={p.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="grid gap-1">
                      <p className={p.ativo ? 'font-semibold' : 'font-semibold text-tinta-suave'}>
                        {p.nome}
                        {p.cargo && <span className="font-normal text-tinta-suave"> · {p.cargo}</span>}
                        {p.acesso?.usuarioId === eu?.id && <span className="font-normal text-tinta-suave"> (você)</span>}
                      </p>
                      {p.telefone && (
                        <p className="flex items-center gap-1.5 text-sm text-tinta-suave">
                          <Phone className="size-3.5" aria-hidden />
                          {formatarTelefone(p.telefone)}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {!p.ativo && <Selo cor="cinza">Inativo</Selo>}
                        {p.ativo && !p.exibirNoSite && <Selo cor="alerta">Fora do site</Selo>}
                        {p.ativo && !p.servicoIds.length && <Selo cor="alerta">Sem serviços</Selo>}
                        {p.acesso ? (
                          <Selo cor="verde">
                            Acessa o painel: {NOME_PERFIL[p.acesso.perfil]}
                            {!p.acesso.ativo && ' (bloqueado)'}
                          </Selo>
                        ) : p.convitePendente ? (
                          <Selo cor="alerta">Link enviado, aguardando</Selo>
                        ) : (
                          <Selo>Sem acesso ao painel</Selo>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Botao variante="secundario" onClick={() => setAcao({ tipo: 'profissional', profissional: p })}>
                        Editar
                      </Botao>
                      {!p.acesso && p.ativo && (
                        <Botao variante="secundario" onClick={() => setAcao({ tipo: 'acesso', profissional: p })}>
                          <KeyRound className="size-4" aria-hidden />
                          {p.convitePendente ? 'Novo link' : 'Dar acesso'}
                        </Botao>
                      )}
                      <Botao variante={p.ativo ? 'perigo' : 'secundario'} onClick={() => alternarProfissional(p)}>
                        {p.ativo ? 'Desativar' : 'Reativar'}
                      </Botao>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {!euAtendo && eu && (
              <button
                type="button"
                className={linkTexto}
                onClick={() => setAcao({ tipo: 'profissional', profissional: null, usuarioId: eu.id, nomeSugerido: eu.nome })}
              >
                Você também atende? Cadastre-se como profissional
              </button>
            )}
          </Secao>

          <Secao titulo="Acessos ao painel" descricao="Quem entra no sistema com e-mail e senha.">
            <ul className="grid divide-y divide-borda rounded-lg border border-borda bg-superficie">
              {usuarios.data?.map((u) => {
                const souEu = u.id === eu?.id;
                return (
                  <li key={u.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="grid gap-1">
                      <p className="font-semibold">
                        {u.nome} {souEu && <span className="font-normal text-tinta-suave">(você)</span>}
                      </p>
                      <p className="text-sm text-tinta-suave">{u.email}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Selo>{NOME_PERFIL[u.perfil]}</Selo>
                        {!u.ativo && <Selo cor="cinza">Bloqueado</Selo>}
                        {u.totpAtivo && (
                          <Selo cor="neutro">
                            <ShieldCheck className="mr-1 size-3" aria-hidden />
                            2FA
                          </Selo>
                        )}
                      </div>
                    </div>
                    {!souEu && (
                      <div className="flex flex-wrap gap-2">
                        <Botao variante="secundario" onClick={() => setAcao({ tipo: 'perfil', usuario: u })}>
                          Perfil de acesso
                        </Botao>
                        <Botao variante={u.ativo ? 'perigo' : 'secundario'} onClick={() => alternarUsuario(u)}>
                          {u.ativo ? 'Bloquear acesso' : 'Liberar acesso'}
                        </Botao>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <button type="button" className={linkTexto} onClick={() => setAcao({ tipo: 'convidar-avulso' })}>
              Dar acesso a alguém que não atende (ex.: gerente, recepção)
            </button>
          </Secao>
        </div>
      )}

      <Modal
        aberto={acao?.tipo === 'profissional'}
        aoFechar={() => setAcao(null)}
        titulo={acao?.tipo === 'profissional' && acao.profissional ? 'Editar profissional' : 'Novo profissional'}
      >
        {acao?.tipo === 'profissional' && (
          <FormProfissional
            profissional={acao.profissional}
            usuarioId={acao.usuarioId}
            nomeSugerido={acao.nomeSugerido}
            aoConcluir={(nome, novo) => {
              setAcao(null);
              atualizar();
              setAviso({
                tipo: 'sucesso',
                texto: novo ? `${nome} foi cadastrado. Agora marque os serviços que ele faz em Serviços → Quem faz.` : 'Alterações salvas.',
              });
            }}
          />
        )}
      </Modal>

      <Modal aberto={acao?.tipo === 'acesso'} aoFechar={() => setAcao(null)} titulo="Acesso ao painel">
        {acao?.tipo === 'acesso' && (
          <FormAcesso
            profissional={acao.profissional}
            aoConcluir={(convite) => {
              atualizar();
              setAcao({ tipo: 'convite', convite, telefone: acao.profissional.telefone, nome: acao.profissional.nome });
            }}
          />
        )}
      </Modal>

      <Modal aberto={acao?.tipo === 'convidar-avulso'} aoFechar={() => setAcao(null)} titulo="Dar acesso ao painel">
        {acao?.tipo === 'convidar-avulso' && (
          <FormConviteAvulso
            aoConcluir={(convite, nome) => {
              atualizar();
              setAcao({ tipo: 'convite', convite, telefone: null, nome });
            }}
          />
        )}
      </Modal>

      <Modal aberto={acao?.tipo === 'convite'} aoFechar={() => setAcao(null)} titulo="Mande a mensagem">
        {acao?.tipo === 'convite' && <MensagemConvite convite={acao.convite} telefone={acao.telefone} nome={acao.nome} aoFechar={() => setAcao(null)} />}
      </Modal>

      <Modal aberto={acao?.tipo === 'perfil'} aoFechar={() => setAcao(null)} titulo="Perfil de acesso">
        {acao?.tipo === 'perfil' && <FormPerfil usuario={acao.usuario} aoConcluir={() => (setAcao(null), atualizar())} />}
      </Modal>
    </>
  );
}

// RF13: cadastro direto. Nome é o único campo obrigatório.
function FormProfissional({
  profissional,
  usuarioId,
  nomeSugerido,
  aoConcluir,
}: {
  profissional: Profissional | null;
  usuarioId?: string;
  nomeSugerido?: string;
  aoConcluir: (nome: string, novo: boolean) => void;
}) {
  const { salvando, erro, campos, executar } = useSalvar();
  const [dados, setDados] = useState({
    nome: profissional?.nome ?? nomeSugerido ?? '',
    telefone: profissional?.telefone ? formatarTelefone(profissional.telefone) : '',
    email: profissional?.email ?? '',
    cargo: profissional?.cargo ?? '',
    bio: profissional?.bio ?? '',
    comissaoPadraoPct: profissional?.comissaoPadraoPct ?? 0,
    podeEditarHorario: profissional?.podeEditarHorario ?? false,
    exibirNoSite: profissional?.exibirNoSite ?? true,
    fotoUrl: profissional?.fotoUrl ?? null, // RF09: aparece na equipe do site
  });
  const set = (parcial: Partial<typeof dados>) => setDados({ ...dados, ...parcial });
  // RF13: profissional novo já entra em todos os serviços (sem isso o serviço não aparece no site)
  const [fazTodos, setFazTodos] = useState(true);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const ok = await executar(() =>
      (profissional
        ? api(`/admin/funcionarios/${profissional.id}`, { method: 'PATCH', body: dados })
        : api('/admin/funcionarios', { method: 'POST', body: { ...dados, fazTodosServicos: fazTodos, ...(usuarioId && { usuarioId }) } })
      ).then(() => true),
    );
    if (ok) aoConcluir(dados.nome, !profissional);
  }

  return (
    <form onSubmit={salvar} className="grid gap-5">
      {erro && <Aviso>{erro}</Aviso>}
      <Campo rotulo="Nome" erro={campos.nome}>
        {(id) => <Entrada id={id} required minLength={2} maxLength={120} autoFocus value={dados.nome} onChange={(e) => set({ nome: e.target.value })} />}
      </Campo>
      <div className="grid gap-5 sm:grid-cols-2">
        <Campo rotulo="WhatsApp" dica="Opcional. Com DDD." erro={campos.telefone}>
          {(id, desc) => (
            <Entrada
              id={id}
              aria-describedby={desc}
              type="tel"
              inputMode="tel"
              maxLength={20}
              placeholder="(15) 99999-0000"
              value={dados.telefone}
              onChange={(e) => set({ telefone: e.target.value })}
            />
          )}
        </Campo>
        <Campo rotulo="Cargo" dica="Aparece para o cliente." erro={campos.cargo}>
          {(id, desc) => <Entrada id={id} aria-describedby={desc} maxLength={80} placeholder="Ex.: manicure" value={dados.cargo} onChange={(e) => set({ cargo: e.target.value })} />}
        </Campo>
      </div>
      <Campo rotulo="E-mail" dica="Opcional. Só é usado se você der acesso ao painel." erro={campos.email}>
        {(id, desc) => <Entrada id={id} aria-describedby={desc} type="email" maxLength={254} value={dados.email} onChange={(e) => set({ email: e.target.value })} />}
      </Campo>
      <UploadImagem finalidade="EQUIPE" rotulo="Foto" formato="aspect-square" valor={dados.fotoUrl} aoMudar={(url) => set({ fotoUrl: url })} dica="Aparece na seção Equipe do site." />
      <Campo rotulo="Apresentação" erro={campos.bio}>
        {(id) => <AreaTexto id={id} maxLength={1000} value={dados.bio} onChange={(e) => set({ bio: e.target.value })} />}
      </Campo>
      <Campo rotulo="Comissão padrão (%)" dica="Usada nos relatórios de comissão." erro={campos.comissaoPadraoPct}>
        {(id, desc) => (
          <Entrada
            id={id}
            aria-describedby={desc}
            type="number"
            min={0}
            max={100}
            step={0.5}
            className="w-32"
            value={dados.comissaoPadraoPct}
            onChange={(e) => set({ comissaoPadraoPct: Number(e.target.value) })}
          />
        )}
      </Campo>
      <Interruptor ligado={dados.exibirNoSite} aoMudar={(v) => set({ exibirNoSite: v })} rotulo="Aparece para os clientes escolherem no site" />
      {!profissional && (
        <Interruptor ligado={fazTodos} aoMudar={setFazTodos} rotulo="Faz todos os serviços cadastrados (dá para ajustar em Serviços)" />
      )}
      <Interruptor ligado={dados.podeEditarHorario} aoMudar={(v) => set({ podeEditarHorario: v })} rotulo="Pode ajustar os próprios horários (se tiver acesso ao painel)" />
      <Botao type="submit" carregando={salvando}>
        {profissional ? 'Salvar alterações' : 'Cadastrar profissional'}
      </Botao>
    </form>
  );
}

// RF02: gera o link de acesso (48 h, uso único) para um profissional já cadastrado
function FormAcesso({ profissional, aoConcluir }: { profissional: Profissional; aoConcluir: (c: Convite) => void }) {
  const { salvando, erro, campos, executar } = useSalvar();
  const [email, setEmail] = useState(profissional.email ?? '');
  const [perfil, setPerfil] = useState<'FUNCIONARIO' | 'GERENTE'>('FUNCIONARIO');

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const convite = await executar(() => api<Convite>(`/admin/funcionarios/${profissional.id}/acesso`, { method: 'POST', body: { email, perfil } }));
    if (convite) aoConcluir(convite);
  }

  return (
    <form onSubmit={enviar} className="grid gap-5">
      <p className="text-sm text-tinta-suave">
        Com acesso, {profissional.nome.split(' ')[0]} vê a própria agenda pelo celular. Vamos gerar uma mensagem com o link para você mandar no WhatsApp.
      </p>
      {erro && <Aviso>{erro}</Aviso>}
      <Campo rotulo="E-mail para entrar" erro={campos.email}>
        {(id) => <Entrada id={id} type="email" required maxLength={254} autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Campo>
      <Campo rotulo="O que pode ver" dica="Gerente vê a agenda de todos. Funcionário vê só a própria.">
        {(id, desc) => (
          <Selecao id={id} aria-describedby={desc} value={perfil} onChange={(e) => setPerfil(e.target.value as typeof perfil)}>
            <option value="FUNCIONARIO">Funcionário: só a própria agenda</option>
            <option value="GERENTE">Gerente: agenda de todos</option>
          </Selecao>
        )}
      </Campo>
      <Botao type="submit" carregando={salvando}>
        Gerar mensagem
      </Botao>
    </form>
  );
}

function FormConviteAvulso({ aoConcluir }: { aoConcluir: (c: Convite, nome: string) => void }) {
  const { salvando, erro, campos, executar } = useSalvar();

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const nome = String(form.get('nome'));
    const convite = await executar(() =>
      api<Convite>('/admin/usuarios/convites', { method: 'POST', body: { nome, email: form.get('email'), perfil: form.get('perfil') } }),
    );
    if (convite) aoConcluir(convite, nome);
  }

  return (
    <form onSubmit={enviar} className="grid gap-5">
      <p className="text-sm text-tinta-suave">Para quem não atende clientes. Quem atende, cadastre como profissional e use “Dar acesso”.</p>
      {erro && <Aviso>{erro}</Aviso>}
      <Campo rotulo="Nome" erro={campos.nome}>
        {(id) => <Entrada id={id} name="nome" required minLength={2} maxLength={120} autoFocus />}
      </Campo>
      <Campo rotulo="E-mail" erro={campos.email}>
        {(id) => <Entrada id={id} name="email" type="email" required />}
      </Campo>
      <Campo rotulo="Perfil">
        {(id) => (
          <Selecao id={id} name="perfil" defaultValue="GERENTE">
            <option value="GERENTE">Gerente</option>
            <option value="FUNCIONARIO">Funcionário</option>
          </Selecao>
        )}
      </Campo>
      <Botao type="submit" carregando={salvando}>
        Gerar mensagem
      </Botao>
    </form>
  );
}

// Mensagem pronta para copiar e colar no WhatsApp. O link só aparece aqui, uma vez (9.1).
function MensagemConvite({ convite, telefone, nome, aoFechar }: { convite: Convite; telefone: string | null; nome: string; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(convite.mensagem);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setCopiado(false);
    }
  }

  const whatsapp = `https://wa.me/${telefone ? `55${telefone}` : ''}?text=${encodeURIComponent(convite.mensagem)}`;

  return (
    <div className="grid gap-5">
      <p className="text-sm text-tinta-suave">Copie e mande para {nome.split(' ')[0]}. O link vale 48 horas e só funciona uma vez.</p>
      <AreaTexto readOnly rows={7} value={convite.mensagem} onFocus={(e) => e.currentTarget.select()} aria-label="Mensagem" />
      <div className="grid gap-2 sm:grid-cols-2">
        <Botao type="button" onClick={copiar}>
          {copiado ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copiado ? 'Copiada!' : 'Copiar mensagem'}
        </Botao>
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-borda bg-superficie px-4 text-sm font-semibold hover:bg-fundo"
        >
          <MessageCircle className="size-4" aria-hidden />
          Abrir no WhatsApp
        </a>
      </div>
      <Botao type="button" variante="fantasma" onClick={aoFechar}>
        Pronto
      </Botao>
    </div>
  );
}

// 9.2: trocar o perfil de acesso pede a senha (e o 2FA) de novo
function FormPerfil({ usuario, aoConcluir }: { usuario: Usuario; aoConcluir: () => void }) {
  const { usuario: eu } = useAuth();
  const { salvando, erro, executar } = useSalvar();
  const [perfil, setPerfil] = useState<Perfil>(usuario.perfil);

  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const ok = await executar(async () => {
      const { reauthToken } = await api<{ reauthToken: string }>('/auth/reautenticar', {
        method: 'POST',
        body: { senha: form.get('senha'), ...(eu?.totpAtivo && { codigo: form.get('codigo') }) },
      });
      await api(`/admin/usuarios/${usuario.id}/perfil`, { method: 'PATCH', body: { perfil }, headers: { 'X-Reauth-Token': reauthToken } });
      return true;
    });
    if (ok) aoConcluir();
  }

  return (
    <form onSubmit={salvar} className="grid gap-5">
      {erro && <Aviso>{erro}</Aviso>}
      <Campo rotulo={`Perfil de ${usuario.nome}`}>
        {(id) => (
          <Selecao id={id} value={perfil} onChange={(e) => setPerfil(e.target.value as Perfil)}>
            {(Object.keys(NOME_PERFIL) as Perfil[]).map((p) => (
              <option key={p} value={p}>
                {NOME_PERFIL[p]}
              </option>
            ))}
          </Selecao>
        )}
      </Campo>
      {perfil === 'ADMIN' && <Aviso tipo="alerta">Administradores podem tudo, inclusive mudar quem recebe os pagamentos.</Aviso>}
      <div className="grid gap-4 border-t border-borda pt-5">
        <p className="text-sm text-tinta-suave">Para mudar permissões, confirme que é você.</p>
        <Campo rotulo="Sua senha">{(id) => <Entrada id={id} name="senha" type="password" required autoComplete="current-password" />}</Campo>
        {eu?.totpAtivo && (
          <Campo rotulo="Código do app autenticador">
            {(id) => <Entrada id={id} name="codigo" required inputMode="numeric" autoComplete="one-time-code" maxLength={20} />}
          </Campo>
        )}
      </div>
      <Botao type="submit" carregando={salvando} disabled={perfil === usuario.perfil}>
        Salvar perfil
      </Botao>
    </form>
  );
}
