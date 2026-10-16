import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from '../auth/AuthContext';
import { CORES_PADRAO, type VisualAgenda } from './agenda';

// Cores da agenda (e meta do mês, para a gestão). Enquanto carrega, usa as cores padrão.
export function useVisualAgenda() {
  const { pode } = useAuth();
  const base = pode('agenda:ver_todas') ? '/admin/agenda' : '/staff/agenda';
  const q = useQuery({ queryKey: ['agenda-visual', base], queryFn: () => api<VisualAgenda>(`${base}/visual`), staleTime: 5 * 60_000 });
  return { cores: q.data?.cores ?? CORES_PADRAO, metaMensalCentavos: q.data?.metaMensalCentavos ?? null, carregado: q.isSuccess };
}
