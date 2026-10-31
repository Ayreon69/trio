// Le moteur d'une partie de Trio : donne, cartes révélées, trios, échanges entre partenaires et victoire.
import crypto from 'node:crypto';
import {
  COPIES,
  DEAL,
  SEVEN,
  TEAM_DEAL,
  VALUES,
  areLinked,
  parseSource,
  type GameEvent,
  type Mode,
  type Outcome,
  type Reveal,
  type Stage,
  type Victory,
} from '../shared/protocol';

export interface GameOptions {
  mode: Mode;
  /** Les équipes de deux (null en solo). L'ordre de jeu doit déjà asseoir les partenaires face à face. */
  teams?: string[][] | null;
  /** Durée d'affichage d'un événement. */
  eventMs?: number;
  /** Mélange des cartes (remplaçable dans les tests pour fixer la donne). */
  shuffle?: (cards: number[]) => number[];
  /** Premier joueur (index dans l'ordre de jeu), tiré au sort sinon. */
  first?: number;
}

export interface SwapState {
  teams: Set<number>;
  /** La carte choisie par chacun, ou 'pass'. Personne d'autre ne la voit. */
  choices: Map<string, number | 'pass'>;
  /** Les équipes dont l'échange est réglé. */
  done: Set<number>;
  reason: 'start' | 'trio';
}

/** Un échange réglé entre deux partenaires : ce que chacun a donné (null s'il n'y a pas eu d'échange). */
export interface SwapResult {
  team: number;
  ids: [string, string];
  gave: [number | null, number | null];
}

