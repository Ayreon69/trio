// La table : les joueurs assis en cercle (ta main en bas), les cartes du centre au milieu, et chaque carte révélée posée devant son propriétaire.
import confetti from 'canvas-confetti';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, ArrowUp, BookOpen, Bot, ChevronLeft, ChevronRight, Flag, LayoutGrid, LogOut, MoreHorizontal, Smile, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { EMOTES, TAUNTS, type End, type GameView, type PlayerView, type Reveal, type RoomView, type Source } from '../../../shared/protocol';
import { FlipCard, TrioCard } from '../components/Card';
import { Avatar, Button, Logo, Modal, TeamDot, teamName } from '../components/Ui';
import { sfx } from '../lib/sound';
import { capital, eventText, goalShort, listing, nameOf, winners } from '../lib/text';
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

/** Les cartes révélées ce tour-ci depuis la main d'un joueur, avec leur rang dans le tour. */
function frontReveals(g: GameView, id: string): { r: Reveal; i: number }[] {
  return g.reveals.map((r, i) => ({ r, i })).filter(({ r }) => r.src.kind === 'hand' && r.src.player === id);
}

/** L'élément où se trouve une carte révélée : son emplacement au centre, ou sa place devant son propriétaire. */
function revealSelector(r: Reveal, i: number): string {
  return r.src.kind === 'middle' ? `[data-src="m:${r.src.slot}"]` : `[data-rev="${i}"]`;
}

/** La place d'un adversaire autour de la table, toi en bas : le suivant à ta gauche, puis on tourne jusqu'à ta droite. */
type Pos = 'left' | 'top' | 'right';
function seatPlan(count: number): { pos: Pos; row: number }[] {
  // row : l'ordre d'affichage dans sa colonne (de haut en bas) ou sa rangée (de gauche à droite).
  if (count === 1) return [{ pos: 'top', row: 0 }];
  if (count === 2) return [{ pos: 'left', row: 0 }, { pos: 'right', row: 0 }];
  if (count === 3) return [{ pos: 'left', row: 0 }, { pos: 'top', row: 0 }, { pos: 'right', row: 0 }];
  if (count === 4) return [{ pos: 'left', row: 0 }, { pos: 'top', row: 0 }, { pos: 'top', row: 1 }, { pos: 'right', row: 0 }];
  if (count === 5) return [{ pos: 'left', row: 1 }, { pos: 'left', row: 0 }, { pos: 'top', row: 0 }, { pos: 'right', row: 0 }, { pos: 'right', row: 1 }];
  // Six : seulement pour qui regarde la partie sans y jouer.
  return [{ pos: 'left', row: 1 }, { pos: 'left', row: 0 }, { pos: 'top', row: 0 }, { pos: 'top', row: 1 }, { pos: 'right', row: 0 }, { pos: 'right', row: 1 }];
}

/**
 * Sons, vibrations et cartes qui volent : tout se déduit de l'état reçu.
 * Les positions des cartes révélées sont notées après chaque rendu : un trio qui quitte la table garde ainsi son point de départ.
 */
