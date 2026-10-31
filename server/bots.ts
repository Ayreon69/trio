// Les bots de Trio : une mémoire imparfaite de ce qui a été révélé, et des coups qui visent le trio le plus probable.
// Ils ne voient que ce qu'un joueur voit : leur main, les cartes révélées sous leurs yeux, les trios posés et le nombre de cartes de chacun.
import crypto from 'node:crypto';
import { COPIES, SEVEN, VALUES, areLinked, type Reveal, type Source } from '../shared/protocol';
import type { Game, SwapResult } from './game';
import { insertSorted } from './game';

export interface Skill {
  /** Chance de retenir une carte révélée. */
  capture: number;
  /** Chance d'oublier un souvenir à chaque tour qui passe. */
  forget: number;
  /** Chance de jouer un coup au hasard plutôt que le meilleur. */
  slip: number;
}

export function randomSkill(): Skill {
  return { capture: 0.76 + Math.random() * 0.16, forget: 0.03 + Math.random() * 0.04, slip: 0.04 + Math.random() * 0.04 };
}

/** Le pilote automatique d'un absent : il ne sait que ce qui est sous ses yeux, et varie ses coups pour ne pas rejouer sans fin le même essai raté. */
export const NO_MEMORY: Skill = { capture: 0, forget: 1, slip: 0.2 };

/**
 * Ce qu'un bot croit savoir : la carte de certains emplacements du centre, et le début ou la fin de certaines mains.
 * `low.get(p)[k]` est la (k+1)-ième plus petite carte de p, `high.get(p)[k]` la (k+1)-ième plus grande.
 * Ces souvenirs se suivent toujours depuis le bout de la main : on ne retient pas une carte « du milieu ».
 */
export class Memory {
  middle = new Map<number, number>();
  low = new Map<string, number[]>();
  high = new Map<string, number[]>();

  constructor(
    readonly skill: Skill,
    readonly self: string,
  ) {}

  private chain(map: Map<string, number[]>, p: string): number[] {
    let c = map.get(p);
    if (!c) map.set(p, (c = []));
    return c;
  }

  /** Fin d'un tour : retenir les cartes vues (ou les rayer si elles forment un trio), puis oublier un peu. */
  observeTurn(reveals: Reveal[], trio: boolean): void {
    const seen = new Map<string, number>();
    const lost = new Set<string>();
    for (const r of reveals) {
      const remember = Math.random() < this.skill.capture;
      if (r.src.kind === 'middle') {
        if (trio) this.middle.delete(r.src.slot);
        else if (remember) this.middle.set(r.src.slot, r.value);
        continue;
      }
      const { player, end } = r.src;
      if (player === this.self) continue;
      const key = `${player}:${end}`;
      const k = seen.get(key) ?? 0;
      seen.set(key, k + 1);
      if (trio) continue;
      const c = this.chain(end === 'low' ? this.low : this.high, player);
      // Un souvenir manqué coupe la suite : on ne retient pas la deuxième plus petite sans la première.
      if (!remember || lost.has(key) || k > c.length) {
        lost.add(key);
        continue;
      }
      c[k] = r.value;
      const sorted = (a: number, b: number) => (end === 'low' ? a <= b : a >= b);
      for (let i = k + 1; i < c.length; i++)
        if (!sorted(c[i - 1], c[i])) {
          c.length = i;
          break;
        }
    }
    // Un trio retire des cartes du bout des mains : ce qu'on savait derrière elles remonte d'autant.
    if (trio)
      for (const [key, k] of seen) {
        const [player, end] = key.split(':');
        const map = end === 'low' ? this.low : this.high;
        map.set(player, (map.get(player) ?? []).slice(k));
      }
    this.fade();
  }

  /** Un échange entre partenaires : on ne sait plus rien de ces deux mains, sauf si l'on y a pris part. */
  observeSwap(r: SwapResult): void {
    if (r.gave[0] === null || r.gave[1] === null) return;
    const mine = r.ids.indexOf(this.self);
    if (mine < 0) {
      for (const id of r.ids) {
        this.low.delete(id);
        this.high.delete(id);
      }
      return;
    }
    const partner = r.ids[1 - mine];
    const gave = r.gave[mine]!;
    const got = r.gave[1 - mine]!;
    // Ce qu'on savait borne la suite : sous la dernière carte connue du bas, il n'y avait rien d'autre.
    const lo = this.low.get(partner);
    const hi = this.high.get(partner);
    const floor = lo?.length ? lo[lo.length - 1] : null;
    const ceil = hi?.length ? hi[hi.length - 1] : null;
    this.remove(partner, got);
    this.insert(partner, gave, floor, ceil);
  }

