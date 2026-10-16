import { useState, type FormEvent } from 'react';
import { Check, Copy, ShieldCheck } from 'lucide-react';
import { api, renovarSessao } from '../../lib/api';
import { NOME_PERFIL } from '../../lib/formato';
import { useSalvar } from '../../lib/useSalvar';
import { useAuth } from '../../auth/AuthContext';
import { Aviso, Botao, Cabecalho, Campo, Entrada, Secao } from '../../components/ui';

// RF01: verificação em duas etapas opcional, ligada e desligada pela própria pessoa
export function MinhaConta() {
  const { usuario } = useAuth();
  const { salvando, erro, executar, limpar } = useSalvar();
  const [config, setConfig] = useState<{ qrCode: string; segredo: string } | null>(null);
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [desligando, setDesligando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  if (!usuario) return null;

  async function iniciar() {
    const r = await executar(() => api<{ qrCode: string; segredo: string }>('/auth/2fa/configurar', { method: 'POST' }));
    if (r) setConfig(r);
  }

  async function ativar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const codigo = new FormData(e.currentTarget).get('codigo');
    const r = await executar(() => api<{ codigosRecuperacao: string[] }>('/auth/2fa/ativar', { method: 'POST', body: { codigo } }));
    if (r) {
      setCodigos(r.codigosRecuperacao);
      setConfig(null);
      await renovarSessao(); // atualiza o estado do 2FA no painel
    }
  }

  async function desativar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await executar(() =>
      api('/auth/2fa/desativar', { method: 'POST', body: { senha: f.get('senha'), codigo: f.get('codigo') } }).then(() => true),
    );
    if (ok) {
      setDesligando(false);
      setCodigos(null);
      await renovarSessao();
    }
  }

  return (
    <>
      <Cabecalho titulo="Minha conta" />
      <Secao titulo="Dados">
        <dl className="grid gap-3 text-sm sm:grid-cols-[120px_1fr]">
          <dt className="text-tinta-suave">Nome</dt>
          <dd>{usuario.nome}</dd>
          <dt className="text-tinta-suave">E-mail</dt>
          <dd>{usuario.email}</dd>
          <dt className="text-tinta-suave">Perfil</dt>
          <dd>{NOME_PERFIL[usuario.perfil]}</dd>
        </dl>
      </Secao>

      <Secao titulo="Verificação em duas etapas" descricao="Além da senha, pede um código do celular ao entrar. Protege a conta mesmo se a senha vazar.">
        {erro && <Aviso>{erro}</Aviso>}

        {codigos && (
          <div className="grid gap-3 sm:max-w-sm">
            <Aviso tipo="sucesso">Ativada. Guarde estes códigos de recuperação: se perder o celular, cada um libera um acesso. Eles não aparecem de novo.</Aviso>
            <ul className="grid grid-cols-2 gap-2 rounded-md border border-borda bg-superficie p-4 font-medium tracking-wide">
              {codigos.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Botao
              variante="secundario"
              onClick={async () => {
                await navigator.clipboard.writeText(codigos.join('\n'));
                setCopiado(true);
              }}
            >
              {copiado ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copiado ? 'Códigos copiados' : 'Copiar códigos'}
            </Botao>
          </div>
        )}

        {!codigos && usuario.totpAtivo && !desligando && (
          <div className="flex flex-wrap items-center gap-4">
            <p className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-5 text-destaque" aria-hidden />
              Ativada
            </p>
            <Botao variante="fantasma" onClick={() => (limpar(), setDesligando(true))}>
              Desativar
            </Botao>
          </div>
        )}

        {usuario.totpAtivo && desligando && (
          <form onSubmit={desativar} className="grid gap-4 sm:max-w-sm">
            <p className="text-sm text-tinta-suave">Para desativar, confirme sua senha e um código do app (ou de recuperação).</p>
            <Campo rotulo="Senha">{(id) => <Entrada id={id} name="senha" type="password" required autoComplete="current-password" />}</Campo>
            <Campo rotulo="Código">{(id) => <Entrada id={id} name="codigo" required autoComplete="one-time-code" maxLength={20} />}</Campo>
            <div className="flex gap-2">
              <Botao type="submit" variante="perigo" carregando={salvando}>
                Desativar verificação
              </Botao>
              <Botao type="button" variante="fantasma" onClick={() => setDesligando(false)}>
                Cancelar
              </Botao>
            </div>
          </form>
        )}

        {!usuario.totpAtivo && !codigos && config && (
          <form onSubmit={ativar} className="grid gap-4 sm:max-w-sm">
            <p className="text-sm">Escaneie no Google Authenticator, Authy ou 1Password:</p>
            <img src={config.qrCode} alt="QR Code para o app autenticador" className="size-48 rounded-md border border-borda bg-white p-2" />
            <details className="text-sm text-tinta-suave">
              <summary className="cursor-pointer">Não consigo escanear</summary>
              <p className="mt-2 break-all">
                Digite a chave no app: <code className="text-tinta">{config.segredo}</code>
              </p>
            </details>
            <Campo rotulo="Código que aparece no app">
              {(id) => <Entrada id={id} name="codigo" required inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" />}
            </Campo>
            <Botao type="submit" carregando={salvando}>
              Ativar
            </Botao>
          </form>
        )}

        {!usuario.totpAtivo && !codigos && !config && (
          <div>
            <Botao variante="secundario" onClick={iniciar} carregando={salvando}>
              Ativar verificação em duas etapas
            </Botao>
          </div>
        )}
      </Secao>
    </>
  );
}
