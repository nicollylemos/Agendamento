import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { LayoutAcesso } from '../../layouts/LayoutAcesso';
import { Aviso, Botao, Campo, Entrada } from '../../components/ui';

// O token vem na URL do e-mail. Lemos uma vez e tiramos da barra de endereço,
// para não ficar no histórico do navegador.
function useTokenDaUrl() {
  const [params] = useSearchParams();
  return useMemo(() => {
    const token = params.get('token');
    if (token) window.history.replaceState(null, '', window.location.pathname);
    return token;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function FormNovaSenha({ aoEnviar, textoBotao }: { aoEnviar: (senha: string) => Promise<void>; textoBotao: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const senha = String(form.get('senha'));
    if (senha !== form.get('confirmacao')) return setErro('As senhas não são iguais.');
    setErro(null);
    setEnviando(true);
    try {
      await aoEnviar(senha);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Sem conexão com o servidor.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="grid gap-5">
      {erro && <Aviso>{erro}</Aviso>}
      <Campo rotulo="Nova senha" dica="Pelo menos 10 caracteres. Uma frase curta é mais fácil de lembrar.">
        {(id, desc) => <Entrada id={id} aria-describedby={desc} name="senha" type="password" minLength={10} maxLength={128} required autoComplete="new-password" />}
      </Campo>
      <Campo rotulo="Repita a senha">
        {(id) => <Entrada id={id} name="confirmacao" type="password" required autoComplete="new-password" />}
      </Campo>
      <Botao type="submit" carregando={enviando}>
        {textoBotao}
      </Botao>
    </form>
  );
}

function LinkInvalido() {
  return (
    <LayoutAcesso titulo="Link inválido" descricao="Esse link está incompleto ou já foi usado. Peça um novo.">
      <Link to="/login" className="text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
        Ir para o login
      </Link>
    </LayoutAcesso>
  );
}

// RF02
export function AceitarConvite() {
  const token = useTokenDaUrl();
  const navegar = useNavigate();
  if (!token) return <LinkInvalido />;
  return (
    <LayoutAcesso titulo="Crie sua senha" descricao="Você foi convidado para a equipe. Defina uma senha para entrar.">
      <FormNovaSenha
        textoBotao="Criar senha"
        aoEnviar={async (senha) => {
          await api('/auth/convite/aceitar', { method: 'POST', body: { token, senha }, semRenovar: true });
          navegar('/login', { replace: true, state: { aviso: 'Senha criada. Agora é só entrar.' } });
        }}
      />
    </LayoutAcesso>
  );
}

// RF03
export function RedefinirSenha() {
  const token = useTokenDaUrl();
  const navegar = useNavigate();
  if (!token) return <LinkInvalido />;
  return (
    <LayoutAcesso titulo="Nova senha" descricao="Depois de salvar, todos os acessos abertos com a senha antiga são encerrados.">
      <FormNovaSenha
        textoBotao="Salvar nova senha"
        aoEnviar={async (senha) => {
          await api('/auth/senha/redefinir', { method: 'POST', body: { token, senha }, semRenovar: true });
          navegar('/login', { replace: true });
        }}
      />
    </LayoutAcesso>
  );
}

// RF03
export function EsqueciSenha() {
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      await api('/auth/senha/esqueci', { method: 'POST', body: { email: new FormData(e.currentTarget).get('email') }, semRenovar: true });
      setEnviado(true);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Sem conexão com o servidor.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <LayoutAcesso titulo="Recuperar senha" descricao="Informe seu e-mail e enviaremos um link para criar uma nova senha.">
      {enviado ? (
        <div className="grid gap-5">
          <Aviso tipo="sucesso">Se o e-mail estiver cadastrado, o link chega em instantes. Ele vale 30 minutos.</Aviso>
          <Link to="/login" className="text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
            Voltar para o login
          </Link>
        </div>
      ) : (
        <form onSubmit={enviar} className="grid gap-5">
          {erro && <Aviso>{erro}</Aviso>}
          <Campo rotulo="E-mail">{(id) => <Entrada id={id} name="email" type="email" required autoComplete="email" autoFocus />}</Campo>
          <Botao type="submit" carregando={enviando}>
            Enviar link
          </Botao>
          <Link to="/login" className="text-sm text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current justify-self-start">
            Voltar para o login
          </Link>
        </form>
      )}
    </LayoutAcesso>
  );
}
