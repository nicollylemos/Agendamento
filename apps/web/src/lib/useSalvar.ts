import { useState } from 'react';
import { ApiError } from './api';

// Estado de envio + erro geral + erros por campo vindos da API (Zod)
export function useSalvar() {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [campos, setCampos] = useState<Record<string, string | undefined>>({});
  const [salvo, setSalvo] = useState(false);

  async function executar<T>(acao: () => Promise<T>): Promise<T | undefined> {
    setSalvando(true);
    setErro(null);
    setCampos({});
    setSalvo(false);
    try {
      const r = await acao();
      setSalvo(true);
      return r;
    } catch (e) {
      if (e instanceof ApiError) {
        setErro(e.code === 'VALIDATION_ERROR' ? 'Confira os campos destacados.' : e.message);
        setCampos(Object.fromEntries(Object.entries(e.campos).map(([k, v]) => [k, v?.[0]])));
      } else {
        setErro('Sem conexão com o servidor.');
      }
      return undefined;
    } finally {
      setSalvando(false);
    }
  }

  return { salvando, erro, campos, salvo, executar, limpar: () => (setErro(null), setCampos({}), setSalvo(false)) };
}