  private remove(p: string, v: number): void {
    for (const [map, below] of [
      [this.low, (a: number, b: number) => a < b],
      [this.high, (a: number, b: number) => a > b],
    ] as const) {
      const c = map.get(p);
      if (!c?.length) continue;
      const i = c.indexOf(v);
      if (i >= 0) c.splice(i, 1);
      else if (below(v, c[c.length - 1])) map.delete(p);
    }
  }

  private insert(p: string, v: number, floor: number | null, ceil: number | null): void {
    const lo = this.low.get(p);
    if (lo && floor !== null && v <= floor) insertSorted(lo, v);
    const hi = this.high.get(p);
    if (hi && ceil !== null && v >= ceil) {
      let i = 0;
      while (i < hi.length && hi[i] > v) i++;
      hi.splice(i, 0, v);
    }
  }

  fade(): void {
    const f = this.skill.forget;
    for (const slot of [...this.middle.keys()]) if (Math.random() < f) this.middle.delete(slot);
    for (const map of [this.low, this.high])
      for (const c of map.values())
        for (let i = 0; i < c.length; i++)
          if (Math.random() < f) {
            c.length = i;
            break;
          }
  }
}

// ───────────────────────────── Estimer où sont les cartes ─────────────────────────────

type Dist = Float64Array;
const KNOWN = 0.96;

interface HandInfo {
  /** Taille de la main au début du tour. */
  n0: number;
  /** Cartes révélées ce tour-ci (réelles puis supposées), depuis le bas et depuis le haut. */
  lowVals: number[];
  highVals: number[];
  /** Ce que la mémoire dit du début et de la fin de la main (positions du début du tour). */
  memLow: number[];
  memHigh: number[];
  /** La main entière, pour soi. */
  exact: number[] | null;
}

interface Plan {
  hands: Map<string, HandInfo>;
  /** Emplacements du centre encore face cachée, et leur valeur si on s'en souvient. */
  middle: Map<number, number | null>;
  /** Cartes dont on ignore l'emplacement, par valeur. */
  pool: number[];
}

function clonePlan(p: Plan): Plan {
  const hands = new Map<string, HandInfo>();
  for (const [id, h] of p.hands) hands.set(id, { ...h, lowVals: [...h.lowVals], highVals: [...h.highVals] });
  return { hands, middle: new Map(p.middle), pool: [...p.pool] };
}

/** La valeur à une position de la main (début du tour), si on la connaît. */
function known(h: HandInfo, pos: number): number | null {
  if (h.exact) return h.exact[pos] ?? null;
  if (pos < h.lowVals.length) return h.lowVals[pos];
  if (pos >= h.n0 - h.highVals.length) return h.highVals[h.n0 - 1 - pos];
  if (pos < h.memLow.length) return h.memLow[pos];
  if (pos >= h.n0 - h.memHigh.length) return h.memHigh[h.n0 - 1 - pos];
  return null;
}

