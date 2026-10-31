// La table : les mains des autres en haut, le centre et le trio en cours au milieu, ta main en grand en bas.
import confetti from 'canvas-confetti';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Bot, ChevronLeft, ChevronRight, Flag, LogOut, MoreHorizontal, Smile, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { EMOTES, TAUNTS, type End, type GameView, type PlayerView, type Reveal, type RoomView, type Source } from '../../../shared/protocol';
import { FlipCard, TrioCard } from '../components/Card';
import { Avatar, Button, Logo, Modal, TeamDot, teamName } from '../components/Ui';
import { sfx } from '../lib/sound';
import { capital, eventText, goalShort, listing, nameOf, sourceText, winners } from '../lib/text';
import { cls, reducedMotion, useTick, vibrate } from '../lib/util';
import { leaveRoom, send, socket } from '../net';
import { useStore, type Emote } from '../store';

interface Flight {
  id: string;
  value: number;
  from: DOMRect;
  to: DOMRect;
  delay: number;
}

function TurnTimer({ endsAt, think }: { endsAt: number; think: number }) {
  const now = useTick(250);
  if (!endsAt || !think) return null;
  const left = Math.max(0, endsAt - now);
  return (
    <span className={cls('turn-timer', left < 6000 && 'is-low')} role="timer" aria-label={`${Math.ceil(left / 1000)} secondes`}>
      <span style={{ width: `${Math.min(100, (left / (think * 1000)) * 100)}%` }} />
    </span>
  );
}

/** Les cartes révélées depuis une main : celles du bas et celles du haut, dans l'ordre où elles sont sorties. */
function handReveals(g: GameView, id: string): { lows: Reveal[]; highs: Reveal[] } {
  const mine = g.reveals.filter((r) => r.src.kind === 'hand' && r.src.player === id);
  return { lows: mine.filter((r) => r.src.kind === 'hand' && r.src.end === 'low'), highs: mine.filter((r) => r.src.kind === 'hand' && r.src.end === 'high') };
}

/** L'élément d'où sort une carte révélée : un emplacement du centre, ou le bout d'une main. */
function sourceKey(g: GameView, index: number): string {
  const r = g.reveals[index];
  if (r.src.kind === 'middle') return `m:${r.src.slot}`;
  const src = r.src;
  const k = g.reveals.slice(0, index).filter((x) => x.src.kind === 'hand' && x.src.player === src.player && x.src.end === src.end).length;
  return `${src.player}:${src.end}:${k}`;
}

/**
 * Sons, vibrations et cartes qui volent : tout se déduit de l'état reçu.
 * Les positions sont notées après chaque rendu : un trio qui quitte la table garde ainsi son point de départ.
 */
