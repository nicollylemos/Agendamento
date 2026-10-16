import { useEffect } from 'react';
import { Navigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { usePersonalizacao } from '../../lib/site';
import { Landing, type EmpresaSite, type MembroSite, type ServicoSite } from '../../components/site/Landing';
import { Carregando } from '../../components/ui';

// RF09: página inicial pública (landing)
export function Site() {
  const empresa = useQuery({ queryKey: ['empresa-site'], queryFn: () => api<EmpresaSite>('/public/empresa', { semRenovar: true }), retry: false });
  const personalizacao = usePersonalizacao();
  const servicos = useQuery({ queryKey: ['catalogo'], queryFn: () => api<ServicoSite[]>('/public/servicos', { semRenovar: true }), staleTime: 0, refetchOnWindowFocus: 'always' });
  const equipe = useQuery({ queryKey: ['equipe-site'], queryFn: () => api<MembroSite[]>('/public/equipe', { semRenovar: true }) });

  useEffect(() => {
    if (empresa.data?.nome) document.title = empresa.data.nome;
  }, [empresa.data?.nome]);

  // Empresa ainda não configurada: vai direto para o agendamento
  if (empresa.isError) return <Navigate to="/agendar" replace />;
  if (empresa.isLoading || personalizacao.isLoading || servicos.isLoading || equipe.isLoading || !personalizacao.data) return <Carregando />;
  return <Landing empresa={empresa.data ?? null} p={personalizacao.data} servicos={servicos.data ?? []} equipe={equipe.data ?? []} />;
}
