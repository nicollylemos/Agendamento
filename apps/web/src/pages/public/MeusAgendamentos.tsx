import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { formatarCentavos } from '../../lib/formato';
import { formatarDataLonga, NOME_STATUS, type StatusAgendamento } from '../../lib/agenda';
import { LayoutPublico } from '../../layouts/LayoutPublico';
import { Aviso, Botao, Campo, Entrada, Selo } from '../../components/ui';
import { FidelidadeCliente } from '../../components/fidelidade/FidelidadeCliente';

// RF04: o cliente não tem senha. Recebe um código por e-mail e vê os agendamentos.
// RF46: na mesma tela, vê os pontos de fidelidade e troca por recompensas.
// O token da sessão fica só em memória: fechou a aba, acabou.

interface Item {
  id: string;
  inicio: string;
  status: StatusAgendamento;
  valorCentavos: number;
  servico: string;
  profissional: string;
  podeCancelar: boolean;
}

export function MeusAgendamentos() {
  const [etapa, setEtapa] = useState<'email' | 'codigo' | 'lista'>('email');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function executar(acao: () => Promise<void>) {
    setErro(null);
    setEnviando(true);
    try {
      await acao();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Sem conexão. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  const carregar = (t: string) =>
    api<Item[]>('/public/clientes/agendamentos', { headers: { Authorization: `Bearer ${t}` }, semRenovar: true }).then(setItens);

  function pedirCodigo(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    executar(async () => {
      await api('/public/clientes/codigo', { method: 'POST', body: { email }, semRenovar: true });
      setEtapa('codigo');
    });
  }

  function entrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const codigo = new FormData(e.currentTarget).get('codigo');
    executar(async () => {
      const r = await api<{ token: string }>('/public/clientes/entrar', { method: 'POST', body: { email, codigo }, semRenovar: true });
      setToken(r.token);
      await carregar(r.token);
      setEtapa('lista');
    });
  }

  function cancelar(id: string) {
    executar(async () => {
      await api(`/public/clientes/agendamentos/${id}/cancelar`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, semRenovar: true });
      await carregar(token!);
    });
  }

  return (
    <LayoutPublico>
      <h1 className="text-2xl font-semibold tracking-tight">{etapa === 'lista' ? 'Minha conta' : 'Meus agendamentos'}</h1>
      <div className="mt-6 grid gap-5">
        {erro && <Aviso>{erro}</Aviso>}

        {etapa === 'email' && (
          <form onSubmit={pedirCodigo} className="grid gap-5 sm:max-w-sm">
            <p className="text-tinta-suave">Informe o e-mail que você usou ao agendar. Vamos mandar um código de acesso.</p>
            <Campo rotulo="E-mail">
              {(id) => <Entrada id={id} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Campo>
            <Botao type="submit" carregando={enviando}>
              Enviar código
            </Botao>
          </form>
        )}

        {etapa === 'codigo' && (
          <form onSubmit={entrar} className="grid gap-5 sm:max-w-sm">
            <p className="text-tinta-suave">Se houver agendamentos com {email}, o código chega em instantes. Ele vale 10 minutos.</p>
            <Campo rotulo="Código de 6 dígitos">
              {(id) => <Entrada id={id} name="codigo" required inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" autoFocus />}
            </Campo>
            <Botao type="submit" carregando={enviando}>
              Ver agendamentos
            </Botao>
            <Botao type="button" variante="fantasma" onClick={() => setEtapa('email')}>
              Usar outro e-mail
            </Botao>
          </form>
        )}

        {/* RF46: saldo, recompensas e extrato */}
        {etapa === 'lista' && token && <FidelidadeCliente token={token} />}
        {etapa === 'lista' && <h2 className="text-lg font-semibold">Agendamentos</h2>}

        {etapa === 'lista' &&
          (itens.length === 0 ? (
            <div className="grid gap-3">
              <p className="text-tinta-suave">Nenhum agendamento nos últimos 6 meses.</p>
              <Link to="/agendar" className="font-medium text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
                Agendar um horário
              </Link>
            </div>
          ) : (
            <ul className="grid divide-y divide-borda rounded-lg border border-borda bg-superficie">
              {itens.map((a) => (
                <li key={a.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="grid gap-1 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-base">{a.servico}</span>
                      <Selo cor={a.status === 'CONFIRMADO' ? 'verde' : 'cinza'}>{NOME_STATUS[a.status]}</Selo>
                    </p>
                    <p className="text-tinta-suave">
                      {formatarDataLonga(a.inicio)}, às {a.inicio.slice(11, 16)}, com {a.profissional}
                    </p>
                    <p>{formatarCentavos(a.valorCentavos)}</p>
                  </div>
                  {a.podeCancelar && (
                    <Botao variante="perigo" onClick={() => cancelar(a.id)} carregando={enviando}>
                      Cancelar
                    </Botao>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </LayoutPublico>
  );
}
