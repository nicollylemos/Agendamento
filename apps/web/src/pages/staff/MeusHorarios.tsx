import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { Bloqueio, DiaSemana, Excecao } from '../../lib/horarios';
import { useSalvar } from '../../lib/useSalvar';
import { EditorSemana } from '../../components/horarios/EditorSemana';
import { ListaBloqueios, ListaExcecoes } from '../../components/horarios/Excecoes';
import { Aviso, Botao, Cabecalho, Carregando, Secao } from '../../components/ui';

// RF19: o funcionário vê os próprios horários e edita se o admin liberar
interface MeusDados {
  funcionarioId: string;
  podeEditar: boolean;
  jornada: DiaSemana[];
  excecoes: Excecao[];
  bloqueios: Bloqueio[];
}

export function MeusHorarios() {
  const qc = useQueryClient();
  const dados = useQuery({ queryKey: ['meus-horarios'], queryFn: () => api<MeusDados>('/staff/horarios'), retry: false });
  const [semana, setSemana] = useState<DiaSemana[] | null>(null);
  const { salvando, erro, salvo, executar } = useSalvar();
  const recarregar = () => qc.invalidateQueries({ queryKey: ['meus-horarios'] });

  useEffect(() => {
    if (dados.data) setSemana(dados.data.jornada);
  }, [dados.data]);

  if (dados.isLoading) return <Carregando />;
  if (dados.error) {
    const semPerfil = dados.error instanceof ApiError && dados.error.code === 'SEM_PERFIL_ATENDIMENTO';
    return (
      <>
        <Cabecalho titulo="Meus horários" />
        <Aviso tipo="alerta">{semPerfil ? 'Você ainda não tem perfil de atendimento. Peça ao administrador para habilitar.' : (dados.error as Error).message}</Aviso>
      </>
    );
  }

  const d = dados.data!;

  return (
    <>
      <Cabecalho
        titulo="Meus horários"
        descricao={d.podeEditar ? 'Ajuste quando você atende. Os clientes só veem horários dentro disso.' : 'Para mudar algo, fale com o administrador.'}
      />

      <Secao titulo="Jornada da semana">
        {erro && <Aviso>{erro}</Aviso>}
        {salvo && <Aviso tipo="sucesso">Jornada salva.</Aviso>}
        {semana && <EditorSemana valor={semana} aoMudar={setSemana} somenteLeitura={!d.podeEditar} />}
        {d.podeEditar && (
          <Botao
            onClick={() => executar(() => api('/staff/horarios/jornada', { method: 'PUT', body: { semana } })).then(recarregar)}
            carregando={salvando}
            className="justify-self-start"
          >
            Salvar jornada
          </Botao>
        )}
      </Secao>

      <Secao titulo="Folgas e horários especiais">
        <ListaExcecoes base="/staff/horarios" itens={d.excecoes} podeEditar={d.podeEditar} aoMudar={recarregar} />
      </Secao>

      <Secao titulo="Bloqueios">
        <ListaBloqueios base="/staff/horarios" itens={d.bloqueios} podeEditar={d.podeEditar} aoMudar={recarregar} />
      </Secao>
    </>
  );
}
