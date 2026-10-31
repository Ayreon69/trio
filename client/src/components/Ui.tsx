// Briques d'interface communes : boutons, fenêtres, pastilles, sélecteurs, logo, avatars et décor Memphis.
import { X } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TEAM_NAMES } from '../../../shared/protocol';
import { cls } from '../lib/util';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'soft';
  icon?: ReactNode;
}

export function Button({ variant = 'default', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cls('btn', `btn-${variant}`, className)} {...rest}>
      {icon}
      {children && <span className="btn-label">{children}</span>}
    </button>
  );
}

/** Le titre : quatre lettres épaisses, chacune portée par trois ombres de couleur, comme un trio. */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={cls('logo', `logo-${size}`)} role="img" aria-label="Trio">
      {'TRIO'.split('').map((l, i) => (
        <span key={i} className="logo-letter" style={{ '--i': i } as CSSProperties} aria-hidden>
          {l}
        </span>
      ))}
    </div>
  );
}

/** Le décor : du papier crème semé de formes Memphis qui flottent doucement. */
export function Backdrop({ children, className, quiet = false }: { children: ReactNode; className?: string; quiet?: boolean }) {
  return (
    <div className={cls('backdrop', quiet && 'is-quiet', className)}>
      <svg className="memphis" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <g className="m-float m1">
          <path d="M30 90q12-18 24 0t24 0t24 0" fill="none" stroke="#ff5fa2" strokeWidth="7" strokeLinecap="round" />
        </g>
        <g className="m-float m2">
          <path d="M330 60l26 44h-52z" fill="#ffd23f" stroke="#1f1b2e" strokeWidth="4" strokeLinejoin="round" />
        </g>
        <g className="m-float m3">
          <circle cx="352" cy="300" r="22" fill="none" stroke="#19b3b1" strokeWidth="7" />
        </g>
        <g className="m-float m4">
          <path d="M18 420l12-14 12 14 12-14 12 14" fill="none" stroke="#4a6cff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g className="m-float m5">
          {Array.from({ length: 12 }, (_, i) => (
            <circle key={i} cx={300 + (i % 4) * 14} cy={520 + Math.floor(i / 4) * 14} r="3.5" fill="#1f1b2e" opacity="0.55" />
          ))}
        </g>
        <g className="m-float m6">
          <rect x="40" y="640" width="46" height="46" fill="#b5e04a" stroke="#1f1b2e" strokeWidth="4" transform="rotate(18 63 663)" />
        </g>
        <g className="m-float m7">
          <path d="M300 740a26 26 0 0 1 52 0z" fill="#ff9a3d" stroke="#1f1b2e" strokeWidth="4" />
        </g>
        <g className="m-float m8">
          <path d="M368 196h14M375 189v14" stroke="#8a63ff" strokeWidth="6" strokeLinecap="round" />
          <path d="M18 576h14M25 569v14" stroke="#ff5fa2" strokeWidth="6" strokeLinecap="round" />
        </g>
      </svg>
      <div className="backdrop-body">{children}</div>
    </div>
  );
}

export function Pill({ tone, children, className }: { tone?: 'yellow' | 'pink' | 'teal' | 'blue' | 'ink'; children: ReactNode; className?: string }) {
  return <span className={cls('pill', tone && `pill-${tone}`, className)}>{children}</span>;
}

interface SegmentedOption<T> {
  value: T;
  label: string;
  sub?: string;
  disabled?: boolean;
}

export function Segmented<T extends string | number | boolean>({ options, value, onChange, disabled, label }: { options: SegmentedOption<T>[]; value: T; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled || o.disabled}
          className={cls('seg', o.value === value && 'is-on')}
          onClick={() => onChange(o.value)}
        >
          <b>{o.label}</b>
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}

/**
 * Une fenêtre, rendue à la racine du document pour ne dépendre d'aucun parent.
 * Elle s'ouvre avec un petit mouvement en CSS et se ferme d'un coup.
 */
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => box.current?.querySelector<HTMLElement>('[data-autofocus], .modal-body button, .modal-body input')?.focus({ preventScroll: true }), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
      before?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div ref={box} className={cls('modal', wide && 'is-wide')} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export const AVATAR_EMOJI: Record<string, string> = {
  flamant: '🦩',
  pasteque: '🍉',
  cactus: '🌵',
  licorne: '🦄',
  citron: '🍋',
  poulpe: '🐙',
  casque: '🎧',
  roller: '🛼',
  glace: '🍦',
  perroquet: '🦜',
  disco: '🪩',
  cerise: '🍒',
};

export const AVATAR_LABELS: Record<string, string> = {
  flamant: 'Flamant rose',
  pasteque: 'Pastèque',
  cactus: 'Cactus',
  licorne: 'Licorne',
  citron: 'Citron',
  poulpe: 'Poulpe',
  casque: 'Casque',
  roller: 'Roller',
  glace: 'Glace',
  perroquet: 'Perroquet',
  disco: 'Boule disco',
  cerise: 'Cerises',
};

export function Avatar({ avatar, className }: { avatar: string; className?: string }) {
  return (
    <span className={cls('avatar', className)} aria-hidden>
      {AVATAR_EMOJI[avatar] ?? '🦩'}
    </span>
  );
}

export function teamName(team: number): string {
  return `Équipe ${TEAM_NAMES[team] ?? team + 1}`;
}

export function TeamDot({ team }: { team: number | null }) {
  if (team === null) return null;
  return <span className={cls('team-dot', `is-team${team}`)} title={teamName(team)} aria-label={teamName(team)} />;
}
