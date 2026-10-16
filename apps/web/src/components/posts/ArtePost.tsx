import { forwardRef, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { FONTES } from '../../lib/site';
import { FORMATOS, type Conteudo, type Formato, type Modelo } from '../../lib/posts';

// A arte do post, desenhada no tamanho real (1080 px de largura). Na tela é reduzida com
// transform; na hora de baixar, esta mesma arte vira PNG (o que se vê é o que sai).

export interface Marca {
  nome: string;
  logoUrl: string | null;
  instagram: string | null;
}

function luminancia(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
// Texto branco ou grafite, conforme o fundo (contraste)
const sobre = (hex: string) => (luminancia(hex) > 0.4 ? '#26292a' : '#ffffff');
const contraste = (a: string, b: string) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

const fonte = (f: Conteudo['fonteTitulos']) => `${FONTES[f]?.css ?? "'Instrument Sans Variable'"}, system-ui, sans-serif`;

export const ArtePost = forwardRef<HTMLDivElement, { modelo: Modelo; formato: Formato; c: Conteudo; marca: Marca }>(({ modelo, formato, c, marca }, ref) => {
  const { largura, altura } = FORMATOS[formato];
  const story = formato === 'STORY';
  const comImagemDeFundo = c.fundo === 'IMAGEM' && Boolean(c.imagemUrl);
  // Cor de destaque que some no fundo (ex.: grafite no fundo escuro) vira a cor do texto
  const realce = !comImagemDeFundo && contraste(c.corDestaque, c.corFundo) >= 1.8 ? c.corDestaque : c.corTexto;
  const centro = c.alinhamento === 'CENTRO';
  const P = 88; // margem
  const T = (px: number) => Math.round(px * (story ? 1.12 : formato === 'QUADRADO' ? 0.9 : 1)); // tamanho do texto por formato
  const titulo: CSSProperties = { fontFamily: fonte(c.fonteTitulos), fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1.02, margin: 0 };
  const corpo: CSSProperties = { fontFamily: fonte(c.fonteTexto), margin: 0 };
  const pilula = (fundo: string): CSSProperties => ({
    ...corpo,
    display: 'inline-block',
    alignSelf: centro ? 'center' : 'flex-start',
    background: fundo,
    color: sobre(fundo),
    borderRadius: 999,
    padding: `${T(14)}px ${T(30)}px`,
    fontSize: T(34),
    fontWeight: 500,
  });

  const imagemEmCartao = (alturaPx: number, raio = 36) =>
    c.imagemUrl && !comImagemDeFundo ? (
      <img src={c.imagemUrl} alt="" crossOrigin="anonymous" style={{ width: '100%', height: alturaPx, objectFit: 'cover', borderRadius: raio, display: 'block' }} />
    ) : null;

  let miolo: ReactNode;
  switch (modelo) {
    case 'SERVICO':
      miolo = (
        <>
          {imagemEmCartao(story ? 900 : formato === 'QUADRADO' ? 430 : 640)}
          <div style={{ display: 'flex', flexDirection: 'column', gap: T(22), marginTop: c.imagemUrl && !comImagemDeFundo ? T(48) : 0 }}>
            <h1 style={{ ...titulo, fontSize: T(100) }}>{c.titulo}</h1>
            {c.subtitulo && <p style={{ ...corpo, fontSize: T(36), lineHeight: 1.35, opacity: 0.8, maxWidth: 820 }}>{c.subtitulo}</p>}
            <div style={{ display: 'flex', gap: 20, alignItems: 'center', justifyContent: centro ? 'center' : 'flex-start', marginTop: T(8) }}>
              {c.destaque && <span style={pilula(realce)}>{c.destaque}</span>}
              {c.texto && <span style={{ ...corpo, fontSize: T(34), opacity: 0.75 }}>{c.texto}</span>}
            </div>
          </div>
        </>
      );
      break;
    case 'PROMOCAO':
      miolo = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: T(26) }}>
          <p style={{ ...titulo, fontSize: T(220), color: realce, lineHeight: 0.9 }}>{c.destaque}</p>
          <h1 style={{ ...titulo, fontSize: T(76) }}>{c.titulo}</h1>
          {c.subtitulo && <p style={{ ...corpo, fontSize: T(38), lineHeight: 1.35, opacity: 0.8, maxWidth: 860 }}>{c.subtitulo}</p>}
          {c.texto && <span style={{ ...pilula(c.corTexto), marginTop: T(10) }}>{c.texto}</span>}
        </div>
      );
      break;
    case 'HORARIOS':
      miolo = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: T(30) }}>
          <h1 style={{ ...titulo, fontSize: T(110) }}>{c.titulo}</h1>
          {c.subtitulo && <p style={{ ...corpo, fontSize: T(38), opacity: 0.8 }}>{c.subtitulo}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${story ? 2 : 3}, 1fr)`, gap: T(20), marginTop: T(20) }}>
            {c.itens.map((h, i) => (
              <span
                key={i}
                style={{ ...corpo, fontSize: T(52), fontWeight: 500, textAlign: 'center', padding: `${T(26)}px 0`, borderRadius: 28, background: realce, color: sobre(realce), fontVariantNumeric: 'tabular-nums' }}
              >
                {h}
              </span>
            ))}
          </div>
        </div>
      );
      break;
    case 'DEPOIMENTO':
      miolo = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: T(30) }}>
          <span aria-hidden style={{ ...titulo, fontSize: T(260), lineHeight: 0.6, color: realce, height: T(130) }}>
            “
          </span>
          <p style={{ ...titulo, fontSize: T(64), lineHeight: 1.2, letterSpacing: '-0.02em' }}>{c.texto}</p>
          <p style={{ ...corpo, fontSize: T(36), marginTop: T(10) }}>
            <strong style={{ fontWeight: 600 }}>{c.subtitulo}</strong>
            {c.destaque && <span style={{ opacity: 0.7 }}>, {c.destaque}</span>}
          </p>
        </div>
      );
      break;
    case 'EQUIPE':
      miolo = (
        <>
          {c.imagemUrl && !comImagemDeFundo && (
            <img
              src={c.imagemUrl}
              alt=""
              crossOrigin="anonymous"
              style={{ width: story ? 640 : formato === 'QUADRADO' ? 360 : 480, aspectRatio: '4 / 5', objectFit: 'cover', borderRadius: 40, alignSelf: centro ? 'center' : 'flex-start', display: 'block' }}
            />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: T(18), marginTop: T(44) }}>
            <h1 style={{ ...titulo, fontSize: T(96) }}>{c.titulo}</h1>
            {c.subtitulo && <p style={{ ...corpo, fontSize: T(38), color: realce, fontWeight: 500 }}>{c.subtitulo}</p>}
            {c.texto && <p style={{ ...corpo, fontSize: T(34), lineHeight: 1.4, opacity: 0.8, maxWidth: 860 }}>{c.texto}</p>}
          </div>
        </>
      );
      break;
    default:
      miolo = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: T(34) }}>
          {c.destaque && <span style={pilula(realce)}>{c.destaque}</span>}
          <h1 style={{ ...titulo, fontSize: T(112) }}>{c.titulo}</h1>
          {c.texto && <p style={{ ...corpo, fontSize: T(42), lineHeight: 1.35, opacity: 0.85, maxWidth: 880 }}>{c.texto}</p>}
        </div>
      );
  }

  return (
    <div
      ref={ref}
      style={{
        width: largura,
        height: altura,
        position: 'relative',
        overflow: 'hidden',
        background: c.corFundo,
        color: c.corTexto,
        fontFamily: fonte(c.fonteTexto),
        textAlign: centro ? 'center' : 'left',
      }}
    >
      {comImagemDeFundo && (
        <>
          <img src={c.imagemUrl!} alt="" crossOrigin="anonymous" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          {/* Escurece embaixo para o texto ter contraste */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(15,16,16,.78) 0%, rgba(15,16,16,.35) 45%, rgba(15,16,16,.1) 100%)' }} />
        </>
      )}
      <div
        style={{
          position: 'relative',
          height: '100%',
          boxSizing: 'border-box',
          padding: story ? `${P + 140}px ${P}px ${P + 160}px` : P, // story: deixa livre o topo e o rodapé do Instagram
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: centro ? 'center' : 'stretch',
        }}
      >
        {c.mostrarLogo ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, justifyContent: centro ? 'center' : 'flex-start' }}>
            {marca.logoUrl && <img src={marca.logoUrl} alt="" crossOrigin="anonymous" style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 16 }} />}
            <span style={{ ...corpo, fontSize: 30, fontWeight: 600, letterSpacing: '-0.01em' }}>{marca.nome}</span>
          </div>
        ) : (
          <span />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: centro ? 'center' : 'stretch', justifyContent: comImagemDeFundo ? 'flex-end' : 'center', flex: 1, paddingTop: 48, paddingBottom: 48 }}>
          {miolo}
        </div>

        <div style={{ display: 'flex', justifyContent: centro ? 'center' : 'space-between', gap: 24, ...corpo, fontSize: 28, opacity: 0.8, flexWrap: 'wrap' }}>
          {c.rodape && <span>{c.rodape}</span>}
          {marca.instagram && !centro && <span>@{marca.instagram}</span>}
        </div>
      </div>
    </div>
  );
});
ArtePost.displayName = 'ArtePost';

// Mostra a arte reduzida para caber na largura disponível
export function Miniatura({ formato, children, className }: { formato: Formato; children: ReactNode; className?: string }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(0);
  const { largura, altura } = FORMATOS[formato];
  useLayoutEffect(() => {
    if (!caixa.current) return;
    const obs = new ResizeObserver(([e]) => setEscala(e!.contentRect.width / largura));
    obs.observe(caixa.current);
    return () => obs.disconnect();
  }, [largura]);
  return (
    <div ref={caixa} className={className} style={{ aspectRatio: `${largura} / ${altura}`, position: 'relative', overflow: 'hidden' }}>
      {escala > 0 && <div style={{ transform: `scale(${escala})`, transformOrigin: 'top left', width: largura, height: altura, position: 'absolute', top: 0, left: 0 }}>{children}</div>}
    </div>
  );
}
