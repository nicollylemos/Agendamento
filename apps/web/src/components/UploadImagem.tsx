import { useId, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { ApiError, enviarImagem } from '../lib/api';
import { cx } from './ui';

type Finalidade = 'LOGO' | 'BANNER' | 'SERVICO' | 'EQUIPE' | 'GALERIA' | 'POST';

// Seção 9.4: a imagem vai para a API, que confere os bytes, reprocessa e devolve a URL.
// Aqui só mostramos a prévia e o erro.
export function UploadImagem({
  finalidade,
  valor,
  aoMudar,
  rotulo,
  dica,
  formato = 'aspect-video',
}: {
  finalidade: Finalidade;
  valor: string | null;
  aoMudar: (url: string | null) => void;
  rotulo: string;
  dica?: string;
  formato?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function escolher(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);
    setEnviando(true);
    try {
      aoMudar((await enviarImagem(finalidade, arquivo)).url);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível enviar a imagem.');
    } finally {
      setEnviando(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {rotulo}
      </label>
      <div className="flex flex-wrap items-start gap-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cx(
            'relative grid w-40 place-items-center overflow-hidden rounded-md border border-dashed border-borda-campo bg-fundo text-tinta-suave hover:border-destaque hover:text-destaque',
            formato,
          )}
          aria-label={valor ? `Trocar ${rotulo.toLowerCase()}` : `Enviar ${rotulo.toLowerCase()}`}
        >
          {valor ? <img src={valor} alt="" className="absolute inset-0 size-full object-cover" /> : <ImagePlus className="size-6" aria-hidden />}
          {enviando && (
            <span className="absolute inset-0 grid place-items-center bg-white/70">
              <Loader2 className="size-6 animate-spin text-destaque" aria-hidden />
            </span>
          )}
        </button>
        <div className="grid gap-1 text-sm">
          <button type="button" onClick={() => input.current?.click()} className="justify-self-start font-medium text-destaque underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current">
            {valor ? 'Trocar imagem' : 'Escolher imagem'}
          </button>
          {valor && (
            <button type="button" onClick={() => aoMudar(null)} className="inline-flex items-center gap-1 justify-self-start text-tinta-suave hover:text-erro">
              <X className="size-3.5" aria-hidden />
              Remover
            </button>
          )}
          <p className="text-xs text-tinta-suave">{dica ?? 'JPG, PNG ou WebP, até 5 MB.'}</p>
        </div>
      </div>
      <input ref={input} id={id} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => escolher(e.target.files?.[0])} />
      {erro && <p className="text-sm text-erro">{erro}</p>}
    </div>
  );
}
