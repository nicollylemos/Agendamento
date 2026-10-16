import { Entrada } from './ui';
import { centavosDoTexto, formatarCentavos } from '../lib/formato';

// Digita só números e o valor vai se formatando: 8000 → R$ 80,00. Guarda em centavos.
export function EntradaMoeda({
  valor,
  aoMudar,
  id,
  invalido,
  placeholder,
  ...resto
}: {
  valor: number | null;
  aoMudar: (centavos: number | null) => void;
  id?: string;
  invalido?: boolean;
  placeholder?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  return (
    <Entrada
      id={id}
      inputMode="numeric"
      invalido={invalido}
      placeholder={placeholder}
      value={valor === null ? '' : formatarCentavos(valor)}
      onChange={(e) => {
        const texto = e.target.value;
        aoMudar(texto.replace(/\D/g, '') === '' ? null : centavosDoTexto(texto));
      }}
      {...resto}
    />
  );
}
