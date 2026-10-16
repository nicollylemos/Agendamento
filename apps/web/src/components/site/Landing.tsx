import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router';
import { AtSign, Clock, MapPin, MessageCircle, Phone, User } from 'lucide-react';
import { formatarCentavos, formatarDuracao, DIAS_SEMANA } from '../../lib/formato';
import { estiloDoTema, type Personalizacao } from '../../lib/site';
import { cx } from '../ui';

// RF09: landing page (serviços, equipe, galeria, depoimentos, mapa e contato)
// RF10: seções na ordem e com a visibilidade que o admin escolheu
// RF11: cada serviço leva direto para ele na tela de agendamento
// Usa container queries (@md, @3xl): a mesma página serve para o site e para a prévia do painel (RF08).

export interface EmpresaSite {
  nome: string;
  email: string | null;
  telefone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  endereco: { logradouro: string | null; numero: string | null; complemento?: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep?: string | null };
  horarioFuncionamento: { diaSemana: number; abre: string; fecha: string }[];
  politicaCancelamento?: string | null;
  politicaAtraso?: string | null;
}

export interface ServicoSite {
  id: string;
  nome: string;
  descricao: string | null;
  duracaoMin: number;
  precoCentavos: number;
  fotoUrl: string | null;
  categoria?: { id: string; nome: string; ordem: number } | null;
  profissionais: { precoCentavos: number }[];
}

export interface MembroSite {
  id: string;
  nome: string;
  cargo: string | null;
  bio: string | null;
  fotoUrl: string | null;
}

const soDigitos = (t: string) => t.replace(/\D/g, '');
const zap = (n: string) => `https://wa.me/${soDigitos(n).length <= 11 ? `55${soDigitos(n)}` : soDigitos(n)}`;
const linkSublinhado = 'underline decoration-[#c9c8c3] underline-offset-4 hover:decoration-current';

function enderecoTexto(e: EmpresaSite['endereco']) {
  const linha1 = [e.logradouro, e.numero].filter(Boolean).join(', ');
  const linha2 = [e.bairro, [e.cidade, e.uf].filter(Boolean).join(' - ')].filter(Boolean).join(', ');
  return [linha1, linha2].filter(Boolean).join(', ');
}

// "Aberto agora, até 19:00" / "Fechado agora, abre amanhã às 09:00"
function situacaoAgora(horarios: EmpresaSite['horarioFuncionamento'], agora = new Date()) {
  if (!horarios.length) return null;
  const dia = agora.getDay();
  const hhmm = agora.toTimeString().slice(0, 5);
  const hoje = horarios.find((h) => h.diaSemana === dia);
  if (hoje && hhmm >= hoje.abre && hhmm < hoje.fecha) return { aberto: true, texto: `Aberto agora, até ${hoje.fecha}` };
  if (hoje && hhmm < hoje.abre) return { aberto: false, texto: `Fechado agora, abre hoje às ${hoje.abre}` };
  for (let i = 1; i <= 7; i++) {
    const d = (dia + i) % 7;
    const h = horarios.find((x) => x.diaSemana === d);
    if (h) return { aberto: false, texto: `Fechado agora, abre ${i === 1 ? 'amanhã' : DIAS_SEMANA[d]!.toLowerCase()} às ${h.abre}` };
  }
  return null;
}

