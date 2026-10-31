// Les cartes de Trio, dessinées en SVG : chaque nombre a sa couleur et son motif (le 7 est noir et or), pour qu'on s'en souvienne d'un coup d'œil.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { linked } from '../../../shared/protocol';
import { cls } from '../lib/util';

type Motif = 'dots' | 'stripes' | 'squiggle' | 'triangles' | 'halves' | 'zigzag' | 'stars' | 'rings' | 'crosses' | 'squares' | 'dashes' | 'waves';

interface Face {
  bg: string;
  motif: string;
  shape: Motif;
}

export const FACES: Record<number, Face> = {
  1: { bg: '#ff6b6b', motif: '#ffd6d1', shape: 'dots' },
  2: { bg: '#ff9a3d', motif: '#ffe4c4', shape: 'stripes' },
  3: { bg: '#ffd23f', motif: '#e08e00', shape: 'squiggle' },
  4: { bg: '#b5e04a', motif: '#4f8a12', shape: 'triangles' },
  5: { bg: '#3ec98a', motif: '#d2f7e4', shape: 'halves' },
  6: { bg: '#19b3b1', motif: '#c4f3f0', shape: 'zigzag' },
  7: { bg: '#1f1b2e', motif: '#ffd23f', shape: 'stars' },
  8: { bg: '#5cc8ff', motif: '#e3f6ff', shape: 'rings' },
  9: { bg: '#4a6cff', motif: '#d0d9ff', shape: 'crosses' },
  10: { bg: '#8a63ff', motif: '#e2d7ff', shape: 'squares' },
  11: { bg: '#d65cff', motif: '#f7d9ff', shape: 'dashes' },
  12: { bg: '#ff5fa2', motif: '#ffd6e8', shape: 'waves' },
};

const INK = '#1f1b2e';
const PAPER = '#fffaf2';
const GOLD = '#ffd23f';

/** Emplacements des motifs autour du médaillon, loin des coins où s'écrit le nombre. */
const ANCHORS: [number, number, number][] = [
  [76, 17, 15],
  [90, 44, -20],
  [10, 52, 30],
  [15, 88, -10],
  [89, 82, 25],
  [28, 124, -30],
  [58, 129, 10],
  [50, 14, 0],
];

