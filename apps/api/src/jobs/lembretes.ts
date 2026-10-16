import { DateTime } from 'luxon';
import { prisma } from '../lib/prisma.js';
import { enviarEmail } from '../lib/mailer.js';

// RF27: lembretes por e-mail 24 h e 2 h antes (WhatsApp numa fase futura).
// Cada lembrete é "reservado" com um UPDATE condicional antes de enviar,
// então duas instâncias rodando juntas não mandam em dobro.

const H = 3_600_000;

async function enviar(tipo: '24h' | '2h', agora: Date) {
  const antecedencia = tipo === '24h' ? 24 * H : 2 * H;
  const campo = tipo === '24h' ? 'lembrete24hEm' : 'lembrete2hEm';
  const candidatos = await prisma.agendamento.findMany({
    where: {
      status: 'CONFIRMADO',
      [campo]: null,
      inicio: { gt: new Date(agora.getTime() + (tipo === '24h' ? 2 * H : 0)), lte: new Date(agora.getTime() + antecedencia) },
    },
    include: { cliente: true, servico: { select: { nome: true } }, funcionario: { select: { nome: true } } },
    take: 200,
  });
  const zona = (await prisma.empresa.findUnique({ where: { id: 1 }, select: { fusoHorario: true, nome: true } })) ?? { fusoHorario: 'America/Sao_Paulo', nome: '' };
  let enviados = 0;
  for (const a of candidatos) {
    // Quem agendou em cima da hora não precisa do lembrete (acabou de receber a confirmação)
    const agendouComFolga = a.inicio.getTime() - a.createdAt.getTime() >= antecedencia;
    const { count } = await prisma.agendamento.updateMany({ where: { id: a.id, status: 'CONFIRMADO', [campo]: null }, data: { [campo]: agora } });
    if (!count || !agendouComFolga || !a.cliente.email) continue;
    const quando = DateTime.fromJSDate(a.inicio).setZone(zona.fusoHorario).setLocale('pt-BR');
    await enviarEmail(
      a.cliente.email,
      tipo === '24h' ? 'Lembrete: seu horário é amanhã' : 'Lembrete: seu horário é daqui a pouco',
      [
        `Olá, ${a.cliente.nome.split(' ')[0]}!`,
        '',
        `${a.servico.nome} com ${a.funcionario.nome}`,
        quando.toFormat(tipo === '24h' ? "cccc, dd 'de' LLLL 'às' HH:mm" : "'hoje às' HH:mm"),
        ...(zona.nome ? ['', zona.nome] : []),
        '',
        'Precisa remarcar ou cancelar? Use o link do e-mail de confirmação.',
      ].join('\n'),
    );
    enviados++;
  }
  return enviados;
}

export async function enviarLembretes(agora = new Date()) {
  return { h24: await enviar('24h', agora), h2: await enviar('2h', agora) };
}