function useTableEffects(view: RoomView, setFlights: (f: (x: Flight[]) => Flight[]) => void, setLanding: (f: (x: Set<string>) => Set<string>) => void) {
  const g = view.game!;
  const rects = useRef(new Map<string, DOMRect>());
  const prev = useRef<{ reveals: Reveal[]; outcome: GameView['outcome']; turnId: string | null; seq: number; stage: string } | null>(null);
  const seenEvents = useRef(-1);
  const note = useRef<number>(0);

  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = { reveals: g.reveals, outcome: g.outcome, turnId: g.turnId, seq: g.seq, stage: g.stage };
    const fresh = g.events.filter((e) => e.id > seenEvents.current);
    seenEvents.current = Math.max(seenEvents.current, 0, ...g.events.map((e) => e.id));
    if (!before) return;
    const find = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
    const fly: Flight[] = [];
    const land = new Set<string>();
    const motionOk = !reducedMotion();
    // Une nouvelle carte révélée : elle se retourne sur place, et sa copie file vers la jauge du trio.
    for (let i = before.reveals.length; i < g.reveals.length; i++) {
      const r = g.reveals[i];
      window.setTimeout(() => sfx.flip(), 0);
      if (i >= 1 && r.value === g.reveals[0].value && i === 1) window.setTimeout(() => sfx.pair(), 260);
      const from = find(`[data-src="${sourceKey(g, i)}"]`);
      const to = find(`[data-meter="${i}"]`);
      if (from && to && motionOk) {
        fly.push({ id: `r${g.seq}-${i}`, value: r.value, from, to, delay: 0 });
        land.add(`meter:${i}`);
      }
    }
    if (g.outcome && !before.outcome) {
      const mine = g.turnId === view.me;
      if (g.outcome.kind === 'miss') {
        window.setTimeout(() => sfx.miss(), 250);
        if (mine) vibrate([25, 50, 25]);
      } else {
        window.setTimeout(() => sfx.trio(), 200);
        vibrate(mine ? [30, 40, 70] : 25);
        const m = find('.meter-slots');
        if (m && motionOk)
          window.setTimeout(
            () =>
              void confetti({
                particleCount: 60,
                spread: 70,
                startVelocity: 28,
                origin: { x: (m.left + m.width / 2) / window.innerWidth, y: (m.top + m.height / 2) / window.innerHeight },
                colors: ['#ff5fa2', '#ffd23f', '#19b3b1', '#4a6cff', '#1f1b2e'],
                scalar: 0.8,
                disableForReducedMotion: true,
              }),
            250,
          );
      }
    }
    // Un trio gagné : les trois cartes filent vers les trios de leur nouveau propriétaire.
    for (const e of fresh) {
      if (e.kind !== 'trio' || !e.by || !motionOk) continue;
      const to = find(`[data-trios="${e.by}"]`);
      for (let i = 0; i < 3; i++) {
        const from = rects.current.get(`meter:${i}`);
        if (from && to) fly.push({ id: `t${e.id}-${i}`, value: e.value!, from, to: new DOMRect(to.left + to.width - 18, to.top, Math.min(to.height * 0.72, 26), Math.min(to.height, 36)), delay: i * 70 });
      }
    }
    if (fly.length) {
      setFlights((x) => [...x, ...fly]);
      setLanding((x) => new Set([...x, ...land]));
      const end = Math.max(...fly.map((f) => f.delay)) + 480;
      const ids = new Set(fly.map((f) => f.id));
      window.setTimeout(() => {
        setFlights((x) => x.filter((f) => !ids.has(f.id)));
        setLanding((x) => {
          const next = new Set(x);
          for (const k of land) next.delete(k);
          return next;
        });
      }, end);
    }
    if (g.turnId === view.me && g.stage === 'play' && (before.turnId !== view.me || before.stage !== 'play') && g.reveals.length === 0) {
      sfx.turn();
      vibrate(30);
    }
    if (g.swapNote && g.swapNote.until !== note.current) {
      note.current = g.swapNote.until;
      sfx.swap();
    }
  });

  // Puis noter les positions actuelles pour le prochain coup.
  useLayoutEffect(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-meter]')) rects.current.set(`meter:${el.dataset.meter}`, el.getBoundingClientRect());
  });
}

function Flights({ flights }: { flights: Flight[] }) {
  return (
    <div className="flights" aria-hidden>
      {flights.map((f) => (
        <motion.div
          key={f.id}
          className="flight"
          style={{ width: f.to.width, height: f.to.height }}
          initial={{ x: f.from.left, y: f.from.top, scale: f.from.width / f.to.width }}
          animate={{ x: f.to.left, y: f.to.top, scale: 1 }}
          transition={{ duration: 0.42, delay: f.delay / 1000, ease: [0.3, 0.7, 0.4, 1] }}
        >
          <TrioCard value={f.value} />
        </motion.div>
      ))}
    </div>
  );
}