function buildPlan(g: Game, mem: Memory): Plan {
  const me = mem.self;
  const pool = Array(13).fill(0);
  for (const v of VALUES) pool[v] = COPIES;
  const take = (v: number) => (pool[v] = Math.max(0, pool[v] - 1));
  for (const v of g.hand(me)) take(v);
  for (const t of g.trios.values()) for (const v of t) for (let i = 0; i < COPIES; i++) take(v);
  for (const r of g.reveals) take(r.value);
  const hands = new Map<string, HandInfo>();
  for (const id of g.order) {
    const lowVals = g.reveals.filter((r) => r.src.kind === 'hand' && r.src.player === id && r.src.end === 'low').map((r) => r.value);
    const highVals = g.reveals.filter((r) => r.src.kind === 'hand' && r.src.player === id && r.src.end === 'high').map((r) => r.value);
    const n0 = g.hand(id).length + lowVals.length + highVals.length;
    let exact: number[] | null = null;
    if (id === me) {
      exact = [...g.hand(me)];
      for (const v of lowVals) insertSorted(exact, v);
      for (const v of highVals) insertSorted(exact, v);
    }
    const memLow = id === me ? [] : (mem.low.get(id) ?? []).slice(0, n0);
    const memHigh = id === me ? [] : (mem.high.get(id) ?? []).slice(0, Math.max(0, n0 - memLow.length));
    const h: HandInfo = { n0, lowVals, highVals, memLow, memHigh, exact };
    hands.set(id, h);
    if (id === me) continue;
    for (let pos = lowVals.length; pos < n0 - highVals.length; pos++) {
      const v = known(h, pos);
      if (v !== null) take(v);
    }
  }
  const middle = new Map<number, number | null>();
  g.middle.forEach((v, slot) => {
    if (v === null || g.up.has(slot)) {
      mem.middle.delete(slot);
      return;
    }
    const m = mem.middle.get(slot);
    middle.set(slot, m ?? null);
    if (m !== undefined) take(m);
  });
  return { hands, middle, pool };
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

function point(v: number, pool: number[]): Dist {
  const d = new Float64Array(13);
  const total = pool.reduce((a, b) => a + b, 0);
  for (let w = 1; w <= 12; w++) d[w] = total ? ((1 - KNOWN) * pool[w]) / total : 0;
  d[v] += total ? KNOWN : 1;
  return d;
}

/** La plus petite (ou la plus grande) de m cartes tirées parmi les cartes inconnues comprises entre lb et ub. */
function extreme(pool: number[], m: number, lb: number, ub: number, lowest: boolean): Dist {
  const d = new Float64Array(13);
  const c = pool.map((x, v) => (v >= lb && v <= ub ? x : 0));
  const N = c.reduce((a, b) => a + b, 0);
  if (N === 0) {
    const vals = VALUES.filter((v) => v >= lb && v <= ub);
    for (const v of vals) d[v] = 1 / vals.length;
    return d;
  }
  const mm = Math.min(m, N);
  const total = choose(N, mm);
  // P(min ≥ w) = C(N≥w, m) / C(N, m) ; symétrique pour le max.
  const at = (w: number) => {
    let n = 0;
    for (let v = 1; v <= 12; v++) if (lowest ? v >= w : v <= w) n += c[v];
    return choose(n, mm) / total;
  };
  for (let v = 1; v <= 12; v++) d[v] = lowest ? at(v) - at(v + 1) : at(v) - at(v - 1);
  return d;
}

/** Ce que pourrait montrer une source, ou null si elle n'a plus de carte. */
function dist(plan: Plan, src: Source): Dist | null {
  if (src.kind === 'middle') {
    if (!plan.middle.has(src.slot)) return null;
    const m = plan.middle.get(src.slot)!;
    if (m !== null) return point(m, plan.pool);
    const total = plan.pool.reduce((a, b) => a + b, 0);
    const d = new Float64Array(13);
    for (let v = 1; v <= 12; v++) d[v] = total ? plan.pool[v] / total : 1 / 12;
    return d;
  }
  const h = plan.hands.get(src.player);
  if (!h) return null;
  const lo = h.lowVals.length;
  const hi = h.n0 - 1 - h.highVals.length;
  if (lo > hi) return null;
  const pos = src.end === 'low' ? lo : hi;
  const v = known(h, pos);
  if (v !== null) {
    if (h.exact) {
      const d = new Float64Array(13);
      d[v] = 1;
      return d;
    }
    return point(v, plan.pool);
  }
  // Le bloc inconnu de la main, entre ce qu'on sait du bas et du haut.
  let a = pos;
  let b = pos;
  while (a - 1 >= lo && known(h, a - 1) === null) a--;
  while (b + 1 <= hi && known(h, b + 1) === null) b++;
  const below = a - 1 >= 0 ? known(h, a - 1) : null;
  const above = b + 1 < h.n0 ? known(h, b + 1) : null;
  return extreme(plan.pool, b - a + 1, below ?? 1, above ?? 12, src.end === 'low');
}

/** Le plan après qu'une source a montré la valeur v. */
function apply(plan: Plan, src: Source, v: number): Plan {
  const p = clonePlan(plan);
  if (src.kind === 'middle') {
    if (p.middle.get(src.slot) === null) p.pool[v] = Math.max(0, p.pool[v] - 1);
    p.middle.delete(src.slot);
    return p;
  }
  const h = p.hands.get(src.player)!;
  const pos = src.end === 'low' ? h.lowVals.length : h.n0 - 1 - h.highVals.length;
  if (known(h, pos) === null) p.pool[v] = Math.max(0, p.pool[v] - 1);
  (src.end === 'low' ? h.lowVals : h.highVals).push(v);
  return p;
}

function sources(g: Game): Source[] {
  const out: Source[] = [];
  g.middle.forEach((v, slot) => {
    if (v !== null && !g.up.has(slot)) out.push({ kind: 'middle', slot });
  });
  for (const id of g.order) {
    out.push({ kind: 'hand', player: id, end: 'low' });
    out.push({ kind: 'hand', player: id, end: 'high' });
  }
  return out;
}

function planSources(plan: Plan): Source[] {
  const out: Source[] = [];
  for (const slot of plan.middle.keys()) out.push({ kind: 'middle', slot });
  for (const [id, h] of plan.hands) {
    if (h.lowVals.length > h.n0 - 1 - h.highVals.length) continue;
    out.push({ kind: 'hand', player: id, end: 'low' });
    out.push({ kind: 'hand', player: id, end: 'high' });
  }
  return out;
}

/** Les chances de trouver encore `need` cartes de valeur v (approché : les meilleures sources distinctes, ou une suite au même bout d'une main). */
function complete(plan: Plan, v: number, need: number): number {
  if (need <= 0) return 1;
  const srcs = planSources(plan);
  const ps: number[] = [];
  let pair = 0;
  for (const s of srcs) {
    const d = dist(plan, s);
    const p = d ? d[v] : 0;
    ps.push(p);
    if (need === 2 && s.kind === 'hand' && p > 0.05) {
      const next = dist(apply(plan, s, v), s);
      pair = Math.max(pair, p * (next ? next[v] : 0));
    }
  }
  ps.sort((a, b) => b - a);
  if (need === 1) return ps[0] ?? 0;
  // Deux sources distinctes : on ne compte pas deux fois le même bout de main (déjà couvert par `pair`).
  return Math.max(pair, (ps[0] ?? 0) * (ps[1] ?? 0));
}

/** Ce que vaut un trio de v : la victoire, ou un pas vers elle. */
function worth(g: Game, me: string, v: number): number {
  if (v === SEVEN) return 4;
  const mine = g.groupTrios(me);
  if (g.mode === 'simple' && mine.length >= 2) return 4;
  if (g.mode === 'piquant' && mine.some((t) => areLinked(t, v))) return 4;
  // Priver un adversaire de sa victoire vaut aussi quelque chose.
  for (const id of g.order) {
    if (g.group(me).includes(id)) continue;
    const theirs = g.groupTrios(id);
    if ((g.mode === 'simple' && theirs.length >= 2) || (g.mode === 'piquant' && theirs.some((t) => areLinked(t, v)))) return 1.6;
  }
  if (g.mode === 'piquant') return 1 + 0.1 * VALUES.filter((w) => areLinked(w, v) && !g.order.some((id) => g.trios.get(id)!.includes(w))).length;
  return 1;
}

function unknownTo(plan: Plan, src: Source, me: string): boolean {
  if (src.kind === 'middle') return plan.middle.get(src.slot) === null;
  if (src.player === me) return false;
  const h = plan.hands.get(src.player)!;
  const pos = src.end === 'low' ? h.lowVals.length : h.n0 - 1 - h.highVals.length;
  return known(h, pos) === null;
}

/** La carte que révèle le bot. */
export function botReveal(g: Game, mem: Memory): Source {
  const me = mem.self;
  const plan = buildPlan(g, mem);
  const avail = sources(g).filter((s) => dist(plan, s) !== null);
  if (!avail.length) return { kind: 'hand', player: me, end: 'low' };
  if (Math.random() < mem.skill.slip) return avail[crypto.randomInt(avail.length)];
  const target = g.reveals[0]?.value;
  let best = avail[0];
  let bestScore = -Infinity;
  for (const s of avail) {
    const d = dist(plan, s)!;
    const mineSrc = s.kind === 'hand' && s.player === me;
    const unknown = unknownTo(plan, s, me);
    let score = 0;
    if (target === undefined) {
      for (let v = 1; v <= 12; v++) if (d[v] > 0.01) score += d[v] * complete(apply(plan, s, v), v, 2) * worth(g, me, v);
      // Montrer sa propre carte renseigne les autres ; découvrir une carte inconnue renseigne le bot.
      if (mineSrc) score -= 0.04 * (1 - Math.min(1, score));
      if (unknown) score += 0.03;
    } else {
      const need = 3 - g.reveals.length;
      score = d[target] * (need === 2 ? complete(apply(plan, s, target), target, 1) : 1);
      if (unknown) score += 0.02 * (1 - d[target]);
      if (mineSrc) score -= 0.02 * (1 - d[target]);
    }
    score += Math.random() * 0.004;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/** La carte à donner à son partenaire : une carte isolée, plutôt du milieu de la main, qu'on aurait du mal à révéler soi-même. */
export function botSwap(g: Game, me: string): number | 'pass' {
  const hand = g.hand(me);
  if (!hand.length) return 'pass';
  const count = (v: number) => hand.filter((x) => x === v).length;
  const inner = hand.slice(1, -1).filter((v) => count(v) === 1 && v !== SEVEN);
  const singles = hand.filter((v) => count(v) === 1 && v !== SEVEN);
  const pool = inner.length ? inner : singles.length ? singles : hand;
  return pool[crypto.randomInt(pool.length)];
}