function useTableEffects(view: RoomView, setFlights: (f: (x: Flight[]) => Flight[]) => void) {
  const g = view.game!;
  const rects = useRef(new Map<number, DOMRect>());
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
    const motionOk = !reducedMotion();
    // Une nouvelle carte révélée : elle se retourne là où elle est, au centre ou devant son propriétaire.
    for (let i = before.reveals.length; i < g.reveals.length; i++) {
      window.setTimeout(() => sfx.flip(), 0);
      if (i === 1 && g.reveals[1].value === g.reveals[0].value) window.setTimeout(() => sfx.pair(), 260);
    }
    if (g.outcome && !before.outcome) {
      const mine = g.turnId === view.me;
      if (g.outcome.kind === 'miss') {
        window.setTimeout(() => sfx.miss(), 250);
        if (mine) vibrate([25, 50, 25]);
      } else {
        window.setTimeout(() => sfx.trio(), 200);
        vibrate(mine ? [30, 40, 70] : 25);
        const m = find('.status');
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
    // Un trio gagné : les trois cartes filent de là où elles étaient posées vers les trios de leur nouveau propriétaire.
    for (const e of fresh) {
      if (e.kind !== 'trio' || !e.by || !motionOk) continue;
      const to = find(`[data-trios="${e.by}"]`);
      for (let i = 0; i < 3; i++) {
        const from = rects.current.get(i);
        if (from && to) fly.push({ id: `t${e.id}-${i}`, value: e.value!, from, to: new DOMRect(to.left + to.width - 18, to.top, Math.min(to.height * 0.72, 26), Math.min(to.height, 36)), delay: i * 70 });
      }
    }
    if (fly.length) {
      setFlights((x) => [...x, ...fly]);
      const end = Math.max(...fly.map((f) => f.delay)) + 480;
      const ids = new Set(fly.map((f) => f.id));
      window.setTimeout(() => setFlights((x) => x.filter((f) => !ids.has(f.id))), end);
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

  // Puis noter où sont les cartes révélées pour le prochain coup.
  useLayoutEffect(() => {
    if (!g.reveals.length) return;
    rects.current.clear();
    g.reveals.forEach((r, i) => {
      const el = document.querySelector(revealSelector(r, i));
      if (el) rects.current.set(i, el.getBoundingClientRect());
    });
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

/** Le repère d'une demande : flèche vers le bas pour la plus petite carte, vers le haut pour la plus grande. */
function EndMark({ end, size = 12 }: { end: End; size?: number }) {
  return end === 'low' ? <ArrowDown size={size} strokeWidth={3} aria-hidden /> : <ArrowUp size={size} strokeWidth={3} aria-hidden />;
}

/** Les cartes qu'un joueur a dû montrer ce tour-ci, posées devant lui, chacune avec le repère de ce qui a été demandé. */
function Front({ view, owner, mine }: { view: RoomView; owner: string; mine?: boolean }) {
  const g = view.game!;
  const items = frontReveals(g, owner);
  const links = g.mode === 'piquant';
  const odd = g.outcome?.kind === 'miss' ? g.reveals.length - 1 : -1;
  return (
    <div className={cls('front', mine && 'is-mine', items.length > 0 && 'has-cards')} style={{ '--k': items.length } as CSSProperties}>
      {items.map(({ r, i }) => {
        const end = r.src.kind === 'hand' ? r.src.end : 'low';
        const label = `${end === 'low' ? 'Plus petite' : 'Plus grande'} carte ${mine ? 'de ta main' : `de ${nameOf(view, owner)}`} : ${r.value}`;
        return (
          <span key={`${i}:${r.value}:${end}`} className={cls('front-card', i === odd && 'is-odd')} data-rev={i} role="img" aria-label={label}>
            <span className={cls('end-tag', `is-${end}`)}>
              <EndMark end={end} size={12} />
            </span>
            <TrioCard value={r.value} links={links} />
          </span>
        );
      })}
    </div>
  );
}

/** Un adversaire : son nom, ses trios, sa main face cachée, et deux grandes touches « petite » / « grande » quand c'est à toi. */
function Seat({ view, p, pos, row, order, canAsk, onAsk, emotes, partner }: { view: RoomView; p: PlayerView; pos: Pos; row: number; order: number; canAsk: boolean; onAsk: (id: string, end: End) => void; emotes: Emote[]; partner: boolean }) {
  const g = view.game!;
  const isTurn = g.turnId === p.id && g.stage !== 'over';
  const count = p.hand ?? 0;
  const live = canAsk && count > 0;
  let status: string | null = null;
  if (p.swapping) status = 'choisit…';
  else if (isTurn) status = g.stage === 'resolve' ? null : 'joue';
  return (
    <div className={cls('place', `is-${pos}`)} style={{ '--row': row, '--order': order } as CSSProperties}>
      <div className={cls('seat', isTurn && 'is-turn', live && 'is-live', partner && 'is-partner', p.team !== null && `is-team${p.team}`, !p.connected && 'is-off')}>
        <div className="seat-head">
          <span className="seat-avatar">
            <Avatar avatar={p.avatar} />
            <Bubbles emotes={emotes} />
          </span>
          <span className="seat-name">{p.name}</span>
          <TeamDot team={p.team} />
          <TrioChips trios={p.trios} id={p.id} />
        </div>
        <div className="seat-hand" style={{ '--n': count } as CSSProperties}>
          <div className="fan">
            {Array.from({ length: count }, (_, i) => (
              <span key={`b${i}`} className="fan-card">
                <TrioCard mini />
              </span>
            ))}
            {count === 0 && <span className="fan-empty">plus de cartes</span>}
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
      <Front view={view} owner={p.id} />
    </div>
  );
}

/** Le centre : des emplacements fixes sur deux rangées, pour qu'on se souvienne de chaque carte par sa place. */
function Middle({ g, canPick, links, onPick }: { g: GameView; canPick: boolean; links: boolean; onPick: (slot: number) => void }) {
  const n = g.middle.length;
  const odd = g.outcome?.kind === 'miss' ? g.reveals[g.reveals.length - 1]?.src : undefined;
  const oddSlot = odd?.kind === 'middle' ? odd.slot : -1;
  return (
    <div className="middle" style={{ '--per-row': n <= 6 ? n : Math.ceil(n / 2), '--per-row-2': n <= 3 ? n : Math.ceil(n / 2) } as CSSProperties} aria-label="Les cartes du centre">
      {g.middle.map((s, i) =>
        s === null ? (
          <span key={i} className="slot is-gone" aria-hidden />
        ) : (
          <button
            key={i}
            type="button"
            className={cls('slot', canPick && s === 'hidden' && 'is-live', s !== 'hidden' && 'is-up', i === oddSlot && 'is-odd')}
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

/** Ce que dit le panneau du centre : où en est le trio, et quoi faire. */
function statusText(view: RoomView): { title: string; sub: string | null } {
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

/** La demande en cours, en grand : la plus petite ou la plus grande carte de qui, ou une carte du centre. Rien d'autre (pas d'historique). */
function AskNow({ view, src }: { view: RoomView; src: Source }) {
  if (src.kind === 'middle')
    return (
      <span className="ask-now is-middle">
        <LayoutGrid size={18} strokeWidth={2.6} aria-hidden />
        <span>
          <b>une carte</b>
          <small>du centre</small>
        </span>
      </span>
    );
  const me = src.player === view.me;
  return (
    <span className={cls('ask-now', `is-${src.end}`)}>
      <EndMark end={src.end} size={20} />
      <span>
        <b>{me ? 'ta ' : 'la '}plus {src.end === 'low' ? 'petite' : 'grande'}</b>
        {!me && <small>de {nameOf(view, src.player)}</small>}
      </span>
    </span>
  );
}

/** Le panneau du centre : la demande en cours, où en est le trio, et le chrono. */
function Status({ view, now }: { view: RoomView; now: number }) {
  const g = view.game!;
  const t = statusText(view);
  const out = g.outcome;
  const last = g.stage === 'play' || g.stage === 'resolve' ? g.reveals[g.reveals.length - 1] : undefined;
  return (
    <div className={cls('status', out && `is-${out.kind}`, g.turnId === view.me && g.stage === 'play' && 'is-mine', last && 'has-ask')} role="status" aria-live="polite">
      <News view={view} now={now} />
      {/* Une nouvelle demande remplace la précédente d'un coup : rien ne reste de la demande d'avant. */}
      {last && (
        <motion.span key={g.reveals.length} className="ask-now-wrap" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 22 }}>
          <AskNow view={view} src={last.src} />
        </motion.span>
      )}
      <div className="status-text">
        <b>{t.title}</b>
        {t.sub && <span>{t.sub}</span>}
      </div>
      <AnimatePresence>
        {out && (
          <motion.span key={out.kind} className={cls('stamp', `is-${out.kind}`)} initial={{ scale: 2.2, opacity: 0, rotate: -18 }} animate={{ scale: 1, opacity: 1, rotate: -10 }} exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.15 } }} transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.25 }}>
            {out.kind === 'miss' ? 'Raté' : 'Trio !'}
          </motion.span>
        )}
      </AnimatePresence>
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
  end: End | null;
}

/** Ta main, dans l'ordre. Les cartes que tu as dû montrer ce tour-ci n'y sont plus : elles sont posées devant toi. */
function handCards(g: GameView): HandCard[] {
  const hand = g.hand ?? [];
  const seen = new Map<number, number>();
  return hand.map((v, i) => {
    const k = seen.get(v) ?? 0;
    seen.set(v, k + 1);
    return { value: v, end: i === 0 ? 'low' : i === hand.length - 1 ? 'high' : null, key: v + '#' + k };
  });
}

/** Ta main : en jeu, ses deux bouts se touchent ; pendant un échange, chaque carte se choisit. */
function MyHand({ view, canReveal, choosing, gift, got, links, onEnd, onGift }: { view: RoomView; canReveal: boolean; choosing: boolean; gift: number | null; got: number | null; links: boolean; onEnd: (end: End) => void; onGift: (v: number) => void }) {
  const g = view.game!;
  const cards = handCards(g);
  const hand = g.hand ?? [];
  const single = hand.length === 1;
  let gotShown = false;
  return (
    <div className={cls('my-hand', choosing && 'is-choosing')} style={{ '--n': Math.max(1, cards.length) } as CSSProperties} aria-label="Ta main">
      {cards.length === 0 && <span className="hand-empty">Tu n'as plus de cartes en main : joue avec celles des autres et du centre.</span>}
      <AnimatePresence initial={false} mode="popLayout">
        {cards.map((c) => {
          const liveEnd = canReveal && c.end !== null;
          const isGot = got !== null && c.value === got && !gotShown;
          if (isGot) gotShown = true;
          const selected = choosing && gift === c.value;
          const clickable = liveEnd || choosing;
          const label = liveEnd ? (single ? 'Révéler ta dernière carte' : c.end === 'low' ? `Révéler ta plus petite carte (${c.value})` : `Révéler ta plus grande carte (${c.value})`) : choosing ? `Donner ton ${c.value}` : `Ton ${c.value}`;
          return (
            <motion.button
              key={c.key}
              layout
              type="button"
              className={cls('hand-card', liveEnd && 'is-live', selected && 'is-selected', isGot && 'is-got')}
              disabled={!clickable}
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -40, opacity: 0, transition: { duration: 0.25 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              onClick={() => (choosing ? onGift(c.value) : c.end && onEnd(single ? 'low' : c.end))}
              aria-label={label}
            >
              {/* framer-motion pilote le transform du bouton : le soulèvement se fait sur l'enveloppe intérieure. */}
              <span className="hand-lift">
                <TrioCard value={c.value} links={links} />
                {liveEnd && <span className={cls('hand-tag', !single && c.end === 'low' && 'is-low')}>{single ? 'la seule' : c.end === 'low' ? 'ta petite' : 'ta grande'}</span>}
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
  const now = useTick(300);
  const g = view.game!;
  useTableEffects(view, setFlights);

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
  const plan = seatPlan(others.length);
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
    <div className={cls('table-screen', `is-${n}p`, myTurn && 'is-my-turn', g.middle.length === 0 && 'no-middle', !plan.some((x) => x.pos === 'top') && 'no-top', g.stage === 'swap' && 'is-swap')}>
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

      {/* Sur grand écran, trois groupes autour du centre (gauche, en face, droite) ; sur téléphone, une simple grille dans l'ordre du jeu. */}
      <section className={cls('seats', `has-${others.length}`)} aria-label="Les autres joueurs">
        {(['left', 'top', 'right'] as const).map((side) => (
          <div key={side} className={cls('side', `is-${side}`)}>
            {others
              .map((o, k) => ({ o, k, ...plan[k] }))
              .filter((x) => x.pos === side)
              .sort((a, b) => a.row - b.row)
              .map(({ o, k, pos, row }) => (
                <Seat key={o.id} view={view} p={o} pos={pos} row={row} order={k} canAsk={canAct} onAsk={(player, end) => reveal({ kind: 'hand', player, end })} emotes={emotes.filter((e) => e.playerId === o.id)} partner={o.id === partner} />
              ))}
          </div>
        ))}
      </section>

      <section className="center">
        {g.middle.length > 0 && <Middle g={g} canPick={canAct} links={links} onPick={(slot) => reveal({ kind: 'middle', slot })} />}
        <Status view={view} now={now} />
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
            <div className="me-row">
              <Front view={view} owner={view.me} mine />
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
            </div>
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

