// RF49: contas de ocupação em minutos do dia. Funções puras, testadas à parte.

export type Intervalo = [number, number]; // [início, fim) em minutos desde a meia-noite

// Junta intervalos que se encostam ou sobrepõem
export function unir(lista: Intervalo[]): Intervalo[] {
  const ordenados = lista.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const saida: Intervalo[] = [];
  for (const [a, b] of ordenados) {
    const ultimo = saida.at(-1);
    if (ultimo && a <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], b);
    else saida.push([a, b]);
  }
  return saida;
}

// A − B
export function subtrair(a: Intervalo[], b: Intervalo[]): Intervalo[] {
  let resto = unir(a);
  for (const [bi, bf] of unir(b)) {
    const novo: Intervalo[] = [];
    for (const [ai, af] of resto) {
      if (bf <= ai || bi >= af) {
        novo.push([ai, af]);
        continue;
      }
      if (bi > ai) novo.push([ai, bi]);
      if (bf < af) novo.push([bf, af]);
    }
    resto = novo;
  }
  return resto;
}

// A ∩ B
export function intersecao(a: Intervalo[], b: Intervalo[]): Intervalo[] {
  const ua = unir(a);
  const ub = unir(b);
  const saida: Intervalo[] = [];
  for (const [ai, af] of ua) {
    for (const [bi, bf] of ub) {
      const i = Math.max(ai, bi);
      const f = Math.min(af, bf);
      if (f > i) saida.push([i, f]);
    }
  }
  return saida;
}

export const total = (lista: Intervalo[]) => unir(lista).reduce((s, [a, b]) => s + (b - a), 0);

// Minutos de cada hora do dia (24 posições) cobertos pelos intervalos
export function porHora(lista: Intervalo[]): number[] {
  const horas = Array<number>(24).fill(0);
  for (const [a, b] of unir(lista)) {
    for (let h = Math.floor(a / 60); h < 24 && h * 60 < b; h++) {
      horas[h]! += Math.max(0, Math.min(b, (h + 1) * 60) - Math.max(a, h * 60));
    }
  }
  return horas;
}

// RF49: num dia, quanto estava disponível (jornada − bloqueios) e quanto disso foi agendado
export function ocupacaoDoDia(p: { jornada: Intervalo[]; bloqueios: Intervalo[]; agendados: Intervalo[] }) {
  const disponivel = subtrair(p.jornada, p.bloqueios);
  const ocupado = intersecao(disponivel, p.agendados);
  return {
    disponivelMin: total(disponivel),
    ocupadoMin: total(ocupado),
    disponivelPorHora: porHora(disponivel),
    ocupadoPorHora: porHora(ocupado),
  };
}
