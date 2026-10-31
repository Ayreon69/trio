import { describe, expect, it } from 'vitest';
import { DEAL, DECK_SIZE, linked, type Source } from '../shared/protocol';
import { Memory, botReveal, botSwap, type Skill } from '../server/bots';
import { Game, freshDeck } from '../server/game';
import { Room } from '../server/room';

/** Fixe la donne : les mains dans l'ordre de jeu, puis le centre. */
function fixed(hands: number[][], middle: number[] = []): (cards: number[]) => number[] {
  return () => [...hands.flat(), ...middle];
}

const A = 'a';
const B = 'b';
const C = 'c';
const D = 'd';
const low = (player: string): Source => ({ kind: 'hand', player, end: 'low' });
const high = (player: string): Source => ({ kind: 'hand', player, end: 'high' });
const mid = (slot: number): Source => ({ kind: 'middle', slot });

/** Une partie à trois, donne fixée (9 cartes chacun, 9 au centre), A commence. */
function three(hands: number[][], middle: number[], mode: 'simple' | 'piquant' = 'simple'): Game {
  return new Game([A, B, C], { mode, shuffle: fixed(hands, middle), first: 0, eventMs: 60_000 });
}

const HA = [1, 1, 2, 4, 5, 6, 7, 9, 12];
const HB = [2, 3, 3, 5, 6, 8, 10, 11, 12];
const HC = [1, 2, 4, 4, 6, 8, 9, 10, 11];
const MID = [3, 5, 7, 7, 8, 9, 10, 11, 12];

describe('les cartes', () => {
  it('36 cartes : trois exemplaires de chaque nombre de 1 à 12', () => {
    const deck = freshDeck();
    expect(deck).toHaveLength(36);
    expect(DECK_SIZE).toBe(36);
    for (let v = 1; v <= 12; v++) expect(deck.filter((x) => x === v)).toHaveLength(3);
  });

  it('la donne du livret, et rien au centre en équipes', () => {
    for (const n of [3, 4, 5, 6]) {
      const order = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'].slice(0, n);
      const g = new Game(order, { mode: 'simple' });
      for (const id of order) expect(g.hand(id)).toHaveLength(DEAL[n].hand);
      expect(g.middle).toHaveLength(DEAL[n].middle);
      expect(n * DEAL[n].hand + DEAL[n].middle).toBe(36);
    }
    const t4 = new Game([A, B, C, D], { mode: 'simple', teams: [[A, C], [B, D]] });
    expect(t4.middle).toHaveLength(0);
    expect(t4.hand(A)).toHaveLength(9);
    const t6 = new Game(['a', 'b', 'c', 'd', 'e', 'f'], { mode: 'simple', teams: [['a', 'd'], ['b', 'e'], ['c', 'f']] });
    expect(t6.middle).toHaveLength(0);
    expect(t6.hand('f')).toHaveLength(6);
  });

  it('chacun range sa main de la plus petite à la plus grande', () => {
    const g = new Game([A, B, C], { mode: 'simple' });
    for (const id of [A, B, C]) expect(g.hand(id)).toEqual([...g.hand(id)].sort((x, y) => x - y));
  });

  it('les nombres liés du mode piquant : somme ou différence de 7', () => {
    expect(linked(2)).toEqual([5, 9]);
    expect(linked(1)).toEqual([6, 8]);
    expect(linked(5)).toEqual([2, 12]);
    expect(linked(6)).toEqual([1]);
    expect(linked(12)).toEqual([5]);
    expect(linked(7)).toEqual([]);
  });
});