function ReactionTray({ onClose }: { onClose: () => void }) {
  const emit = (emoji: string) => {
    socket.emit('emote', { emoji });
    onClose();
  };
  return (
    <motion.div className="reactions" role="menu" aria-label="Réactions" initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
      <div className="reaction-emojis">
        {EMOTES.map((e) => (
          <button key={e} type="button" role="menuitem" onClick={() => emit(e)} aria-label={`Réaction ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <div className="reaction-taunts">
        {TAUNTS.map((t) => (
          <button key={t} type="button" role="menuitem" onClick={() => emit(t)}>
            {t}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function Bubbles({ emotes }: { emotes: Emote[] }) {
  return (
    <AnimatePresence>
      {emotes.slice(-1).map((e) => (
        <motion.span key={e.id} className={cls('bubble', e.emoji.length > 3 && 'is-text')} initial={{ scale: 0.4, y: 6, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ opacity: 0, y: -6 }}>
          {e.emoji}
        </motion.span>
      ))}
    </AnimatePresence>
  );
}

/** Les trios d'un joueur : de petites piles de trois cartes. */
function TrioChips({ trios, id }: { trios: number[]; id: string }) {
  return (
    <span className="trio-chips" data-trios={id}>
      {trios.map((t, i) => (
        <motion.span key={i} className="trio-chip" initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.35, type: 'spring', stiffness: 300, damping: 16 }} title={`Trio de ${t}`}>
          <TrioCard value={t} mini />
        </motion.span>
      ))}
    </span>
  );
}

/** Un adversaire : son nom, ses trios, sa main face cachée, et deux grandes touches « petite » / « grande » quand c'est à toi. */
function Seat({ view, p, canAsk, onAsk, emotes, partner }: { view: RoomView; p: PlayerView; canAsk: boolean; onAsk: (id: string, end: End) => void; emotes: Emote[]; partner: boolean }) {
  const g = view.game!;
  const isTurn = g.turnId === p.id && g.stage !== 'over';
  const { lows, highs } = handReveals(g, p.id);
  const count = p.hand ?? 0;
  const ref = useRef<HTMLDivElement>(null);
  // Quand la rangée défile, on garde en vue celui qui joue (sans faire bouger la page).
  useEffect(() => {
    const el = ref.current;
    const strip = el?.parentElement;
    if (!isTurn || !el || !strip || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({ left: el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [isTurn]);
  const live = canAsk && count > 0;
  let status: string | null = null;
  if (p.swapping) status = 'choisit…';
  else if (isTurn) status = g.stage === 'resolve' ? null : 'joue';
  return (
    <div ref={ref} className={cls('seat', isTurn && 'is-turn', live && 'is-live', partner && 'is-partner', p.team !== null && `is-team${p.team}`, !p.connected && 'is-off')}>
      <div className="seat-head">
        <span className="seat-avatar">
          <Avatar avatar={p.avatar} />
          <Bubbles emotes={emotes} />
        </span>
        <span className="seat-name">{p.name}</span>
        <TeamDot team={p.team} />
        <TrioChips trios={p.trios} id={p.id} />
      </div>
      <div className="seat-hand" style={{ '--n': count + lows.length + highs.length } as CSSProperties}>
        <div className="fan">
          {lows.map((r, i) => (
            <span key={`l${i}`} className="fan-card is-up" data-src={`${p.id}:low:${i}`}>
              <TrioCard value={r.value} mini />
            </span>
          ))}
          {Array.from({ length: count }, (_, i) => (
            <span key={`b${i}`} className="fan-card">
              <TrioCard mini />
            </span>
          ))}
          {[...highs].reverse().map((r, i) => (
            <span key={`h${highs.length - 1 - i}`} className="fan-card is-up" data-src={`${p.id}:high:${highs.length - 1 - i}`}>
              <TrioCard value={r.value} mini />
            </span>
          ))}
          {count + lows.length + highs.length === 0 && <span className="fan-empty">plus de cartes</span>}
        </div>
      </div>
      <div className="seat-foot">
        {p.autopilot ? (
          <span className="seat-auto">
            <Bot size={11} aria-hidden /> auto
          </span>
        ) : !p.connected ? (
          <span className="seat-auto">
            <WifiOff size={11} aria-hidden /> absent
          </span>
        ) : (
          status && <span className={cls('seat-state', isTurn && 'is-live')}>{status}</span>
        )}
        {partner && <span className="seat-partner">partenaire</span>}
        <span className="seat-count">
          {count} carte{count > 1 ? 's' : ''}
        </span>
      </div>
      {live && (
        <div className="ask">
          <button type="button" className="ask-btn is-low" onClick={() => onAsk(p.id, 'low')} aria-label={`Révéler la plus petite carte de ${p.name}`}>
            <span className="ask-pill">
              <ChevronLeft size={13} strokeWidth={3} aria-hidden /> petite
            </span>
          </button>
          <button type="button" className="ask-btn is-high" onClick={() => onAsk(p.id, 'high')} aria-label={`Révéler la plus grande carte de ${p.name}`}>
            <span className="ask-pill">
              grande <ChevronRight size={13} strokeWidth={3} aria-hidden />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Le centre : des emplacements fixes, pour qu'on se souvienne de chaque carte par sa place. */
function Middle({ g, canPick, links, onPick }: { g: GameView; canPick: boolean; links: boolean; onPick: (slot: number) => void }) {
  const n = g.middle.length;
  const perRow = n <= 6 ? n : Math.ceil(n / 2);
  return (
    <div className="middle" style={{ '--per-row': perRow, '--count': n } as CSSProperties} aria-label="Les cartes du centre">
      {g.middle.map((s, i) =>
        s === null ? (
          <span key={i} className="slot is-gone" aria-hidden />
        ) : (
          <button
            key={i}
            type="button"
            className={cls('slot', canPick && s === 'hidden' && 'is-live', s !== 'hidden' && 'is-up')}
            disabled={!canPick || s !== 'hidden'}
            onClick={() => onPick(i)}
            data-src={`m:${i}`}
            aria-label={s === 'hidden' ? `Retourner la carte ${i + 1} du centre` : `Carte ${s} du centre`}
          >
            <FlipCard value={s === 'hidden' ? null : s} links={links} />
          </button>
        ),
      )}
    </div>
  );
}

/** Ce que dit la jauge : où en est le trio, et quoi faire. */
function meterText(view: RoomView): { title: string; sub: string | null } {
  const g = view.game!;
  const n = g.reveals.length;
  const v = g.reveals[0]?.value;
  const mine = g.turnId === view.me;
  const who = capital(nameOf(view, g.turnId));
  const partnerOf = (id: string) => g.teams?.find((t) => t.includes(id))?.find((x) => x !== id);
  if (g.stage === 'over' && g.victory) {
    const w = winners(view, g.victory);
    return { title: g.victory.reason === 'seven' ? 'Le trio de 7 !' : 'Victoire !', sub: `${w.who} ${w.verb} la partie.` };
  }
  if (g.stage === 'swap' && g.swap) {
    const partner = partnerOf(view.me);
    if (g.swap.waiting.includes(view.me)) return { title: 'Échange secret', sub: `Choisis une carte à donner à ${nameOf(view, partner)}, ou passe.` };
    if (partner && g.swap.waiting.includes(partner)) return { title: 'Échange secret', sub: `En attente de ${nameOf(view, partner)}…` };
    const names = g.swap.waiting.map((id) => nameOf(view, id));
    return { title: 'Échange secret', sub: names.length ? `${capital(listing(names))} ${names.length > 1 ? 'choisissent' : 'choisit'} une carte…` : null };
  }
  if (g.stage === 'resolve' && g.outcome) {
    if (g.outcome.kind === 'miss') return { title: 'Raté !', sub: 'Retiens bien ces cartes : elles retournent à leur place.' };
    return { title: mine ? `Trio de ${g.outcome.value} !` : `${who} : trio de ${g.outcome.value} !`, sub: mine ? 'Bien joué !' : null };
  }
  if (mine) {
    if (n === 0) return { title: 'À toi !', sub: 'Révèle la plus petite ou la plus grande carte d’un joueur (toi compris), ou une carte du centre.' };
    if (n === 1) return { title: `Un ${v} !`, sub: `Trouve un autre ${v}.` };
    return { title: `Deux ${v} !`, sub: `Encore un ${v} pour le trio.` };
  }
  const auto = view.players.find((p) => p.id === g.turnId)?.autopilot;
  if (n === 0) return { title: `Au tour de ${nameOf(view, g.turnId)}`, sub: auto ? 'Pilote automatique' : null };
  if (n === 1) return { title: `${who} révèle un ${v}…`, sub: null };
  return { title: `${who} a deux ${v}…`, sub: 'Encore un pour le trio !' };
}

/** La jauge du trio en cours : trois cases qui se remplissent, au centre de la table. */
function Meter({ view, landing }: { view: RoomView; landing: Set<string> }) {
  const g = view.game!;
  const t = meterText(view);
  const links = g.mode === 'piquant';
  const out = g.outcome;
  return (
    <div className={cls('meter', out && `is-${out.kind}`, g.turnId === view.me && g.stage === 'play' && 'is-mine')} role="status" aria-live="polite">
      <div className="meter-slots">
        {[0, 1, 2].map((i) => {
          const r = g.reveals[i];
          const odd = !!r && out?.kind === 'miss' && i === g.reveals.length - 1;
          return (
            <div key={i} className={cls('meter-slot', r ? 'is-filled' : 'is-empty', odd && 'is-odd')} data-meter={i}>
              {r ? (
                <>
                  <span className={cls('meter-card', landing.has(`meter:${i}`) && 'is-landing')}>
                    <TrioCard value={r.value} links={links} />
                  </span>
                  <span className="meter-src">{sourceText(view, r.src)}</span>
                </>
              ) : (
                <span className="meter-hole">?</span>
              )}
            </div>
          );
        })}
        <AnimatePresence>
          {out && (
            <motion.span key={out.kind} className={cls('stamp', `is-${out.kind}`)} initial={{ scale: 2.2, opacity: 0, rotate: -18 }} animate={{ scale: 1, opacity: 1, rotate: -10 }} exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.15 } }} transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.25 }}>
              {out.kind === 'miss' ? 'Raté' : 'Trio !'}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="meter-text">
        <b>{t.title}</b>
        {t.sub && <span>{t.sub}</span>}
      </div>
      {g.stage === 'play' && <TurnTimer endsAt={g.turnEndsAt} think={view.settings.think} />}
    </div>
  );
}

/** La dernière nouvelle de la table, le temps de la lire. */
function News({ view, now }: { view: RoomView; now: number }) {
  const g = view.game!;
  const live = g.events.filter((e) => e.until > now && eventText(view, e));
  const e = live[live.length - 1];
  return (
    <div className="news" role="status" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {e && (
          <motion.span key={e.id} className={cls('news-pill', e.kind === 'trio' && 'is-trio')} initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {eventText(view, e)}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

interface HandCard {
  key: string;
  value: number;
  up: boolean;
  end: End | null;
  src: string | null;
}

/** Ta main entière, dans l'ordre : les cartes révélées ce tour-ci restent à leur place, levées et visibles de tous. */
function handCards(g: GameView, me: string): HandCard[] {
  const { lows, highs } = handReveals(g, me);
  const hand = g.hand ?? [];
  const list: Omit<HandCard, 'key'>[] = [
    ...lows.map((r, i) => ({ value: r.value, up: true, end: null, src: `${me}:low:${i}` })),
    ...hand.map((v, i) => ({ value: v, up: false, end: (i === 0 ? 'low' : i === hand.length - 1 ? 'high' : null) as End | null, src: null })),
    ...[...highs].reverse().map((r, i) => ({ value: r.value, up: true, end: null, src: `${me}:high:${highs.length - 1 - i}` })),
  ];
  const seen = new Map<number, number>();
  return list.map((c) => {
    const k = seen.get(c.value) ?? 0;
    seen.set(c.value, k + 1);
    return { ...c, key: `${c.value}#${k}` };
  });
}

/** Ta main : en jeu, ses deux bouts se touchent ; pendant un échange, chaque carte se choisit. */
function MyHand({ view, canReveal, choosing, gift, got, links, onEnd, onGift }: { view: RoomView; canReveal: boolean; choosing: boolean; gift: number | null; got: number | null; links: boolean; onEnd: (end: End) => void; onGift: (v: number) => void }) {
  const g = view.game!;
  const cards = handCards(g, view.me);
  const hand = g.hand ?? [];
  const single = hand.length === 1;
  let gotShown = false;
  return (
    <div className={cls('my-hand', choosing && 'is-choosing')} style={{ '--n': Math.max(1, cards.length) } as CSSProperties} aria-label="Ta main">
      {cards.length === 0 && <span className="hand-empty">Tu n'as plus de cartes en main : joue avec celles des autres et du centre.</span>}
      <AnimatePresence initial={false} mode="popLayout">
        {cards.map((c) => {
          const liveEnd = canReveal && c.end !== null;
          const isGot = got !== null && c.value === got && !gotShown && !c.up;
          if (isGot) gotShown = true;
          const selected = choosing && gift === c.value && !c.up;
          const clickable = liveEnd || (choosing && !c.up);
          const label = liveEnd ? (single ? 'Révéler ta dernière carte' : c.end === 'low' ? `Révéler ta plus petite carte (${c.value})` : `Révéler ta plus grande carte (${c.value})`) : choosing ? `Donner ton ${c.value}` : `Ton ${c.value}`;
          return (
            <motion.button
              key={c.key}
              layout
              type="button"
              className={cls('hand-card', c.up && 'is-up', liveEnd && 'is-live', selected && 'is-selected', isGot && 'is-got')}
              disabled={!clickable}
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -40, opacity: 0, transition: { duration: 0.25 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              onClick={() => (choosing ? onGift(c.value) : c.end && onEnd(single ? 'low' : c.end))}
              aria-label={label}
              data-src={c.src ?? undefined}
            >
              {/* framer-motion pilote le transform du bouton : le soulèvement se fait sur l'enveloppe intérieure. */}
              <span className="hand-lift">
                <TrioCard value={c.value} links={links} />
                {liveEnd && <span className="hand-tag">{single ? 'la seule' : c.end === 'low' ? 'ta petite' : 'ta grande'}</span>}
                {c.up && <span className="hand-tag is-shown">montrée</span>}
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function Table({ view }: { view: RoomView }) {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const emotes = useStore((s) => s.emotes);
  const [menu, setMenu] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [react, setReact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gift, setGift] = useState<number | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [landing, setLanding] = useState<Set<string>>(() => new Set());
  const now = useTick(300);
  const g = view.game!;
  useTableEffects(view, setFlights, setLanding);

  const me = view.players.find((p) => p.id === view.me);
  const seated = g.order.includes(view.me);
  const myTurn = seated && g.stage === 'play' && g.turnId === view.me;
  const canAct = myTurn && !busy;
  const isHost = view.hostId === view.me;
  const n = g.order.length;
  const links = g.mode === 'piquant';
  // On tourne la table : d'abord celui qui joue juste après toi.
  const start = seated ? g.order.indexOf(view.me) + 1 : 0;
  const others = Array.from({ length: seated ? n - 1 : n }, (_, i) => view.players.find((p) => p.id === g.order[(start + i) % n])!).filter(Boolean);
  const partner = g.teams?.find((t) => t.includes(view.me))?.find((x) => x !== view.me) ?? null;
  const choosing = seated && g.stage === 'swap' && !!g.swap?.waiting.includes(view.me);

  // Le choix de carte à donner s'efface quand l'échange se termine.
  useEffect(() => {
    if (!choosing) setGift(null);
  }, [choosing]);

  const act = useCallback(async (event: string, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    await send(event, payload);
    setBusy(false);
  }, []);

  const reveal = (src: Source) => {
    if (!canAct) return;
    sfx.tap();
    void act('game:reveal', { src, seq: g.seq });
  };

  const note = g.swapNote;
  const team = me && seated ? (g.teams?.findIndex((t) => t.includes(view.me)) ?? -1) : -1;
  const myTrios = me?.trios ?? [];
  const teamTrios = partner ? [...myTrios, ...(view.players.find((p) => p.id === partner)?.trios ?? [])] : myTrios;

  return (
    <div className={cls('table-screen', `is-${n}p`, myTurn && 'is-my-turn', g.middle.length === 0 && 'no-middle', g.stage === 'swap' && 'is-swap')}>
      <div className="table-bg" aria-hidden />
      <header className="table-top">
        <span className="table-logo">
          <Logo size="sm" />
        </span>
        <span className="goal-chip">
          <b>{g.mode === 'simple' ? 'Simple' : 'Piquant'}</b>
          <small>{goalShort(g.mode)}</small>
        </span>
        <div className="table-tools">
          <button type="button" className={cls('icon-btn', react && 'is-on')} aria-label="Réagir" aria-expanded={react} onClick={() => setReact((x) => !x)}>
            <Smile size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label="Menu" onClick={() => setMenu(true)}>
            <MoreHorizontal size={20} />
          </button>
        </div>
        {react && <ReactionTray onClose={() => setReact(false)} />}
      </header>

      <section className={cls('seats', `has-${others.length}`)} aria-label="Les autres joueurs">
        {others.map((o) => (
          <Seat key={o.id} view={view} p={o} canAsk={canAct} onAsk={(player, end) => reveal({ kind: 'hand', player, end })} emotes={emotes.filter((e) => e.playerId === o.id)} partner={o.id === partner} />
        ))}
      </section>

      <section className="center">
        <News view={view} now={now} />
        {g.middle.length > 0 && <Middle g={g} canPick={canAct} links={links} onPick={(slot) => reveal({ kind: 'middle', slot })} />}
        <Meter view={view} landing={landing} />
      </section>

      <section className={cls('me-zone', myTurn && 'is-turn', choosing && 'is-choosing')}>
        {seated && me ? (
          <>
            <AnimatePresence>
              {note && (
                <motion.div key={note.until} className="swap-note" role="status" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}>
                  {note.gave !== null && note.got !== null ? (
                    <>
                      Tu as donné ton <b>{note.gave}</b> à {nameOf(view, note.partner)} et reçu un <b>{note.got}</b>.
                    </>
                  ) : (
                    <>Pas d'échange avec {nameOf(view, note.partner)} cette fois.</>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            {choosing && (
              <div className="swap-bar">
                <Button variant="primary" disabled={gift === null || busy} onClick={() => gift !== null && void act('game:swap', { card: gift })}>
                  {gift === null ? 'Touche la carte à donner' : `Donner mon ${gift} à ${nameOf(view, partner)}`}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void act('game:swap', { card: 'pass' })}>
                  Ne pas échanger
                </Button>
              </div>
            )}
            <MyHand
              view={view}
              canReveal={canAct && (g.hand?.length ?? 0) > 0}
              choosing={choosing}
              gift={gift}
              got={note?.got ?? null}
              links={links}
              onEnd={(end) => reveal({ kind: 'hand', player: view.me, end })}
              onGift={(v) => {
                sfx.tap();
                setGift((x) => (x === v ? null : v));
              }}
            />
            <div className="me-foot">
              <span className="me-avatar">
                <Avatar avatar={me.avatar} />
                <Bubbles emotes={emotes.filter((e) => e.playerId === view.me)} />
              </span>
              <span className="me-name">{me.name}</span>
              {team >= 0 && (
                <span className="me-team">
                  <TeamDot team={team} /> {partner ? `avec ${nameOf(view, partner)}` : teamName(team)}
                </span>
              )}
              <span className="me-trios">
                <TrioChips trios={myTrios} id={view.me} />
                {myTrios.length === 0 && <small className="muted">{partner && teamTrios.length ? `équipe : ${teamTrios.length} trio${teamTrios.length > 1 ? 's' : ''}` : 'aucun trio'}</small>}
              </span>
            </div>
          </>
        ) : (
          <p className="me-off">Tu regardes la partie : tu joueras à la prochaine.</p>
        )}
      </section>

      <Flights flights={flights} />

      <AnimatePresence>
        {g.stage === 'over' && g.victory && (
          <motion.div className="victory" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="victory-card" initial={{ scale: 0.6, rotate: -8 }} animate={{ scale: 1, rotate: -3 }} transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.5 }}>
              <span className="eyebrow">{g.victory.reason === 'seven' ? 'Le trio de 7 !' : g.victory.reason === 'three' ? 'Troisième trio !' : 'Deux trios liés !'}</span>
              <b>
                {winners(view, g.victory).who} {winners(view, g.victory).verb} !
              </b>
              <span className="victory-trios">
                {g.victory.values.map((v, i) => (
                  <span key={i} className="trio-stack">
                    {[0, 1, 2].map((k) => (
                      <TrioCard key={k} value={v} />
                    ))}
                  </span>
                ))}
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal
        open={menu}
        onClose={() => {
          setMenu(false);
          setConfirmStop(false);
        }}
        title="Menu"
      >
        <div className="menu-list">
          <Button icon={prefs.sound ? <Volume2 size={18} /> : <VolumeX size={18} />} onClick={() => setPrefs({ sound: !prefs.sound })}>
            Son : {prefs.sound ? 'activé' : 'coupé'}
          </Button>
          <Button
            icon={<BookOpen size={18} />}
            onClick={() => {
              setMenu(false);
              setRulesOpen(true);
            }}
          >
            Les règles
          </Button>
          {isHost && (
            <Button
              variant="danger"
              icon={<Flag size={18} />}
              onClick={() => {
                // Deux appuis : un geste malheureux ne doit pas couper la partie de toute la table.
                if (!confirmStop) {
                  setConfirmStop(true);
                  return;
                }
                setConfirmStop(false);
                setMenu(false);
                void send('game:end');
              }}
            >
              {confirmStop ? 'Confirmer : arrêter pour tout le monde' : 'Arrêter la partie'}
            </Button>
          )}
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter la table
          </Button>
        </div>
      </Modal>
    </div>
  );
}

