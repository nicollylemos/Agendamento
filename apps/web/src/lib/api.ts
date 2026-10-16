// Cliente da API.
// Seção 9.1: o access token fica SÓ em memória (nunca no localStorage, que
// qualquer script injetado conseguiria ler). Ao recarregar a página, a sessão
// volta pelo cookie httpOnly, via /auth/refresh.

export interface UsuarioSessao {
  id: string;
  nome: string;
  email: string;
  perfil: 'ADMIN' | 'GERENTE' | 'FUNCIONARIO';
  totpAtivo: boolean;
  permissoes: string[];
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly campos: Record<string, string[] | undefined> = {},
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
const ouvintes = new Set<(u: UsuarioSessao | null) => void>();

export function definirSessao(token: string | null, usuario: UsuarioSessao | null) {
  accessToken = token;
  ouvintes.forEach((fn) => fn(usuario));
}

export function aoMudarSessao(fn: (u: UsuarioSessao | null) => void) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

const CSRF = { 'X-Requested-With': 'agendamento' };

// Uma renovação por vez: se várias chamadas recebem 401 juntas, todas esperam
// a mesma renovação. Sem isso, o mesmo cookie iria duas vezes e a API
// entenderia como roubo de sessão.
let renovacaoEmAndamento: Promise<boolean> | null = null;

async function tentarRenovar(): Promise<boolean> {
  const res = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: CSRF, credentials: 'same-origin' });
  if (!res.ok) return false;
  const dados = (await res.json()) as { accessToken: string; usuario: UsuarioSessao };
  definirSessao(dados.accessToken, dados.usuario);
  return true;
}

export function renovarSessao(): Promise<boolean> {
  renovacaoEmAndamento ??= (async () => {
    try {
      if (await tentarRenovar()) return true;
      // Outra aba pode ter acabado de trocar o cookie: espera e tenta uma vez mais
      await new Promise((r) => setTimeout(r, 600));
      return await tentarRenovar();
    } catch {
      return false;
    } finally {
      renovacaoEmAndamento = null;
    }
  })();
  return renovacaoEmAndamento;
}

interface Opcoes {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Não tenta renovar a sessão num 401 (rotas de login) */
  semRenovar?: boolean;
}

export async function api<T = unknown>(caminho: string, opcoes: Opcoes = {}): Promise<T> {
  const fazer = () =>
    fetch(`/api/v1${caminho}`, {
      method: opcoes.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        ...(opcoes.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        ...opcoes.headers,
      },
      body: opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined,
    });

  let res = await fazer();

  if (res.status === 401 && !opcoes.semRenovar && accessToken) {
    const corpo = (await res.clone().json().catch(() => ({}))) as { code?: string };
    if (corpo.code === 'TOKEN_INVALIDO') {
      if (await renovarSessao()) res = await fazer();
      else definirSessao(null, null);
    } else if (corpo.code === 'SESSAO_ENCERRADA') {
      definirSessao(null, null);
    }
  }

  if (res.status === 204) return undefined as T;
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = dados as { code?: string; message?: string; issues?: Record<string, string[]> };
    throw new ApiError(res.status, d.code ?? 'ERRO', d.message ?? 'Não foi possível concluir. Tente de novo.', d.issues ?? {});
  }
  return dados as T;
}

export async function encerrarSessao() {
  await fetch('/api/v1/auth/logout', { method: 'POST', headers: CSRF, credentials: 'same-origin' }).catch(() => {});
  definirSessao(null, null);
}

// Fase 9 (9.4): envia uma imagem como corpo bruto (sem multipart). A API confere os bytes,
// reprocessa e devolve a URL. Limite de 5 MB (conferido aqui e lá).
export async function enviarImagem(finalidade: 'LOGO' | 'BANNER' | 'SERVICO' | 'EQUIPE' | 'GALERIA' | 'POST', arquivo: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(arquivo.type)) {
    throw new ApiError(400, 'ARQUIVO_INVALIDO', 'Envie uma imagem JPG, PNG ou WebP', {});
  }
  if (arquivo.size > 5 * 1024 * 1024) throw new ApiError(413, 'MUITO_GRANDE', 'A imagem pode ter até 5 MB', {});
  const enviar = () =>
    fetch(`/api/v1/admin/arquivos?finalidade=${finalidade}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': arquivo.type, ...(accessToken && { Authorization: `Bearer ${accessToken}` }) },
      body: arquivo,
    });
  let res = await enviar();
  if (res.status === 401 && (await renovarSessao())) res = await enviar();
  const dados = (await res.json().catch(() => ({}))) as { url?: string; message?: string; code?: string };
  if (!res.ok || !dados.url) throw new ApiError(res.status, dados.code ?? 'ERRO', dados.message ?? 'Não foi possível enviar a imagem', {});
  return { url: dados.url };
}

// Fase 10 (RF55): baixa um arquivo gerado pela API (CSV/PDF) e entrega ao navegador.
// O nome vem do Content-Disposition; só letras, números, ponto e hífen passam.
export async function baixarArquivo(caminho: string, headers: Record<string, string> = {}) {
  const buscar = () =>
    fetch(`/api/v1${caminho}`, {
      credentials: 'same-origin',
      headers: { ...(accessToken && { Authorization: `Bearer ${accessToken}` }), ...headers },
    });
  let res = await buscar();
  if (res.status === 401 && accessToken) {
    const corpo = (await res.clone().json().catch(() => ({}))) as { code?: string };
    if (corpo.code === 'TOKEN_INVALIDO' && (await renovarSessao())) res = await buscar();
  }
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new ApiError(res.status, d.code ?? 'ERRO', d.message ?? 'Não foi possível gerar o arquivo.', {});
  }
  const nome = /filename="([\w.-]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'relatorio';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