export function freshDeck(): number[] {
  const cards: number[] = [];
  for (const v of VALUES) for (let i = 0; i < COPIES; i++) cards.push(v);
  return cards;
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Range une carte à sa place dans une main triée. */
export function insertSorted(hand: number[], value: number): void {
  let i = 0;
  while (i < hand.length && hand[i] < value) i++;
  hand.splice(i, 0, value);
}

export class Game {
  readonly order: string[];
  readonly mode: Mode;
  readonly teams: string[][] | null;
  readonly teamOf = new Map<string, number>();
  /** Les mains, triées, sans les cartes révélées ce tour-ci. */
  hands = new Map<string, number[]>();
  /** Le centre : des emplacements fixes, null quand la carte est partie dans un trio. */
  middle: (number | null)[] = [];
  /** Les emplacements du centre retournés ce tour-ci. */
  up = new Set<number>();
  reveals: Reveal[] = [];
  trios = new Map<string, number[]>();
  stage: Stage = 'play';
  turn = 0;
  seq = 0;
  turns = 0;
  outcome: Outcome | null = null;
  victory: Victory | null = null;
  swap: SwapState | null = null;
  /** Les échanges réglés depuis la dernière lecture (pour la mémoire des bots et la note de chacun). */
  swaps: SwapResult[] = [];
  events: GameEvent[] = [];
  private eventId = 0;
  private readonly eventMs: number;

  constructor(order: string[], opts: GameOptions) {
    this.order = [...order];
    this.mode = opts.mode;
    this.teams = opts.teams?.length ? opts.teams.map((t) => [...t]) : null;
    this.eventMs = opts.eventMs ?? 3200;
    this.teams?.forEach((t, i) => t.forEach((id) => this.teamOf.set(id, i)));
    const n = order.length;
    const deal = (this.teams ? TEAM_DEAL : DEAL)[n];
    if (!deal) throw new Error(`Trio se joue à ${this.teams ? '4 ou 6 en équipes' : '3 à 6'}, pas à ${n}.`);
    const deck = (opts.shuffle ?? shuffle)(freshDeck());
    for (const id of order) {
      this.hands.set(id, deck.splice(0, deal.hand).sort((a, b) => a - b));
      this.trios.set(id, []);
    }
    this.middle = deck.splice(0, deal.middle);
    this.turn = opts.first ?? crypto.randomInt(n);
    if (this.teams) this.startSwap(this.teams.map((_, i) => i), 'start');
    else this.push('start', { by: this.order[this.turn] });
  }

  get current(): string | null {
    return this.stage === 'play' || this.stage === 'resolve' ? this.order[this.turn] : null;
  }

  hand(id: string): number[] {
    return this.hands.get(id) ?? [];
  }

  /** Les partenaires d'un joueur, lui compris (lui seul en solo). */
  group(id: string): string[] {
    const t = this.teamOf.get(id);
    return t === undefined || !this.teams ? [id] : this.teams[t];
  }

  /** Les trios d'un joueur et de son partenaire. */
  groupTrios(id: string): number[] {
    return this.group(id).flatMap((p) => this.trios.get(p) ?? []);
  }

  private push(kind: GameEvent['kind'], data: Partial<GameEvent> = {}): void {
    const now = Date.now();
    this.events = this.events.filter((e) => e.until > now);
    this.events.push({ id: ++this.eventId, at: now, until: now + this.eventMs, kind, ...data });
    if (this.events.length > 4) this.events.shift();
  }

  // ───────────────────────────── Le tour ─────────────────────────────

  /** Révéler une carte : au centre, ou la plus petite / la plus grande de la main d'un joueur (soi compris). */
  reveal(by: string, raw: unknown): string | undefined {
    if (this.stage !== 'play') return "Ce n'est pas le moment de révéler une carte.";
    if (this.current !== by) return "Ce n'est pas ton tour.";
    const src = parseSource(raw);
    if (!src) return 'Carte inconnue.';
    let value: number;
    if (src.kind === 'middle') {
      const v = this.middle[src.slot];
      if (v === undefined || v === null) return "Il n'y a plus de carte à cet endroit.";
      if (this.up.has(src.slot)) return 'Cette carte est déjà retournée.';
      this.up.add(src.slot);
      value = v;
    } else {
      const hand = this.hands.get(src.player);
      if (!hand) return 'Joueur inconnu.';
      if (!hand.length) return src.player === by ? "Tu n'as plus de carte en main." : "Ce joueur n'a plus de carte en main.";
      value = src.end === 'low' ? hand.shift()! : hand.pop()!;
    }
    this.reveals.push({ value, src });
    this.seq++;
    const target = this.reveals[0].value;
    if (value !== target) {
      this.outcome = { kind: 'miss', value };
      this.stage = 'resolve';
    } else if (this.reveals.length === 3) {
      this.outcome = { kind: 'trio', value };
      this.stage = 'resolve';
    }
    return undefined;
  }

  /** Fin du tour, une fois que tout le monde a vu les cartes : elles retournent à leur place, ou forment un trio. */
  settle(): void {
    if (this.stage !== 'resolve' || !this.outcome) return;
    const by = this.order[this.turn];
    const won = this.outcome.kind === 'trio';
    for (const r of this.reveals) {
      if (r.src.kind === 'middle') {
        this.up.delete(r.src.slot);
        if (won) this.middle[r.src.slot] = null;
      } else if (!won) insertSorted(this.hand(r.src.player), r.value);
    }
    const value = this.outcome.value;
    this.reveals = [];
    this.outcome = null;
    this.turns++;
    this.seq++;
    if (won) {
      this.trios.get(by)!.push(value);
      this.push('trio', { by, value });
      this.victory = this.checkVictory(by);
      if (this.victory) {
        this.stage = 'over';
        return;
      }
    }
    this.turn = (this.turn + 1) % this.order.length;
    // En équipes, chaque trio gagné offre un échange aux équipes adverses.
    if (won && this.teams) {
      const mine = this.teamOf.get(by)!;
      this.startSwap(
        this.teams.map((_, i) => i).filter((i) => i !== mine),
        'trio',
      );
      return;
    }
    this.stage = 'play';
  }

  checkVictory(by: string): Victory | null {
    const ids = this.group(by);
    const values = this.groupTrios(by);
    const team = this.teamOf.get(by) ?? null;
    if (values.includes(SEVEN)) return { ids, team, reason: 'seven', values: [SEVEN] };
    if (this.mode === 'simple' && values.length >= 3) return { ids, team, reason: 'three', values: values.slice(0, 3) };
    if (this.mode === 'piquant') {
      for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) if (areLinked(values[i], values[j])) return { ids, team, reason: 'linked', values: [values[i], values[j]] };
    }
    return null;
  }

  // ───────────────────────────── Échanges entre partenaires ─────────────────────────────

  private startSwap(teams: number[], reason: SwapState['reason']): void {
    this.swap = { teams: new Set(teams), choices: new Map(), done: new Set(), reason };
    this.stage = 'swap';
    this.seq++;
  }

  /** Ceux qui doivent encore choisir leur carte. */
  swapWaiting(): string[] {
    const s = this.swap;
    if (!s || !this.teams) return [];
    return [...s.teams].filter((t) => !s.done.has(t)).flatMap((t) => this.teams![t].filter((id) => !s.choices.has(id)));
  }

  /** Choisir la carte à donner à son partenaire, ou passer. L'échange n'a lieu que si les deux donnent une carte. */
  swapChoose(by: string, raw: unknown): string | undefined {
    const s = this.swap;
    if (this.stage !== 'swap' || !s || !this.teams) return "Ce n'est pas le moment d'échanger.";
    const team = this.teamOf.get(by);
    if (team === undefined || !s.teams.has(team) || s.done.has(team)) return "Ton équipe n'échange pas maintenant.";
    if (s.choices.has(by)) return 'Tu as déjà choisi.';
    if (raw === 'pass') s.choices.set(by, 'pass');
    else {
      if (typeof raw !== 'number' || !this.hand(by).includes(raw)) return "Tu n'as pas cette carte.";
      s.choices.set(by, raw);
    }
    const [a, b] = this.teams[team];
    if (s.choices.has(a) && s.choices.has(b)) {
      const ca = s.choices.get(a)!;
      const cb = s.choices.get(b)!;
      const both = ca !== 'pass' && cb !== 'pass';
      if (both) {
        const ha = this.hand(a);
        const hb = this.hand(b);
        ha.splice(ha.indexOf(ca), 1);
        hb.splice(hb.indexOf(cb), 1);
        insertSorted(ha, cb);
        insertSorted(hb, ca);
      }
      this.swaps.push({ team, ids: [a, b], gave: both ? [ca as number, cb as number] : [null, null] });
      s.done.add(team);
    }
    if ([...s.teams].every((t) => s.done.has(t))) this.endSwap();
    return undefined;
  }

  private endSwap(): void {
    const s = this.swap!;
    const swapped = this.swaps.filter((x) => s.teams.has(x.team) && x.gave[0] !== null).map((x) => x.team);
    this.push('swap', { teams: swapped });
    this.swap = null;
    this.stage = 'play';
    this.seq++;
    if (s.reason === 'start') this.push('start', { by: this.order[this.turn] });
  }

  /** Les échanges réglés depuis le dernier appel. */
  takeSwaps(): SwapResult[] {
    const out = this.swaps;
    this.swaps = [];
    return out;
  }
}
