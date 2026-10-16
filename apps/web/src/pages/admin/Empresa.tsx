import { useEffect } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { DIAS_SEMANA } from '../../lib/formato';
import { useSalvar } from '../../lib/useSalvar';
import { AreaTexto, Aviso, Botao, Cabecalho, Campo, Carregando, Entrada, Interruptor, Secao, Selecao } from '../../components/ui';

// RF06

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

interface Dia {
  diaSemana: number;
  aberto: boolean;
  abre: string;
  fecha: string;
}

interface Formulario {
  nome: string;
  documento: string;
  email: string;
  telefone: string;
  whatsapp: string;
  instagram: string;
  facebook: string;
  site: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  politicaCancelamento: string;
  politicaAtraso: string;
  dias: Dia[];
}

type EmpresaApi = Partial<Record<keyof Formulario, string | null>> & {
  horarioFuncionamento?: { diaSemana: number; abre: string; fecha: string }[];
};

function paraFormulario(e: EmpresaApi | null): Formulario {
  const texto = (k: keyof Formulario) => (e?.[k] as string | null | undefined) ?? '';
  return {
    nome: texto('nome'), documento: texto('documento'), email: texto('email'), telefone: texto('telefone'),
    whatsapp: texto('whatsapp'), instagram: texto('instagram'), facebook: texto('facebook'), site: texto('site'),
    cep: texto('cep'), logradouro: texto('logradouro'), numero: texto('numero'), complemento: texto('complemento'),
    bairro: texto('bairro'), cidade: texto('cidade'), uf: texto('uf'),
    politicaCancelamento: texto('politicaCancelamento'), politicaAtraso: texto('politicaAtraso'),
    dias: DIAS_SEMANA.map((_, diaSemana) => {
      const h = e?.horarioFuncionamento?.find((d) => d.diaSemana === diaSemana);
      return { diaSemana, aberto: Boolean(h), abre: h?.abre ?? '09:00', fecha: h?.fecha ?? '18:00' };
    }),
  };
}

export function Empresa() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['empresa'],
    queryFn: () =>
      api<EmpresaApi>('/admin/empresa').catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))),
  });
  const { register, handleSubmit, reset, control, watch } = useForm<Formulario>({ defaultValues: paraFormulario(null) });
  const { fields } = useFieldArray({ control, name: 'dias' });
  const { salvando, erro, campos, salvo, executar } = useSalvar();

  useEffect(() => {
    if (data !== undefined) reset(paraFormulario(data));
  }, [data, reset]);

  const salvar = handleSubmit(async ({ dias, uf, ...resto }) => {
    const r = await executar(() =>
      api<EmpresaApi>('/admin/empresa', {
        method: 'PUT',
        body: {
          ...resto,
          uf: uf || null,
          horarioFuncionamento: dias.filter((d) => d.aberto).map(({ diaSemana, abre, fecha }) => ({ diaSemana, abre, fecha })),
        },
      }),
    );
    if (r) {
      qc.setQueryData(['empresa'], r);
      qc.invalidateQueries({ queryKey: ['progresso-inicial'] });
    }
  });

  if (isLoading) return <Carregando />;

  const entrada = (nome: keyof Formulario, rotulo: string, extra: Record<string, unknown> = {}, dica?: string) => (
    <Campo rotulo={rotulo} erro={campos[nome]} dica={dica}>
      {(id, desc) => <Entrada id={id} aria-describedby={desc} invalido={Boolean(campos[nome])} {...register(nome)} {...extra} />}
    </Campo>
  );

  return (
    <form onSubmit={salvar}>
      <Cabecalho
        titulo="Empresa"
        descricao="Essas informações aparecem na página de agendamento para os clientes."
        acoes={
          <Botao type="submit" carregando={salvando}>
            Salvar alterações
          </Botao>
        }
      />

      <div className="grid gap-4 mb-8" aria-live="polite">
        {erro && <Aviso>{erro}</Aviso>}
        {salvo && <Aviso tipo="sucesso">Alterações salvas.</Aviso>}
      </div>

      <Secao titulo="Identificação">
        {entrada('nome', 'Nome do negócio', { required: true, maxLength: 120 })}
        {entrada('documento', 'CPF ou CNPJ', { inputMode: 'text' }, 'O CNPJ aparece no site. O CPF nunca é mostrado.')}
      </Secao>

      <Secao titulo="Contato" descricao="Como os clientes falam com você.">
        <div className="grid gap-4 sm:grid-cols-2">
          {entrada('whatsapp', 'WhatsApp', { type: 'tel', autoComplete: 'tel' })}
          {entrada('telefone', 'Telefone', { type: 'tel' })}
        </div>
        {entrada('email', 'E-mail', { type: 'email' })}
        <div className="grid gap-4 sm:grid-cols-2">
          {entrada('instagram', 'Instagram', { placeholder: '@seunegocio' })}
          {entrada('facebook', 'Facebook', { placeholder: 'https://facebook.com/…' })}
        </div>
        {entrada('site', 'Site', { placeholder: 'https://…' })}
      </Secao>

      <Secao titulo="Endereço">
        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          {entrada('cep', 'CEP', { inputMode: 'numeric', autoComplete: 'postal-code' })}
          {entrada('logradouro', 'Rua', { autoComplete: 'address-line1' })}
        </div>
        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          {entrada('numero', 'Número')}
          {entrada('complemento', 'Complemento')}
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_100px]">
          {entrada('bairro', 'Bairro')}
          {entrada('cidade', 'Cidade')}
          <Campo rotulo="UF" erro={campos.uf}>
            {(id) => (
              <Selecao id={id} {...register('uf')}>
                <option value="">—</option>
                {UFS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Selecao>
            )}
          </Campo>
        </div>
      </Secao>

      <Secao titulo="Horário de funcionamento" descricao="Os horários de cada profissional são configurados na equipe.">
        {campos.horarioFuncionamento && <Aviso>{campos.horarioFuncionamento}</Aviso>}
        <ul className="grid divide-y divide-borda rounded-lg border border-borda bg-superficie">
          {fields.map((f, i) => {
            const aberto = watch(`dias.${i}.aberto`);
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
                <span className="w-20 font-medium">{DIAS_SEMANA[f.diaSemana]}</span>
                <Controller
                  control={control}
                  name={`dias.${i}.aberto`}
                  render={({ field }) => <Interruptor ligado={field.value} aoMudar={field.onChange} rotulo={field.value ? 'Aberto' : 'Fechado'} />}
                />
                {aberto && (
                  <div className="flex items-center gap-2 text-sm">
                    <Entrada type="time" step={300} className="w-28" aria-label={`Abre ${DIAS_SEMANA[f.diaSemana]}`} {...register(`dias.${i}.abre`)} />
                    até
                    <Entrada type="time" step={300} className="w-28" aria-label={`Fecha ${DIAS_SEMANA[f.diaSemana]}`} {...register(`dias.${i}.fecha`)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Secao>

      <Secao titulo="Políticas" descricao="O cliente vê e aceita antes de confirmar o agendamento.">
        <Campo rotulo="Cancelamento" erro={campos.politicaCancelamento}>
          {(id) => <AreaTexto id={id} maxLength={2000} placeholder="Ex.: cancelamentos com até 24 h de antecedência têm o sinal devolvido." {...register('politicaCancelamento')} />}
        </Campo>
        <Campo rotulo="Atraso" erro={campos.politicaAtraso}>
          {(id) => <AreaTexto id={id} maxLength={2000} placeholder="Ex.: atrasos acima de 15 minutos podem ser remarcados." {...register('politicaAtraso')} />}
        </Campo>
      </Secao>
    </form>
  );
}