describe('le tour', () => {
  it('on révèle la plus petite ou la plus grande d’un joueur, soi compris, et on peut répéter', () => {
    const g = three([HA, HB, HC], MID);
    expect(g.reveal(A, low(B))).toBeUndefined();
    expect(g.reveals.map((r) => r.value)).toEqual([2]);
    expect(g.reveal(A, low(A))).toBeUndefined();
    // A révèle sa plus petite : un 1, différent du 2 : le tour s'arrête.
    expect(g.stage).toBe('resolve');
    expect(g.outcome).toEqual({ kind: 'miss', value: 1 });
    const h = three([HA, HB, HC], MID);
    h.reveal(A, high(B));
    h.reveal(A, high(A));
    expect(h.reveals.map((r) => r.value)).toEqual([12, 12]);
    expect(h.stage).toBe('play');
    expect(h.hand(B)).toHaveLength(8);
  });

  it('deux nombres différents : tout retourne à sa place, et c’est au suivant', () => {
    const g = three([HA, HB, HC], MID);
    g.reveal(A, mid(4));
    g.reveal(A, high(C));
    expect(g.outcome?.kind).toBe('miss');
    expect(g.reveal(A, low(B))).toBeTruthy();
    g.settle();
    expect(g.middle[4]).toBe(8);
    expect(g.up.size).toBe(0);
    expect(g.hand(C)).toEqual(HC);
    expect(g.current).toBe(B);
    expect(g.reveals).toEqual([]);
  });

  it('trois identiques : le trio est gagné, les cartes quittent la table, et c’est au suivant', () => {
    const g = three([HA, HB, HC], MID);
    g.reveal(A, high(A));
    g.reveal(A, high(B));
    g.reveal(A, mid(8));
    expect(g.outcome).toEqual({ kind: 'trio', value: 12 });
    g.settle();
    expect(g.trios.get(A)).toEqual([12]);
    expect(g.middle[8]).toBeNull();
    expect(g.hand(A)).not.toContain(12);
    expect(g.hand(B)).not.toContain(12);
    expect(g.current).toBe(B);
    expect(g.events.some((e) => e.kind === 'trio' && e.value === 12)).toBe(true);
  });

  it('on prend deux fois sa plus petite : la deuxième est la suivante', () => {
    const g = three([HA, HB, HC], MID);
    g.reveal(A, low(A));
    g.reveal(A, low(A));
    expect(g.reveals.map((r) => r.value)).toEqual([1, 1]);
    g.reveal(A, low(C));
    expect(g.outcome).toEqual({ kind: 'trio', value: 1 });
  });

  it('les coups interdits', () => {
    const g = three([HA, HB, HC], MID);
    expect(g.reveal(B, low(A))).toMatch(/pas ton tour/);
    expect(g.reveal(A, { kind: 'middle', slot: 11 })).toBeTruthy();
    expect(g.reveal(A, { kind: 'hand', player: 'zz', end: 'low' })).toBeTruthy();
    expect(g.reveal(A, 'n’importe quoi')).toBeTruthy();
    g.reveal(A, mid(2));
    expect(g.reveal(A, mid(2))).toMatch(/déjà retournée/);
    g.reveal(A, mid(3));
    g.reveal(A, high(B));
    expect(g.stage).toBe('resolve');
    expect(g.reveal(A, low(A))).toBeTruthy();
  });

  it('une main vide ne se révèle plus, mais son joueur joue encore', () => {
    const g = three([HA, HB, HC], MID);
    g.hands.set(A, []);
    expect(g.reveal(A, low(A))).toMatch(/plus de carte/);
    expect(g.reveal(A, low(B))).toBeUndefined();
  });
});

describe('la victoire', () => {
  it('le trio de 7 gagne tout de suite', () => {
    const g = three([HA, HB, HC], MID);
    g.reveal(A, mid(2));
    g.reveal(A, mid(3));
    g.reveal(A, { kind: 'hand', player: A, end: 'high' });
    expect(g.outcome?.kind).toBe('miss');
    const h = three([HA, HB, HC], MID);
    h.hands.set(A, [7]);
    h.reveal(A, mid(2));
    h.reveal(A, mid(3));
    h.reveal(A, low(A));
    h.settle();
    expect(h.stage).toBe('over');
    expect(h.victory).toMatchObject({ ids: [A], reason: 'seven', values: [7] });
  });

  it('mode simple : trois trios quelconques', () => {
    const g = three([HA, HB, HC], MID);
    g.trios.set(A, [3, 11]);
    expect(g.checkVictory(A)).toBeNull();
    g.trios.set(A, [3, 11, 4]);
    expect(g.checkVictory(A)).toMatchObject({ reason: 'three', values: [3, 11, 4] });
  });

  it('mode piquant : deux trios liés, et trois trios sans lien ne suffisent pas', () => {
    const g = three([HA, HB, HC], MID, 'piquant');
    g.trios.set(A, [3, 11, 4]);
    expect(g.checkVictory(A)).toMatchObject({ reason: 'linked', values: [3, 4] });
    g.trios.set(A, [1, 3, 5, 12]);
    expect(g.checkVictory(A)).toMatchObject({ reason: 'linked', values: [5, 12] });
    g.trios.set(A, [1, 2, 3]);
    expect(g.checkVictory(A)).toBeNull();
    g.trios.set(A, [2, 9]);
    expect(g.checkVictory(A)?.reason).toBe('linked');
  });
});

