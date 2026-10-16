import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { api, ApiError, definirSessao, type UsuarioSessao } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { LayoutAcesso } from '../../layouts/LayoutAcesso';
import { Aviso, Botao, Campo, Entrada } from '../../components/ui';

// RF01: login → (código do app, se a pessoa ativou o 2FA) → painel

type RespostaLogin = { etapa: 'OK'; accessToken: string; usuario: UsuarioSessao } | { etapa: 'MFA'; mfaToken: string };

type Etapa = { tipo: 'credenciais' } | { tipo: 'codigo'; mfaToken: string };

export function Login() {
  const { estado } = useAuth();
  const local = useLocation();
  const { aviso, voltarPara } = (local.state ?? {}) as { aviso?: string; voltarPara?: string };
  const [etapa, setEtapa] = useState<Etapa>({ tipo: 'credenciais' });
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (estado.status === 'autenticado') {
    // Só volta para caminhos internos do painel (evita redirecionar para outro site)
    const destino = voltarPara?.startsWith('/painel') ? voltarPara : '/painel';
    return <Navigate to={destino} replace />;
  }

  async function executar(acao: () => Promise<void>) {
    setErro(null);
    setEnviando(true);
    try {
      await acao();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Sem conexão com o servidor. Confira se a API está rodando.');
    } finally {
      setEnviando(false);
    }
  }

  function entrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    executar(async () => {
      const r = await api<RespostaLogin>('/auth/login', {
        method: 'POST',
        body: { email: form.get('email'), senha: form.get('senha') },
        semRenovar: true,
      });
      if (r.etapa === 'OK') definirSessao(r.accessToken, r.usuario);
      else setEtapa({ tipo: 'codigo', mfaToken: r.mfaToken });
    });
  }

  function confirmarCodigo(e: FormEvent<HTMLFormElement>, mfaToken: string) {
    e.preventDefault();
    const codigo = String(new FormData(e.currentTarget).get('codigo') ?? '');
    executar(async () => {
      const r = await api<{ accessToken: string; usuario: UsuarioSessao }>('/auth/2fa/verificar', {
        method: 'POST',
        body: { mfaToken, codigo },
        semRenovar: true,
      });
      definirSessao(r.accessToken, r.usuario);
    });
  }

  if (etapa.tipo === 'codigo') {
    return (
      <LayoutAcesso titulo="Confirme que é você" descricao="Digite o código de 6 dígitos do seu app autenticador.">
        <form onSubmit={(e) => confirmarCodigo(e, etapa.mfaToken)} className="grid gap-5">
          {erro && <Aviso>{erro}</Aviso>}
          <Campo rotulo="Código" dica="Sem acesso ao celular? Use um dos códigos de recuperação.">
            {(id, desc) => (
              <Entrada id={id} aria-describedby={desc} name="codigo" required autoFocus autoComplete="one-time-code" inputMode="text" maxLength={20} />
            )}
          </Campo>
          <Botao type="submit" carregando={enviando}>
            Entrar
          </Botao>
          <Botao type="button" variante="fantasma" onClick={() => setEtapa({ tipo: 'credenciais' })}>
            Voltar
          </Botao>
        </form>
      </LayoutAcesso>
    );
  }

  return (
    <LayoutAcesso titulo="Entrar no painel">
      <form onSubmit={entrar} className="grid gap-5">
        {aviso && !erro && <Aviso tipo="sucesso">{aviso}</Aviso>}
        {erro && <Aviso>{erro}</Aviso>}
        <Campo rotulo="E-mail">{(id) => <Entrada id={id} name="email" type="email" required autoComplete="email" autoFocus />}</Campo>
        <Campo rotulo="Senha">
          {(id) => <Entrada id={id} name="senha" type="password" required autoComplete="current-password" />}
        </Campo>
        <Botao type="submit" carregando={enviando}>
          Entrar
        </Botao>
        <Link to="/esqueci-senha" className="text-sm text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current justify-self-start">
          Esqueci minha senha
        </Link>
      </form>
    </LayoutAcesso>
  );
}
