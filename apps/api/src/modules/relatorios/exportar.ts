import PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';
import type { Celula, Coluna, Formato, Relatorio, Tabela } from './relatorios.tipos.js';

// RF55: exportação em CSV (planilha) e PDF. Os dois saem da mesma estrutura do relatório.

const ZONA = 'America/Sao_Paulo';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCusto = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 });
const num = (max: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: max });

function horas(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

const dataBr = (iso: string) => DateTime.fromISO(iso).toFormat('dd/MM/yyyy');

// Texto para leitura (PDF)
export function formatar(valor: Celula, formato: Formato): string {
  if (valor === null || valor === undefined) return '—';
  if (typeof valor === 'string') return formato === 'data' ? dataBr(valor) : valor;
  switch (formato) {
    case 'moeda':
      return brl.format(valor / 100);
    case 'custo':
      return brlCusto.format(valor / 100);
    case 'pct':
      return `${num(1).format(valor * 100)}%`;
    case 'horas':
      return horas(valor);
    case 'decimal':
      return num(3).format(valor);
    default:
      return num(0).format(valor);
  }
}

// ─── CSV ─────────────────────────────────────────────────
// Separador ";" e vírgula decimal: abre direto no Excel em português.

// Injeção de fórmula (OWASP CSV Injection): célula de texto que começa com = + - @ tab ou CR
// vira texto puro com um apóstrofo na frente. Nomes de cliente/serviço vêm de fora.
export function celulaSegura(texto: string) {
  const t = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function celulaCsv(valor: Celula, formato: Formato): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return celulaSegura(formato === 'data' ? dataBr(valor) : valor);
  // Números saem sem símbolo, para a planilha conseguir somar
  switch (formato) {
    case 'moeda':
      return (valor / 100).toFixed(2).replace('.', ',');
    case 'custo':
      return String(Number((valor / 100).toFixed(4))).replace('.', ',');
    case 'pct':
      return `${(valor * 100).toFixed(1).replace('.', ',')}%`;
    case 'horas':
      return (valor / 60).toFixed(2).replace('.', ',');
    case 'decimal':
      return String(Number(valor.toFixed(3))).replace('.', ',');
    default:
      return String(Math.round(valor));
  }
}

const rotuloCsv = (c: Coluna) => celulaSegura(c.formato === 'moeda' || c.formato === 'custo' ? `${c.rotulo} (R$)` : c.formato === 'horas' ? `${c.rotulo} (h)` : c.rotulo);

function cabecalho(r: Relatorio) {
  return [
    ['Relatório', r.titulo],
    ['Período', `${dataBr(r.periodo.de)} a ${dataBr(r.periodo.ate)}`],
    ...(r.profissional ? [['Profissional', r.profissional]] : []),
    ['Gerado em', DateTime.fromISO(r.geradoEm).setZone(ZONA).toFormat('dd/MM/yyyy HH:mm')],
  ];
}

export function paraCsv(r: Relatorio): Buffer {
  const linhas: string[] = cabecalho(r).map((l) => l.map(celulaSegura).join(';'));
  linhas.push('', 'Indicador;Valor');
  for (const i of r.indicadores) linhas.push(`${celulaSegura(i.rotulo)};${celulaCsv(i.valor, i.formato)}`);
  for (const t of r.tabelas) {
    linhas.push('', celulaSegura(t.titulo), t.colunas.map(rotuloCsv).join(';'));
    for (const l of t.linhas) linhas.push(t.colunas.map((c) => celulaCsv(l[c.id] ?? null, c.formato)).join(';'));
    if (t.total) linhas.push(t.colunas.map((c) => celulaCsv(t.total![c.id] ?? null, c.formato)).join(';'));
    if (t.limitada) linhas.push(celulaSegura(`Mostrando as primeiras ${t.linhas.length} linhas`));
  }
  // BOM: o Excel reconhece UTF-8 (acentos)
  return Buffer.from(`﻿${linhas.join('\r\n')}\r\n`, 'utf8');
}

// ─── PDF ─────────────────────────────────────────────────

const COR = { texto: '#1f1f1e', suave: '#52514e', linha: '#d9d8d4', fundo: '#f3f2ef' };

export function paraPdf(r: Relatorio, empresa: string): Promise<Buffer> {
  const larga = r.tabelas.some((t) => t.colunas.length >= 7);
  const doc = new PDFDocument({
    size: 'A4',
    layout: larga ? 'landscape' : 'portrait',
    margin: 40,
    bufferPages: true,
    info: { Title: `${r.titulo} - ${empresa}`, Producer: 'Agendamento', Creator: 'Agendamento' },
  });
  const partes: Buffer[] = [];
  doc.on('data', (b: Buffer) => partes.push(b));
  const pronto = new Promise<Buffer>((ok, erro) => {
    doc.on('end', () => ok(Buffer.concat(partes)));
    doc.on('error', erro);
  });

  const esq = doc.page.margins.left;
  const largura = doc.page.width - esq - doc.page.margins.right;
  const fundo = () => doc.page.height - doc.page.margins.bottom;

  // Cabeçalho
  doc.fillColor(COR.suave).font('Helvetica').fontSize(9).text(empresa, esq, 40, { width: largura });
  doc.fillColor(COR.texto).font('Helvetica-Bold').fontSize(18).text(r.titulo, { width: largura });
  const info = cabecalho(r)
    .slice(1)
    .map(([k, v]) => `${k}: ${v}`)
    .join('   ·   ');
  doc.font('Helvetica').fontSize(9).fillColor(COR.suave).text(info, { width: largura });
  doc.moveDown(0.3).fontSize(9).text(r.descricao, { width: largura });
  doc.moveDown(0.8);

  // Indicadores em caixas
  const porLinha = Math.min(r.indicadores.length, larga ? 5 : 4) || 1;
  const gap = 8;
  const w = (largura - gap * (porLinha - 1)) / porLinha;
  r.indicadores.forEach((ind, i) => {
    const col = i % porLinha;
    if (col === 0 && i > 0) doc.y += 52;
    const x = esq + col * (w + gap);
    const y = doc.y;
    doc.roundedRect(x, y, w, 46, 4).fillColor(COR.fundo).fill();
    doc.fillColor(COR.suave).font('Helvetica').fontSize(8).text(ind.rotulo, x + 8, y + 7, { width: w - 16, height: 10, ellipsis: true, lineBreak: false });
    doc.fillColor(COR.texto).font('Helvetica-Bold').fontSize(14).text(formatar(ind.valor, ind.formato), x + 8, y + 21, { width: w - 16, lineBreak: false, ellipsis: true });
    doc.y = y;
  });
  if (r.indicadores.length) doc.y += 62;
  doc.x = esq;

  for (const t of r.tabelas) tabelaPdf(doc, t, esq, largura, fundo);

  // Rodapé com página
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i);
    // Rodapé fica dentro da margem de baixo: zera a margem para o pdfkit não abrir página nova
    const margem = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - margem + 12;
    doc.font('Helvetica').fontSize(8).fillColor(COR.suave);
    doc.text(`${r.titulo} · ${dataBr(r.periodo.de)} a ${dataBr(r.periodo.ate)}`, esq, y, { width: largura / 2, lineBreak: false });
    doc.text(`Página ${i + 1} de ${paginas.count}`, esq + largura / 2, y, { width: largura / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = margem;
  }
  doc.end();
  return pronto;
}

function tabelaPdf(doc: PDFKit.PDFDocument, t: Tabela, esq: number, largura: number, fundo: () => number) {
  const ALTURA = 16;
  const pesos = t.colunas.map((c) => (c.formato === 'texto' ? 2.2 : 1));
  const soma = pesos.reduce((a, b) => a + b, 0);
  const larguras = pesos.map((p) => (p / soma) * largura);
  const direita = (c: Coluna) => c.formato !== 'texto' && c.formato !== 'data';

  const linha = (valores: string[], negrito: boolean, fundoCor?: string) => {
    if (doc.y + ALTURA > fundo()) {
      doc.addPage();
      cabecalhoTabela();
    }
    const y = doc.y;
    if (fundoCor) doc.rect(esq, y, largura, ALTURA).fillColor(fundoCor).fill();
    let x = esq;
    doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(COR.texto);
    valores.forEach((v, i) => {
      doc.text(v, x + 4, y + 4.5, { width: larguras[i]! - 8, align: direita(t.colunas[i]!) ? 'right' : 'left', lineBreak: false, ellipsis: true, height: 10 });
      x += larguras[i]!;
    });
    doc
      .moveTo(esq, y + ALTURA)
      .lineTo(esq + largura, y + ALTURA)
      .lineWidth(0.5)
      .strokeColor(COR.linha)
      .stroke();
    doc.y = y + ALTURA;
  };
  const cabecalhoTabela = () => linha(t.colunas.map((c) => c.rotulo), true, COR.fundo);

  if (doc.y + 60 > fundo()) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COR.texto).text(t.titulo, esq, doc.y, { width: largura });
  doc.moveDown(0.3);
  if (!t.linhas.length) {
    doc.font('Helvetica').fontSize(9).fillColor(COR.suave).text(t.vazio, esq, doc.y, { width: largura });
    doc.moveDown(1.2);
    return;
  }
  cabecalhoTabela();
  for (const l of t.linhas) linha(t.colunas.map((c) => formatar(l[c.id] ?? null, c.formato)), false);
  if (t.total) linha(t.colunas.map((c) => formatar(t.total![c.id] ?? null, c.formato)), true);
  if (t.limitada) {
    doc.moveDown(0.3).font('Helvetica').fontSize(8).fillColor(COR.suave).text(`Mostrando as primeiras ${t.linhas.length} linhas.`, esq, doc.y, { width: largura });
  }
  doc.moveDown(1.2);
  doc.x = esq;
}
