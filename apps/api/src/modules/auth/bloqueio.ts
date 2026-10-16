// Seção 9.1: bloqueio progressivo depois de tentativas erradas.
// 5 erros → 15 min; a cada 5 erros seguintes → 1 h.
export function minutosDeBloqueio(tentativas: number): number | null {
  if (tentativas < 5 || tentativas % 5 !== 0) return null;
  return tentativas === 5 ? 15 : 60;
}

export function estaBloqueado(bloqueadoAte: Date | null, agora = new Date()): boolean {
  return bloqueadoAte !== null && bloqueadoAte > agora;
}
