import { useCallback, useRef, useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Modal } from './Modal';
import { Aviso, Botao, Campo, Entrada } from './ui';

// Seção 9.1: ações críticas (recebedor, regra do sinal, reembolso, permissões) pedem a senha
// e o código do 2FA de novo. O token vale 5 minutos e vai no header X-Reauth-Token.
//
// Uso:
//   const { pedir, modal } = useReautenticacao();
//   const token = await pedir('Para salvar o recebedor'); if (!token) return;
//   ...render {modal}

export function useReautenticacao() {
  const { usuario } = useAuth();
  const [motivo, setMotivo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const resolver = useRef<((t: string | null) => void) | null>(null);
  const cache = useRef<{ token: string; ate: number } | null>(null);

  const pedir = useCallback((texto: string) => {
    // Reaproveita por 4 minutos (o servidor aceita por 5)
    if (cache.current && cache.current.ate > Date.now()) return Promise.resolve(cache.current.token);
    setErro(null);
    setMotivo(texto);
    return new Promise<string | null>((res) => {
      resolver.current = res;
    });
  }, []);

  const fechar = (token: string | null) => {
    resolver.current?.(token);
    resolver.current = null;
    setMotivo(null);
  };

  async function confirmar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErro(null);
    setEnviando(true);
    try {
      const { reauthToken } = await api<{ reauthToken: string }>('/auth/reautenticar', {
        method: 'POST',
        body: { senha: f.get('senha'), ...(usuario?.totpAtivo && { codigo: f.get('codigo') }) },
      });
      cache.current = { token: reauthToken, ate: Date.now() + 4 * 60_000 };
      fechar(reauthToken);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Sem conexão com o servidor.');
    } finally {
      setEnviando(false);
    }
  }

  const modal = (
    <Modal aberto={motivo !== null} aoFechar={() => fechar(null)} titulo="Confirme que é você">
      <form onSubmit={confirmar} className="grid gap-5">
        <p className="flex items-start gap-2 text-sm text-tinta-suave">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-destaque" aria-hidden />
          {motivo}, digite sua senha{usuario?.totpAtivo ? ' e o código do app autenticador' : ''}.
        </p>
        {erro && <Aviso>{erro}</Aviso>}
        <Campo rotulo="Sua senha">{(id) => <Entrada id={id} name="senha" type="password" required autoFocus autoComplete="current-password" />}</Campo>
        {usuario?.totpAtivo && (
          <Campo rotulo="Código do app autenticador">
            {(id) => <Entrada id={id} name="codigo" required inputMode="numeric" autoComplete="one-time-code" maxLength={20} />}
          </Campo>
        )}
        <Botao type="submit" carregando={enviando}>
          Confirmar
        </Botao>
      </form>
    </Modal>
  );

  return { pedir, modal };
}