describe('les équipes', () => {
  const teams = [
    [A, C],
    [B, D],
  ];
  function four(): Game {
    const hands = [
      [1, 1, 2, 3, 4, 5, 6, 7, 8],
      [1, 2, 3, 4, 5, 6, 9, 10, 11],
      [2, 3, 4, 5, 6, 7, 8, 9, 10],
      [7, 8, 9, 10, 11, 11, 12, 12, 12],
    ];
    return new Game([A, B, C, D], { mode: 'simple', teams, shuffle: fixed(hands), first: 0, eventMs: 60_000 });
  }

  it('la partie commence par un échange entre partenaires', () => {
    const g = four();
    expect(g.stage).toBe('swap');
    expect(g.swapWaiting().sort()).toEqual([A, B, C, D]);
    expect(g.reveal(A, low(B))).toBeTruthy();
    expect(g.swapChoose(A, 1)).toBeUndefined();
    expect(g.swapChoose(A, 2)).toMatch(/déjà choisi/);
    expect(g.swapChoose(C, 99)).toMatch(/pas cette carte/);
    expect(g.swapChoose(C, 10)).toBeUndefined();
    expect(g.hand(A)).toContain(10);
    expect(g.hand(C)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // L'autre équipe passe : pas d'échange pour elle.
    g.swapChoose(B, 'pass');
    g.swapChoose(D, 12);
    expect(g.hand(D)).toContain(12);
    expect(g.stage).toBe('play');
    expect(g.takeSwaps().map((s) => s.gave)).toEqual([
      [1, 10],
      [null, null],
    ]);
  });

  it('un trio d’une équipe offre un échange à l’autre, et les partenaires mettent leurs trios en commun', () => {
    const g = four();
    for (const id of [A, B, C, D]) g.swapChoose(id, 'pass');
    g.trios.set(C, [5, 9]);
    g.reveal(A, high(D));
    g.reveal(A, high(D));
    g.reveal(A, high(D));
    g.settle();
    // A + C : trois trios en tout.
    expect(g.stage).toBe('over');
    expect(g.victory).toMatchObject({ ids: [A, C], team: 0, reason: 'three' });
    const h = four();
    for (const id of [A, B, C, D]) h.swapChoose(id, 'pass');
    h.reveal(A, high(D));
    h.reveal(A, high(D));
    h.reveal(A, high(D));
    h.settle();
    expect(h.stage).toBe('swap');
    expect(h.swapWaiting().sort()).toEqual([B, D]);
    expect(h.swapChoose(A, 1)).toBeTruthy();
    h.swapChoose(B, 'pass');
    h.swapChoose(D, 'pass');
    expect(h.stage).toBe('play');
    expect(h.current).toBe(B);
  });
});

describe('les bots', () => {
  const sharp: Skill = { capture: 1, forget: 0, slip: 0 };

  it('retiennent ce qu’ils voient, oublient ce qui part dans un trio', () => {
    const m = new Memory(sharp, A);
    m.observeTurn(
      [
        { value: 4, src: mid(2) },
        { value: 4, src: low(B) },
        { value: 6, src: low(B) },
      ],
      false,
    );
    expect(m.middle.get(2)).toBe(4);
    expect(m.low.get(B)).toEqual([4, 6]);
    m.observeTurn(
      [
        { value: 4, src: low(B) },
        { value: 4, src: mid(2) },
        { value: 4, src: mid(5) },
      ],
      true,
    );
    expect(m.middle.has(2)).toBe(false);
    expect(m.low.get(B)).toEqual([6]);
  });

  it('un échange brouille les mains, sauf pour qui y a pris part', () => {
    const m = new Memory(sharp, A);
    m.low.set(C, [2, 5]);
    m.low.set(B, [3]);
    m.observeSwap({ team: 1, ids: [B, D], gave: [3, 9] });
    expect(m.low.has(B)).toBe(false);
    // A donne un 4 à C et reçoit le 5 de C.
    m.observeSwap({ team: 0, ids: [A, C], gave: [4, 5] });
    expect(m.low.get(C)).toEqual([2, 4]);
  });

  it('jouent un trio qu’ils connaissent, et complètent celui qui est commencé', () => {
    const g = three([HA, HB, HC], MID);
    const m = new Memory(sharp, A);
    // A a deux 1 en bas de sa main et se souvient que C en a un tout en bas.
    m.low.set(C, [1]);
    const first = botReveal(g, m);
    expect(first.kind === 'hand' && (first.player === A || first.player === C) && first.end === 'low').toBe(true);
    g.reveal(A, first);
    const second = botReveal(g, m);
    g.reveal(A, second);
    const third = botReveal(g, m);
    g.reveal(A, third);
    expect(g.outcome).toEqual({ kind: 'trio', value: 1 });
  });

  it('visent les 7 du centre dont ils se souviennent', () => {
    const g = three([HA, HB, HC], MID);
    // Le 7 de A est tout en haut de sa main : il est atteignable.
    g.hands.set(A, [2, 4, 5, 6, 7]);
    const m = new Memory(sharp, A);
    m.middle.set(2, 7);
    m.middle.set(3, 7);
    const picks: Source[] = [];
    for (let i = 0; i < 3 && g.stage === 'play'; i++) {
      const s = botReveal(g, m);
      picks.push(s);
      g.reveal(A, s);
    }
    expect(g.outcome).toEqual({ kind: 'trio', value: 7 });
  });

  it('donnent une carte qu’ils ont en un seul exemplaire', () => {
    const g = new Game([A, B, C, D], { mode: 'simple', teams: [[A, C], [B, D]] });
    g.hands.set(A, [1, 1, 5, 9, 9]);
    expect(botSwap(g, A)).toBe(5);
  });
});

describe('la table', () => {
  it('il faut être 3, et 4 ou 6 en équipes', () => {
    const room = new Room('ABCD');
    const host = room.addHuman('Ana', 'flamant');
    if (typeof host === 'string') throw new Error(host);
    room.hostId = host.id;
    room.addBot(host.id);
    expect(room.start(host.id)).toMatch(/au moins 3/);
    room.addBot(host.id);
    room.updateSettings(host.id, { teams: true });
    expect(room.start(host.id)).toMatch(/4 ou 6/);
    room.addBot(host.id);
    expect(room.start(host.id)).toBeUndefined();
    expect(room.game?.teams).toHaveLength(2);
    room.dispose();
  });

  it('chacun ne voit que sa main, et le centre reste caché', () => {
    const room = new Room('WXYZ');
    const host = room.addHuman('Ana', 'flamant');
    if (typeof host === 'string') throw new Error(host);
    room.hostId = host.id;
    room.addBot(host.id);
    room.addBot(host.id);
    room.start(host.id);
    const view = room.viewFor(host.id);
    const json = JSON.stringify(view);
    expect(json).not.toContain('token');
    expect(view.game!.hand).toEqual(room.game!.hand(host.id));
    expect(view.game!.middle.every((s) => s === 'hidden')).toBe(true);
    for (const p of view.players) expect(typeof p.hand).toBe('number');
    const bot = room.players.find((p) => p.isBot)!;
    expect(room.viewFor(bot.id).game!.hand).toEqual(room.game!.hand(bot.id));
    room.dispose();
  });
});
