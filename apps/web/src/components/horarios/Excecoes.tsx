import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { formatarData, formatarPeriodo, hojeISO, type Bloqueio, type Excecao } from '../../lib/horarios';
import { useSalvar } from '../../lib/useSalvar';
import { Aviso, Botao, Campo, Entrada, Selecao, Selo } from '../ui';

// RF17: folgas e horários especiais
export function ListaExcecoes({
  base,
  funcionarioId,
  itens,
  podeEditar,
  permiteGeral,
  aoMudar,
}: {
  base: string; // '/admin/horarios' ou '/staff/horarios'
  funcionarioId?: string;
  itens: Excecao[];
  podeEditar: boolean;
  permiteGeral?: boolean;
  aoMudar: () => void;
}) {
  const { salvando, erro, campos, executar, limpar } = useSalvar();
  const [tipo, setTipo] = useState<'FOLGA' | 'HORARIO_ESPECIAL'>('FOLGA');
  const [geral, setGeral] = useState(false);

  async function adicionar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const ok = await executar(() =>
      api(`${base}/excecoes`, {
        method: 'POST',
        body: {
          funcionarioId: geral ? null : funcionarioId,
          data: f.get('data'),
          tipo,
          motivo: f.get('motivo'),
          ...(tipo === 'HORARIO_ESPECIAL' && { faixas: [{ inicio: f.get('inicio'), fim: f.get('fim') }] }),
        },
      }).then(() => true),
    );
    if (ok) {
      form.reset();
      setGeral(false);
      aoMudar();
    }
  }

  async function remover(id: string) {
    limpar();
    await executar(() => api(`${base}/excecoes/${id}`, { method: 'DELETE' }));
    aoMudar();
  }

  return (
    <div className="grid gap-4">
      {itens.length === 0 ? (
        <p className="text-sm text-tinta-suave">Nenhuma folga ou horário especial nos próximos 90 dias.</p>
      ) : (
        <ul className="grid divide-y divide-borda rounded-lg border border-borda bg-superficie">
          {itens.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{formatarData(e.data)}</span>
                {e.tipo === 'FOLGA' ? <Selo cor="cinza">Folga</Selo> : <Selo cor="verde">{e.faixas.map((f) => `${f.inicio} às ${f.fim}`).join(', ')}</Selo>}
                {!e.funcionarioId && <Selo>Equipe toda</Selo>}
                {e.motivo && <span className="text-tinta-suave">{e.motivo}</span>}
              </div>
              {podeEditar && (permiteGeral || e.funcionarioId) && (
                <button onClick={() => remover(e.id)} className="rounded p-1 text-tinta-suave hover:text-erro" aria-label={`Remover exceção de ${formatarData(e.data)}`}>
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {podeEditar && (
        <form onSubmit={adicionar} className="grid gap-4 rounded-lg border border-dashed border-borda p-4">
          {erro && <Aviso>{erro}</Aviso>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Data" erro={campos.data}>
              {(id) => <Entrada id={id} name="data" type="date" required min={hojeISO()} />}
            </Campo>
            <Campo rotulo="Tipo">
              {(id) => (
                <Selecao id={id} value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
                  <option value="FOLGA">Folga (não atende)</option>
                  <option value="HORARIO_ESPECIAL">Horário diferente</option>
                </Selecao>
              )}
            </Campo>
          </div>
          {tipo === 'HORARIO_ESPECIAL' && (
            <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
              <Campo rotulo="Das">{(id) => <Entrada id={id} name="inicio" type="time" step={300} required defaultValue="09:00" />}</Campo>
              <Campo rotulo="Às" erro={campos.faixas}>{(id) => <Entrada id={id} name="fim" type="time" step={300} required defaultValue="18:00" />}</Campo>
            </div>
          )}
          <Campo rotulo="Motivo (opcional)">{(id) => <Entrada id={id} name="motivo" maxLength={120} placeholder="Ex.: feriado, curso, consulta" />}</Campo>
          {permiteGeral && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-destaque size-4" checked={geral} onChange={(e) => setGeral(e.target.checked)} />
              Vale para a equipe toda (feriado, empresa fechada)
            </label>
          )}
          <Botao type="submit" variante="secundario" carregando={salvando} className="justify-self-start">
            Adicionar
          </Botao>
        </form>
      )}
    </div>
  );
}

// RF18: bloqueios de agenda
export function ListaBloqueios({
  base,
  funcionarioId,
  itens,
  podeEditar,
  aoMudar,
}: {
  base: string;
  funcionarioId?: string;
  itens: Bloqueio[];
  podeEditar: boolean;
  aoMudar: () => void;
}) {
  const { salvando, erro, campos, executar, limpar } = useSalvar();

  async function adicionar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const data = String(f.get('data'));
    const ok = await executar(() =>
      api(`${base}/bloqueios`, {
        method: 'POST',
        body: { funcionarioId, inicio: `${data}T${f.get('inicio')}`, fim: `${data}T${f.get('fim')}`, motivo: f.get('motivo') },
      }).then(() => true),
    );
    if (ok) {
      form.reset();
      aoMudar();
    }
  }

  async function remover(id: string) {
    limpar();
    await executar(() => api(`${base}/bloqueios/${id}`, { method: 'DELETE' }));
    aoMudar();
  }

  return (
    <div className="grid gap-4">
      {itens.length === 0 ? (
        <p className="text-sm text-tinta-suave">Nenhum bloqueio nos próximos 90 dias.</p>
      ) : (
        <ul className="grid divide-y divide-borda rounded-lg border border-borda bg-superficie">
          {itens.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <div>
                <span className="font-medium">{formatarPeriodo(b.inicio, b.fim)}</span>
                {b.motivo && <span className="ml-2 text-tinta-suave">{b.motivo}</span>}
              </div>
              {podeEditar && (
                <button onClick={() => remover(b.id)} className="rounded p-1 text-tinta-suave hover:text-erro" aria-label={`Remover bloqueio de ${formatarPeriodo(b.inicio, b.fim)}`}>
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {podeEditar && (
        <form onSubmit={adicionar} className="grid gap-4 rounded-lg border border-dashed border-borda p-4">
          {erro && <Aviso>{erro}</Aviso>}
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Data">{(id) => <Entrada id={id} name="data" type="date" required min={hojeISO()} />}</Campo>
            <Campo rotulo="Das">{(id) => <Entrada id={id} name="inicio" type="time" step={300} required />}</Campo>
            <Campo rotulo="Às" erro={campos.fim}>{(id) => <Entrada id={id} name="fim" type="time" step={300} required />}</Campo>
          </div>
          <Campo rotulo="Motivo (opcional)" dica="Só a equipe vê. O cliente só enxerga que o horário não está livre.">
            {(id, desc) => <Entrada id={id} aria-describedby={desc} name="motivo" maxLength={120} placeholder="Ex.: dentista, reunião" />}
          </Campo>
          <Botao type="submit" variante="secundario" carregando={salvando} className="justify-self-start">
            Bloquear horário
          </Botao>
        </form>
      )}
    </div>
  );
}