function motif(shape: Motif, color: string): ReactNode {
  const stroke = { fill: 'none', stroke: color, strokeWidth: 2.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return ANCHORS.map(([x, y, r], i) => {
    const t = `translate(${x} ${y}) rotate(${r})`;
    switch (shape) {
      case 'dots':
        return <circle key={i} transform={t} r={i % 2 ? 3.6 : 5} fill={color} />;
      case 'stripes':
        return <rect key={i} transform={t} x={-7} y={-2} width={14} height={4} rx={2} fill={color} />;
      case 'squiggle':
        return <path key={i} transform={t} d="M-8 0q2-4 4 0t4 0t4 0t4 0" {...stroke} />;
      case 'triangles':
        return <path key={i} transform={t} d="M0-6L6 5H-6Z" fill={color} />;
      case 'halves':
        return <path key={i} transform={t} d="M-6 2.5a6 6 0 0 1 12 0Z" fill={color} />;
      case 'zigzag':
        return <path key={i} transform={t} d="M-8 2l4-5 4 5 4-5 4 5" {...stroke} />;
      case 'stars':
        return <path key={i} transform={`${t} scale(${i % 2 ? 0.75 : 1})`} d="M0-7L1.8-1.8 7 0 1.8 1.8 0 7-1.8 1.8-7 0-1.8-1.8Z" fill={color} />;
      case 'rings':
        return <circle key={i} transform={t} r={4.4} {...stroke} strokeWidth={2.3} />;
      case 'crosses':
        return <path key={i} transform={t} d="M-5 0H5M0-5V5" {...stroke} strokeWidth={3} />;
      case 'squares':
        return <rect key={i} transform={t} x={-4} y={-4} width={8} height={8} fill={color} />;
      case 'dashes':
        return <path key={i} transform={t} d="M-6-2.5H6M-6 2.5H6" {...stroke} />;
      case 'waves':
        return <path key={i} transform={t} d="M-7 2a3.5 3.5 0 0 1 7 0a3.5 3.5 0 0 1 7 0" {...stroke} />;
    }
  });
}

/** Le chiffre, avec un trait sous le 6 et le 9 pour ne jamais les confondre. */
function Numeral({ value, x, y, size, fill, stroke }: { value: number; x: number; y: number; size: number; fill: string; stroke?: string }) {
  const two = value >= 10;
  const fs = two ? size * 0.8 : size;
  return (
    <g>
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="'Dela Gothic One', 'Arial Black', sans-serif"
        fontSize={fs}
        fill={fill}
        stroke={stroke}
        strokeWidth={stroke ? fs * 0.16 : 0}
        paintOrder="stroke"
        letterSpacing={two ? -fs * 0.06 : 0}
      >
        {value}
      </text>
      {(value === 6 || value === 9) && <rect x={x - fs * 0.22} y={y + fs * 0.5} width={fs * 0.44} height={fs * 0.09} rx={fs * 0.04} fill={fill} />}
    </g>
  );
}

function Front({ value, mini, links }: { value: number; mini: boolean; links: boolean }) {
  const f = FACES[value];
  const seven = value === 7;
  if (mini) {
    return (
      <>
        <rect x="3" y="3" width="94" height="134" rx="14" fill={f.bg} stroke={INK} strokeWidth="6" />
        {seven && <path d="M50 22L54 34 66 36 54 40 50 52 46 40 34 36 46 34Z" fill={GOLD} />}
        <Numeral value={value} x={50} y={seven ? 86 : 72} size={66} fill={seven ? GOLD : INK} stroke={seven ? undefined : PAPER} />
      </>
    );
  }
  const tags = links ? linked(value) : [];
  return (
    <>
      <rect x="2" y="2" width="96" height="136" rx="12" fill={f.bg} />
      {motif(f.shape, f.motif)}
      <circle cx="53" cy="74" r="27" fill={INK} />
      <circle cx="50" cy="71" r="27" fill={seven ? GOLD : PAPER} stroke={INK} strokeWidth="3.5" />
      <Numeral value={value} x={50} y={71} size={34} fill={INK} />
      <g transform="translate(6 6)">
        <rect width="22" height="24" rx="6" fill={PAPER} stroke={INK} strokeWidth="2.5" />
        <Numeral value={value} x={11} y={12} size={14} fill={INK} />
      </g>
      {tags.length > 0 && (
        <g transform="translate(50 124)">
          <rect x={-(tags.length * 11 + 4)} y="-9" width={tags.length * 22 + 8} height="18" rx="9" fill={PAPER} stroke={INK} strokeWidth="2" />
          {tags.map((t, i) => (
            <text key={t} x={(i - (tags.length - 1) / 2) * 22} y="0.5" textAnchor="middle" dominantBaseline="central" fontFamily="'Dela Gothic One', 'Arial Black', sans-serif" fontSize="11" fill={INK}>
              {t}
            </text>
          ))}
        </g>
      )}
      <rect x="2" y="2" width="96" height="136" rx="12" fill="none" stroke={INK} strokeWidth="4" />
    </>
  );
}

const BACK_BITS: [number, number, string, 'c' | 't' | 's' | 'z'][] = [
  [18, 20, '#ff5fa2', 'c'],
  [80, 24, '#ffd23f', 't'],
  [86, 70, '#19b3b1', 's'],
  [14, 76, '#5cc8ff', 'z'],
  [24, 118, '#ffd23f', 's'],
  [78, 116, '#ff5fa2', 'c'],
  [52, 18, '#b5e04a', 'z'],
  [50, 126, '#8a63ff', 't'],
];

function Back({ mini }: { mini: boolean }) {
  return (
    <>
      <rect x="2" y="2" width="96" height="136" rx="12" fill={INK} />
      {!mini && (
        <>
          <rect x="9" y="9" width="82" height="122" rx="7" fill="none" stroke={PAPER} strokeOpacity="0.28" strokeWidth="1.6" strokeDasharray="3 4" />
          {BACK_BITS.map(([x, y, c, k], i) =>
            k === 'c' ? (
              <circle key={i} cx={x} cy={y} r="4.5" fill={c} />
            ) : k === 't' ? (
              <path key={i} d={`M${x} ${y - 5}l5 9h-10z`} fill={c} />
            ) : k === 's' ? (
              <path key={i} d={`M${x - 7} ${y}q2-4 4 0t4 0t4 0`} fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" />
            ) : (
              <path key={i} d={`M${x - 6} ${y + 2}l3-4 3 4 3-4 3 4`} fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            ),
          )}
        </>
      )}
      {mini && <rect x="12" y="12" width="76" height="116" rx="6" fill="none" stroke={PAPER} strokeOpacity="0.45" strokeWidth="5" />}
      <g transform={mini ? 'translate(50 70) scale(1.25)' : 'translate(50 66)'}>
        <circle cx="-9" cy="-5" r="12" fill="#ff5fa2" stroke={INK} strokeWidth="2.5" />
        <circle cx="9" cy="-5" r="12" fill="#ffd23f" stroke={INK} strokeWidth="2.5" />
        <circle cx="0" cy="9" r="12" fill="#19b3b1" stroke={INK} strokeWidth="2.5" />
      </g>
      {!mini && (
        <text x="50" y="104" textAnchor="middle" fontFamily="'Dela Gothic One', 'Arial Black', sans-serif" fontSize="13" letterSpacing="2" fill={PAPER}>
          TRIO
        </text>
      )}
      <rect x="2" y="2" width="96" height="136" rx="12" fill="none" stroke={INK} strokeWidth={mini ? 6 : 4} />
    </>
  );
}

export interface CardProps {
  /** null : le dos de la carte. */
  value?: number | null;
  /** Les toutes petites cartes (mains des autres) : le nombre seul, sans motif. */
  mini?: boolean;
  /** Mode piquant : les nombres liés, en bas de la carte. */
  links?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function TrioCard({ value = null, mini = false, links = false, className, style }: CardProps) {
  return (
    <svg className={cls('card', mini && 'is-mini', value === null && 'is-back', className)} viewBox="0 0 100 140" style={style} role="img" aria-label={value === null ? 'Carte face cachée' : `Carte ${value}`}>
      {value === null ? <Back mini={mini} /> : <Front value={value} mini={mini} links={links} />}
    </svg>
  );
}

/**
 * Une carte qui se retourne. Quand elle repart face cachée, elle garde sa face le temps du mouvement,
 * puis l'oublie : rien ne reste dans la page une fois la carte retournée.
 */
export function FlipCard({ value, mini, links, className, style }: CardProps) {
  const [face, setFace] = useState<number | null>(value ?? null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (value !== null && value !== undefined) setFace(value);
    else timer.current = window.setTimeout(() => setFace(null), 520);
    return () => window.clearTimeout(timer.current);
  }, [value]);
  const down = value === null || value === undefined;
  return (
    <span className={cls('flip', down && 'is-down', mini && 'is-mini', className)} style={style}>
      <span className="flip-inner">
        <span className="flip-face flip-front">{face !== null ? <TrioCard value={face} mini={mini} links={links} /> : <TrioCard mini={mini} />}</span>
        <span className="flip-face flip-back">
          <TrioCard mini={mini} />
        </span>
      </span>
    </span>
  );
}

export function cardLabel(value: number): string {
  return String(value);
}