export function Landing({
  empresa,
  p,
  servicos,
  equipe,
  previa = false,
}: {
  empresa: EmpresaSite | null;
  p: Personalizacao;
  servicos: ServicoSite[];
  equipe: MembroSite[];
  previa?: boolean;
}) {
  const nome = empresa?.nome ?? 'Seu negócio';
  const contato = empresa?.whatsapp ?? empresa?.telefone ?? null;
  const endereco = empresa ? enderecoTexto(empresa.endereco) : '';
  const mapa = endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${nome}, ${endereco}`)}` : null;
  const agora = empresa ? situacaoAgora(empresa.horarioFuncionamento) : null;
  const instagram = empresa?.instagram ? empresa.instagram.replace(/^@/, '').replace(/[^\w.]/g, '') : null;
  // Na prévia, nenhum link navega (o admin está só olhando)
  const travar = previa ? (e: MouseEvent) => e.preventDefault() : undefined;
  const visivel = (id: string) => p.secoes.some((s) => s.id === id && s.visivel);

  const BotaoAgendar = ({ para = '/agendar', children, claro = false, grande = false }: { para?: string; children: ReactNode; claro?: boolean; grande?: boolean }) => (
    <Link
      to={para}
      onClick={travar}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        grande ? 'h-12 px-6 text-[0.9375rem]' : 'h-10 px-4 text-sm',
        claro ? 'bg-white text-tinta hover:bg-white/90' : 'bg-destaque text-white hover:bg-destaque/85',
      )}
    >
      {children}
    </Link>
  );

  // Serviços agrupados por categoria (quando houver mais de uma)
  const categorias = new Map<string, { nome: string; ordem: number; itens: ServicoSite[] }>();
  for (const s of servicos) {
    const k = s.categoria?.id ?? 'sem';
    if (!categorias.has(k)) categorias.set(k, { nome: s.categoria?.nome ?? 'Outros', ordem: s.categoria?.ordem ?? 9999, itens: [] });
    categorias.get(k)!.itens.push(s);
  }
  const grupos = [...categorias.values()].sort((a, b) => a.ordem - b.ordem);

  const secoes: Record<string, ReactNode> = {
    // Como funciona: é uma sequência de verdade, então vai numerada
    comoFunciona: (
      <Secao id="como-funciona" titulo="Como funciona">
        <ol className="grid gap-8 @3xl:grid-cols-3">
          {[
            ['Escolha o serviço', 'Veja o tempo e o valor de cada um antes de escolher.'],
            ['Escolha quem atende e o horário', 'Só aparecem horários livres de verdade, na hora.'],
            ['Confirme', 'Você recebe a confirmação por e-mail e pode remarcar ou cancelar pelo link.'],
          ].map(([t, d], i) => (
            <li key={t} className="grid content-start gap-2 border-t border-tinta pt-4">
              <span className="text-sm tabular-nums text-tinta-suave">{i + 1}</span>
              <h3 className="font-titulo text-lg font-medium">{t}</h3>
              <p className="text-sm leading-relaxed text-tinta-suave">{d}</p>
            </li>
          ))}
        </ol>
      </Secao>
    ),
    // Serviços como um cardápio, a linha inteira leva ao agendamento daquele serviço (RF11)
    servicos: servicos.length > 0 && (
      <Secao id="servicos" titulo="Serviços">
        <div className="grid gap-10">
          {grupos.map((g) => (
            <div key={g.nome} className="grid gap-1">
              {grupos.length > 1 && <h3 className="mb-2 text-sm text-tinta-suave">{g.nome}</h3>}
              <ul className="grid gap-x-12 @3xl:grid-cols-2">
                {g.itens.map((s) => {
                  const precos = s.profissionais.map((x) => x.precoCentavos);
                  const min = Math.min(...precos);
                  return (
                    <li key={s.id} className="border-t border-borda">
                      <Link to={`/agendar?servico=${s.id}`} onClick={travar} className="group flex gap-4 py-5" aria-label={`Agendar ${s.nome}`}>
                        {s.fotoUrl && <img src={s.fotoUrl} alt="" loading="lazy" className="size-20 shrink-0 rounded-xl object-cover" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-4">
                            <h4 className="font-titulo text-lg font-medium">{s.nome}</h4>
                            <span className="shrink-0 tabular-nums">{min === Math.max(...precos) ? formatarCentavos(min) : `a partir de ${formatarCentavos(min)}`}</span>
                          </div>
                          {s.descricao && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-tinta-suave">{s.descricao}</p>}
                          <p className="mt-2 flex items-center justify-between gap-4 text-sm text-tinta-suave">
                            <span className="inline-flex items-center gap-1.5">
                              <Clock className="size-3.5" strokeWidth={1.6} aria-hidden />
                              {formatarDuracao(s.duracaoMin)}
                            </span>
                            <span className="text-tinta underline decoration-[#c9c8c3] underline-offset-4 group-hover:decoration-current">Agendar</span>
                          </p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </Secao>
    ),
    sobre: p.textos.sobre && (
      <Secao id="sobre" titulo={`Sobre ${nome}`}>
        <p className="max-w-2xl whitespace-pre-line font-titulo text-xl leading-relaxed @3xl:text-2xl">{p.textos.sobre}</p>
      </Secao>
    ),
    equipe: equipe.length > 0 && (
      <Secao id="equipe" titulo="Equipe">
        <ul className="grid grid-cols-2 gap-x-6 gap-y-10 @4xl:grid-cols-3">
          {equipe.map((m) => (
            <li key={m.id} className="grid content-start gap-3">
              {m.fotoUrl ? (
                <img src={m.fotoUrl} alt="" loading="lazy" className="aspect-[4/5] w-full rounded-xl object-cover" />
              ) : (
                <span className="grid aspect-[4/5] w-full place-items-center rounded-xl bg-fundo text-[#c9c8c3]">
                  <User className="size-10" strokeWidth={1.2} aria-hidden />
                </span>
              )}
              <div>
                <h3 className="font-titulo font-medium">{m.nome}</h3>
                {m.cargo && <p className="text-sm text-tinta-suave">{m.cargo}</p>}
                {m.bio && <p className="mt-2 line-clamp-4 text-sm leading-relaxed">{m.bio}</p>}
              </div>
            </li>
          ))}
        </ul>
      </Secao>
    ),
    // Galeria: a primeira foto ocupa mais espaço
    galeria: p.galeria.length > 0 && (
      <Secao id="galeria" titulo="Galeria">
        <ul className="grid grid-cols-2 gap-3 @3xl:grid-cols-3">
          {p.galeria.map((g, i) => (
            <li key={g.url} className={cx('overflow-hidden rounded-xl', i === 0 && p.galeria.length >= 3 && 'col-span-2 row-span-2')}>
              <figure className="h-full">
                <img src={g.url} alt={g.legenda || ''} loading="lazy" className="aspect-square h-full w-full object-cover" />
                {g.legenda && <figcaption className="pt-1.5 text-xs text-tinta-suave">{g.legenda}</figcaption>}
              </figure>
            </li>
          ))}
        </ul>
      </Secao>
    ),
    depoimentos: p.depoimentos.length > 0 && (
      <Secao id="depoimentos" titulo="O que dizem">
        <ul className="grid gap-x-10 gap-y-8 @md:grid-cols-2">
          {p.depoimentos.map((d, i) => (
            <li key={i} className="grid content-start gap-3 border-t border-borda pt-5">
              <blockquote className="whitespace-pre-line font-titulo text-lg leading-relaxed">“{d.texto}”</blockquote>
              <p className="text-sm text-tinta-suave">{d.nome}</p>
            </li>
          ))}
        </ul>
      </Secao>
    ),
    politicas: (empresa?.politicaCancelamento || empresa?.politicaAtraso) && (
      <Secao id="politicas" titulo="Antes de vir">
        <dl className="grid gap-8 @3xl:grid-cols-2">
          {empresa?.politicaCancelamento && (
            <div className="grid content-start gap-2">
              <dt className="font-medium">Cancelamento e remarcação</dt>
              <dd className="whitespace-pre-line text-sm leading-relaxed text-tinta-suave">{empresa.politicaCancelamento}</dd>
            </div>
          )}
          {empresa?.politicaAtraso && (
            <div className="grid content-start gap-2">
              <dt className="font-medium">Atrasos</dt>
              <dd className="whitespace-pre-line text-sm leading-relaxed text-tinta-suave">{empresa.politicaAtraso}</dd>
            </div>
          )}
        </dl>
      </Secao>
    ),
    contato: empresa && (endereco || empresa.whatsapp || empresa.telefone || instagram || empresa.horarioFuncionamento.length > 0) && (
      <Secao id="contato" titulo="Onde estamos">
        <div className="grid gap-10 @3xl:grid-cols-2">
          <div className="grid content-start gap-5">
            {endereco && (
              <p className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 size-4 shrink-0 text-tinta-suave" strokeWidth={1.6} aria-hidden />
                <span>
                  {endereco}
                  {mapa && (
                    <>
                      <br />
                      {/* Mapa: link para o Google Maps (sem iframe de terceiros na página, 9.4) */}
                      <a href={mapa} target="_blank" rel="noopener noreferrer" onClick={travar} className={cx('text-sm', linkSublinhado)}>
                        Ver no mapa
                      </a>
                    </>
                  )}
                </span>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {empresa.whatsapp && (
                <a href={zap(empresa.whatsapp)} target="_blank" rel="noopener noreferrer" onClick={travar} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#dddcd8] px-4 text-sm font-medium hover:bg-fundo">
                  <MessageCircle className="size-4" strokeWidth={1.6} aria-hidden />
                  WhatsApp
                </a>
              )}
              {empresa.telefone && (
                <a href={`tel:${soDigitos(empresa.telefone)}`} onClick={travar} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#dddcd8] px-4 text-sm font-medium hover:bg-fundo">
                  <Phone className="size-4" strokeWidth={1.6} aria-hidden />
                  {empresa.telefone}
                </a>
              )}
              {instagram && (
                <a href={`https://instagram.com/${instagram}`} target="_blank" rel="noopener noreferrer" onClick={travar} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#dddcd8] px-4 text-sm font-medium hover:bg-fundo">
                  <AtSign className="size-4" strokeWidth={1.6} aria-hidden />
                  {instagram}
                </a>
              )}
            </div>
          </div>
          {empresa.horarioFuncionamento.length > 0 && (
            <div className="grid content-start gap-3">
              {agora && (
                <p className="flex items-center gap-2 text-sm">
                  <span className={cx('size-2 rounded-full', agora.aberto ? 'bg-ok' : 'bg-[#c9c8c3]')} aria-hidden />
                  {agora.texto}
                </p>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-8 text-sm">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const h = empresa.horarioFuncionamento.find((x) => x.diaSemana === d);
                  const hoje = d === new Date().getDay();
                  return (
                    <div key={d} className={cx('contents', hoje ? 'font-medium text-tinta' : '')}>
                      <dt className={cx('border-t border-borda py-2', !hoje && 'text-tinta-suave')}>
                        {DIAS_SEMANA[d]}
                        {hoje && ' (hoje)'}
                      </dt>
                      <dd className="border-t border-borda py-2 text-right tabular-nums">{h ? `${h.abre} às ${h.fecha}` : 'Fechado'}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          )}
        </div>
      </Secao>
    ),
  };

  // Atalhos do topo: só para as seções que aparecem
  const atalhos = (
    [
      ['servicos', 'Serviços', servicos.length > 0],
      ['equipe', 'Equipe', equipe.length > 0],
      ['galeria', 'Galeria', p.galeria.length > 0],
      ['contato', 'Contato', Boolean(secoes.contato)],
    ] as [string, string, boolean][]
  ).filter(([id, , tem]) => tem && visivel(id));

  return (
    <div className={cx('@container min-h-full bg-superficie text-tinta', !previa && 'pb-20 @3xl:pb-0')} style={estiloDoTema(p.tema)}>
      <header className={cx('top-0 z-30 border-b border-borda bg-superficie/95 backdrop-blur', previa ? 'relative' : 'sticky')}>
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-5">
          <Link to="/" onClick={travar} className="flex min-w-0 items-center gap-2.5">
            {p.logoUrl && <img src={p.logoUrl} alt="" className="size-9 rounded-lg object-contain" />}
            <span className="truncate font-titulo text-[1.0625rem] font-semibold">{nome}</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-tinta-suave @3xl:flex" aria-label="Seções">
            {atalhos.map(([id, rotulo]) => (
              <a key={id} href={`#${id}`} onClick={travar} className="hover:text-tinta">
                {rotulo}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/meus-agendamentos" onClick={travar} className="hidden text-sm text-tinta-suave hover:text-tinta @md:inline">
              Meus agendamentos
            </Link>
            <BotaoAgendar>{p.textos.chamadaBotao}</BotaoAgendar>
          </div>
        </div>
      </header>

      {/* Abertura: com foto, texto à esquerda e foto à direita; sem foto, só tipografia */}
      <section aria-label="Apresentação" className="mx-auto max-w-5xl px-5">
        <div className={cx('grid items-center gap-10 py-16 @3xl:py-24', p.bannerUrl && '@3xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]')}>
          <div className="grid gap-6">
            <h1 className="max-w-3xl font-titulo text-[2.75rem] leading-[1.05] font-medium tracking-[-0.03em] @3xl:text-[4rem]">{p.textos.titulo}</h1>
            {p.textos.subtitulo && <p className="max-w-lg text-lg leading-relaxed text-tinta-suave">{p.textos.subtitulo}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <BotaoAgendar grande>{p.textos.chamadaBotao}</BotaoAgendar>
              {servicos.length > 0 && visivel('servicos') && (
                <a href="#servicos" onClick={travar} className={cx('text-sm', linkSublinhado)}>
                  Ver serviços e preços
                </a>
              )}
            </div>
          </div>
          {p.bannerUrl && <img src={p.bannerUrl} alt="" className="aspect-[4/5] w-full rounded-2xl object-cover" />}
        </div>

        {/* Faixa de informações: está aberto? onde fica? como falar? */}
        {empresa && (agora || endereco || contato) && (
          <dl className="grid gap-px overflow-hidden rounded-xl border border-borda bg-borda text-sm @3xl:grid-cols-3">
            {agora && (
              <div className="grid content-start gap-1 bg-superficie p-5">
                <dt className="text-tinta-suave">Hoje</dt>
                <dd className="flex items-center gap-2 font-medium">
                  <span className={cx('size-2 shrink-0 rounded-full', agora.aberto ? 'bg-ok' : 'bg-[#c9c8c3]')} aria-hidden />
                  {agora.texto}
                </dd>
              </div>
            )}
            {endereco && (
              <div className="grid content-start gap-1 bg-superficie p-5">
                <dt className="text-tinta-suave">Onde</dt>
                <dd className="font-medium">
                  {mapa ? (
                    <a href={mapa} target="_blank" rel="noopener noreferrer" onClick={travar} className={linkSublinhado}>
                      {endereco}
                    </a>
                  ) : (
                    endereco
                  )}
                </dd>
              </div>
            )}
            {contato && (
              <div className="grid content-start gap-1 bg-superficie p-5">
                <dt className="text-tinta-suave">Fale com a gente</dt>
                <dd className="font-medium">
                  <a href={zap(contato)} target="_blank" rel="noopener noreferrer" onClick={travar} className={linkSublinhado}>
                    WhatsApp {contato}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        )}
      </section>

      <div className="mt-8">
        {p.secoes.filter((s) => s.visivel).map((s) => (
          <div key={s.id}>{secoes[s.id]}</div>
        ))}
      </div>

      {/* Chamada final */}
      <section className="mx-auto max-w-5xl px-5 py-16">
        <div className="grid gap-6 rounded-2xl bg-destaque p-8 text-white @3xl:grid-cols-[1fr_auto] @3xl:items-center @3xl:p-12">
          <div>
            <h2 className="font-titulo text-3xl font-medium tracking-[-0.02em]">Seu próximo horário está a um minuto</h2>
            <p className="mt-2 text-white/80">Escolha o serviço, quem atende e o horário. A confirmação chega por e-mail.</p>
          </div>
          <BotaoAgendar claro grande>
            {p.textos.chamadaBotao}
          </BotaoAgendar>
        </div>
      </section>

      <footer className="border-t border-borda">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-10 text-sm text-tinta-suave">
          <p>
            © {new Date().getFullYear()} {nome}
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/meus-agendamentos" onClick={travar} className="hover:text-tinta">
              Meus agendamentos e pontos
            </Link>
            {instagram && (
              <a href={`https://instagram.com/${instagram}`} target="_blank" rel="noopener noreferrer" onClick={travar} className="hover:text-tinta">
                Instagram
              </a>
            )}
            {contato && (
              <a href={zap(contato)} target="_blank" rel="noopener noreferrer" onClick={travar} className="hover:text-tinta">
                WhatsApp
              </a>
            )}
          </div>
        </div>
      </footer>

      {/* Celular: botão de agendar sempre à mão */}
      {!previa && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-borda bg-superficie/95 p-3 backdrop-blur @3xl:hidden">
          <Link to="/agendar" className="flex h-12 items-center justify-center rounded-lg bg-destaque text-[0.9375rem] font-medium text-white">
            {p.textos.chamadaBotao}
          </Link>
        </div>
      )}
    </div>
  );
}

function Secao({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-5xl scroll-mt-20 px-5" aria-labelledby={`titulo-${id}`}>
      <div className="grid gap-8 border-t border-borda py-16 @3xl:grid-cols-[200px_minmax(0,1fr)] @3xl:gap-12 @3xl:py-20">
        <h2 id={`titulo-${id}`} className="font-titulo text-xl font-medium tracking-[-0.015em]">
          {titulo}
        </h2>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}
