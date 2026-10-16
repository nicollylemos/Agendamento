import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { LayoutAcesso } from '../../layouts/LayoutAcesso';
import { Aviso, Botao } from '../../components/ui';

// Fluxo 6.5 / RF36: link do e-mail de alerta. Um clique corta o recebimento do sinal,
// desconecta a conta que fez a alteração e manda um link para trocar a senha.

export function NaoFuiEu() {
  const [params] = useSearchParams();
  const token = useMemo(() => {
    const t = params.get('token');
    if (t) window.history.replaceState(null, '', window.location.pathname);
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [estado, setEstado] = useState<'inicio' | 'enviando' | 'feito'>('inicio');
  const [erro, setErro] = useState<string | null>(null);

  async function bloquear() {
    setErro(null);
    setEstado('enviando');
    try {
      await api('/public/seguranca/nao-fui-eu', { method: 'POST', body: { token }, semRenovar: true });
      setEstado('feito');
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Sem conexão com o servidor.');
      setEstado('inicio');
    }
  }

  if (!token) {
    return (
      <LayoutAcesso titulo="Link inválido" descricao="Abra o link direto do e-mail de alerta.">
        <Link to="/login" className="text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
          Ir para o login
        </Link>
      </LayoutAcesso>
    );
  }

  if (estado === 'feito') {
    return (
      <LayoutAcesso titulo="Pronto, bloqueamos" descricao="A cobrança do sinal foi desligada e a conta que fez a alteração saiu de todos os aparelhos.">
        <div className="grid gap-4 text-sm">
          <p>Enviamos para o e-mail dessa conta um link para criar uma senha nova. Depois de entrar, confira os dados em Sinal e Pix antes de ativar de novo.</p>
          <Link to="/login" className="font-medium text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
            Ir para o login
          </Link>
        </div>
      </LayoutAcesso>
    );
  }

  return (
    <LayoutAcesso titulo="Não foi você?" descricao="Alguém alterou quem recebe o sinal dos agendamentos.">
      <div className="grid gap-5">
        {erro && <Aviso>{erro}</Aviso>}
        <ul className="list-disc space-y-1 pl-5 text-sm text-tinta-suave">
          <li>Desliga a cobrança do sinal na hora</li>
          <li>Desconecta a conta que fez a alteração de todos os aparelhos</li>
          <li>Envia um link para trocar a senha</li>
        </ul>
        <Botao variante="perigo" carregando={estado === 'enviando'} onClick={bloquear}>
          Bloquear agora
        </Botao>
      </div>
    </LayoutAcesso>
  );
}
