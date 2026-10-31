// Une table de Trio : salon, équipes, partie, minuteries, bots, pilote automatique et vue de chacun.
import crypto from 'node:crypto';
import {
  AVATARS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MODES,
  TEAM_SIZES,
  THINK_OPTIONS,
  type FinalView,
  type GameView,
  type Mode,
  type PlayerStatus,
  type RoomView,
  type Settings,
  type SwapNote,
  type ThinkTime,
} from '../shared/protocol';
import { Memory, NO_MEMORY, botReveal, botSwap, randomSkill } from './bots';
import { Game, shuffle } from './game';

const BOT_NAMES = ['Pixel', 'Néon', 'Disco', 'Polka', 'Zigzag', 'Confetti', 'Turbo', 'Vinyle', 'Bubble', 'Flash'];
const MAX_MEMBERS = 14;
/** Délai laissé à un joueur déconnecté avant que le pilote automatique ne prenne le relais. */
const GRACE_MS = 20_000;
/** Mode accéléré pour les tests locaux (TR_FAST=1) : bots et chronos quasi instantanés. */
const FAST = process.env.TR_FAST === '1';
const EVENT_MS = FAST ? 300 : 3_200;
/** Le temps de bien voir les cartes avant qu'elles ne retournent à leur place : c'est là que tout se joue. */
const MISS_MS = FAST ? 40 : 2_600;
const TRIO_MS = FAST ? 40 : 2_200;
/** Le temps de savourer le trio gagnant avant le podium. */
const WIN_MS = FAST ? 120 : 3_400;
/** Un échange entre partenaires ne bloque pas la table indéfiniment : sans choix, on passe. */
const SWAP_MS = FAST ? 600 : 45_000;
const NOTE_MS = FAST ? 500 : 6_000;

export interface Player {
  id: string;
  token: string;
  name: string;
  avatar: string;
  isBot: boolean;
  sockets: Set<string>;
  connected: boolean;
  disconnectedAt: number;
  left: boolean;
  status: PlayerStatus;
}

function uid(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export class Room {
  readonly code: string;
  hostId = '';
  phase: 'lobby' | 'playing' | 'finished' = 'lobby';
  settings: Settings = { mode: 'simple', teams: false, think: 0 };
  players: Player[] = [];
  game: Game | null = null;
  final: FinalView | null = null;
  wins = new Map<string, number>();
  memories = new Map<string, Memory>();
  notes = new Map<string, SwapNote>();
  turnEndsAt = 0;
  turnStartedAt = 0;
  botActAt = 0;
  resolveAt = 0;
  finishAt = 0;
  swapStartedAt = 0;
  swapEndsAt = 0;
  swapDue = new Map<string, number>();
  lastActive = Date.now();
  onChange: () => void = () => {};
  onEmote: (playerId: string, text: string) => void = () => {};

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string) {
    this.code = code;
  }

  // ───────────────────────────── Membres ─────────────────────────────

  get(id: string | undefined): Player | undefined {
    return id ? this.players.find((p) => p.id === id) : undefined;
  }

  findByToken(playerId: unknown, token: unknown): Player | undefined {
    if (typeof playerId !== 'string' || typeof token !== 'string') return undefined;
    const p = this.get(playerId);
    return p && !p.isBot && p.token === token ? p : undefined;
  }

  get seated(): Player[] {
    return this.players.filter((p) => p.status !== 'spectator');
  }

  get humansOnline(): number {
    return this.players.filter((p) => !p.isBot && p.connected).length;
  }

  touch(): void {
    this.lastActive = Date.now();
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 99; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return name;
  }

  private makePlayer(name: string, avatar: string, isBot: boolean, status: PlayerStatus): Player {
    return {
      id: uid(),
      token: uid() + uid(),
      name: this.uniqueName(name),
      avatar,
      isBot,
      sockets: new Set(),
      connected: isBot,
      disconnectedAt: Date.now(),
      left: false,
      status,
    };
  }

  addHuman(name: string, avatar: string): Player | string {
    if (this.players.length >= MAX_MEMBERS) return 'Cette table est pleine.';
    if (this.phase === 'lobby' && this.seated.length >= MAX_PLAYERS) return `La table est complète (${MAX_PLAYERS} joueurs maximum).`;
    const p = this.makePlayer(name, avatar, false, this.phase === 'lobby' ? 'lobby' : 'spectator');
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    return p;
  }

  addBot(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut ajouter des bots.";
    if (this.phase !== 'lobby') return 'On ajoute des bots dans le salon.';
    if (this.seated.length >= MAX_PLAYERS) return `La table est complète (${MAX_PLAYERS} joueurs maximum).`;
    const used = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.players.length + 1}`;
    const usedAvatars = new Set(this.players.map((p) => p.avatar));
    const free = AVATARS.filter((a) => !usedAvatars.has(a));
    const pool = free.length ? free : AVATARS;
    this.players.push(this.makePlayer(name, pool[crypto.randomInt(pool.length)], true, 'lobby'));
    return undefined;
  }

  kick(by: string, target: string): { sockets: string[] } | string {
    if (by !== this.hostId) return "Seul l'hôte peut retirer un joueur.";
    if (this.phase !== 'lobby') return 'On ne peut retirer un joueur que dans le salon.';
    const p = this.get(target);
    if (!p || p.id === by) return 'Joueur introuvable.';
    this.players = this.players.filter((x) => x.id !== p.id);
    return { sockets: [...p.sockets] };
  }

  leave(id: string): void {
    const p = this.get(id);
    if (!p) return;
    p.sockets.clear();
    p.connected = false;
    p.disconnectedAt = Date.now();
    // En partie, sa main reste sur la table : le pilote automatique la joue.
    if (this.phase === 'lobby' || p.status === 'spectator') this.players = this.players.filter((x) => x.id !== id);
    else p.left = true;
    if (this.hostId === id) this.transferHost();
  }

  private transferHost(): void {
    const next = this.players.find((p) => !p.isBot && !p.left && p.connected) ?? this.players.find((p) => !p.isBot && !p.left);
    this.hostId = next?.id ?? '';
  }

  connect(p: Player, socketId: string): void {
    p.sockets.add(socketId);
    p.connected = true;
    p.left = false;
    if (!this.hostId || !this.get(this.hostId) || this.get(this.hostId)?.left) this.hostId = p.id;
  }

  disconnect(id: string | undefined, socketId: string): void {
    const p = this.get(id);
    if (!p) return;
    p.sockets.delete(socketId);
    if (p.sockets.size === 0) {
      p.connected = false;
      p.disconnectedAt = Date.now();
    }
  }

  isAuto(p: Player): boolean {
    return p.isBot || p.left || (!p.connected && Date.now() - p.disconnectedAt >= GRACE_MS);
  }

  updateSettings(by: string, payload: Record<string, unknown>): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut changer les réglages.";
    if (this.phase !== 'lobby') return 'Les réglages se changent dans le salon.';
    if ((THINK_OPTIONS as readonly unknown[]).includes(payload.think)) this.settings.think = payload.think as ThinkTime;
    if ((MODES as unknown[]).includes(payload.mode)) this.settings.mode = payload.mode as Mode;
    if (typeof payload.teams === 'boolean') this.settings.teams = payload.teams;
    return undefined;
  }

  /** Les équipes se forment deux par deux dans l'ordre du salon : l'hôte peut les mélanger. */
  shuffleTeams(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut mélanger les équipes.";
    if (this.phase !== 'lobby') return 'Les équipes se font dans le salon.';
    const seated = this.seated;
    const before = seated.map((p) => p.id).join();
    let mixed = shuffle([...seated]);
    // Un mélange qui redonne les mêmes équipes ne servirait à rien.
    for (let i = 0; i < 8 && this.teamKey(mixed) === this.teamKey(seated) && seated.length > 2; i++) mixed = shuffle([...seated]);
    if (mixed.map((p) => p.id).join() === before && seated.length > 2) mixed = [...mixed.slice(1), mixed[0]];
    this.players = [...mixed, ...this.players.filter((p) => p.status === 'spectator')];
    return undefined;
  }

  private teamKey(list: Player[]): string {
    const pairs: string[] = [];
    for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i].id, list[i + 1].id].sort().join('+'));
    return pairs.sort().join('|');
  }

  /** Le jeu en équipes ne se joue qu'à 4 ou 6. */
  teamsActive(count = this.seated.length): boolean {
    return this.settings.teams && (TEAM_SIZES as readonly number[]).includes(count);
  }

  // ───────────────────────────── Partie ─────────────────────────────

  start(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut lancer la partie.";
    if (this.phase !== 'lobby') return 'La partie est déjà lancée.';
    const seated = this.seated;
    if (seated.length < MIN_PLAYERS) return `Il faut au moins ${MIN_PLAYERS} joueurs (ajoute un bot si besoin).`;
    if (this.settings.teams && !this.teamsActive()) return 'En équipes, il faut être 4 ou 6 joueurs.';
    for (const p of seated) p.status = 'playing';
    let order: string[];
    let teams: string[][] | null = null;
    if (this.settings.teams) {
      // Les équipes gardent la couleur vue au salon ; les partenaires s'assoient face à face, en alternant les équipes.
      const pairs: string[][] = [];
      for (let i = 0; i < seated.length; i += 2) pairs.push(shuffle([seated[i].id, seated[i + 1].id]));
      const seating = shuffle(pairs.map((_, i) => i));
      order = [...seating.map((i) => pairs[i][0]), ...seating.map((i) => pairs[i][1])];
      teams = pairs;
    } else order = shuffle(seated.map((p) => p.id));
    const spectators = this.players.filter((p) => p.status === 'spectator');
    this.players = [...order.map((id) => this.get(id)!), ...spectators];
    this.game = new Game(order, { mode: this.settings.mode, teams, eventMs: EVENT_MS });
    this.memories.clear();
    for (const p of this.players) if (p.isBot && p.status === 'playing') this.memories.set(p.id, new Memory(randomSkill(), p.id));
    this.notes.clear();
    this.phase = 'playing';
    this.final = null;
    this.armStage();
    return undefined;
  }

  restart(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut relancer une partie.";
    if (this.phase === 'lobby') return undefined;
    this.clearTimer();
    this.players = this.players.filter((p) => !p.left);
    let seats = 0;
    for (const p of this.players) {
      p.status = seats < MAX_PLAYERS ? 'lobby' : 'spectator';
      if (p.status === 'lobby') seats++;
    }
    this.phase = 'lobby';
    this.game = null;
    this.final = null;
    this.memories.clear();
    this.notes.clear();
    return undefined;
  }

  endEarly(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut arrêter la partie.";
    if (this.phase !== 'playing') return undefined;
    return this.restart(by);
  }

  /** Plus aucun humain présent à la table : les bots jouent vite. */
  private onlyBots(): boolean {
    return this.players.every((p) => p.status !== 'playing' || this.isAuto(p));
  }

  private botDelay(min: number, spread: number): number {
    if (FAST) return 15;
    if (this.onlyBots()) return 250;
    return min + Math.random() * spread;
  }

  /** Prépare la suite selon l'étape : le tour du joueur, un échange, ou la fin. */
  private armStage(): void {
    const g = this.game;
    if (!g) return;
    const now = Date.now();
    if (g.stage === 'swap') {
      this.swapStartedAt = now;
      this.swapEndsAt = now + SWAP_MS;
      this.swapDue.clear();
      for (const id of g.swapWaiting()) if (this.get(id)?.isBot) this.swapDue.set(id, now + this.botDelay(1400, 1800));
      this.turnEndsAt = 0;
      return;
    }
    if (g.stage === 'over') {
      this.finishAt = now + WIN_MS;
      this.turnEndsAt = 0;
      return;
    }
    this.armReveal(true);
  }

  /** Chaque carte révélée relance le chrono (s'il y en a un) et le temps de réflexion des bots. */
  private armReveal(first: boolean): void {
    const now = Date.now();
    this.turnStartedAt = now;
    this.turnEndsAt = FAST ? now + 900 : this.settings.think ? now + this.settings.think * 1000 : 0;
    this.botActAt = now + (first ? this.botDelay(1300, 900) : this.botDelay(950, 500));
  }

  private check(seq: unknown): string | undefined {
    if (this.phase !== 'playing' || !this.game) return "Aucune partie n'est en cours.";
    if (seq !== undefined && seq !== this.game.seq) return 'Le tour a changé entre-temps.';
    return undefined;
  }

  reveal(by: string, src: unknown, seq?: unknown): string | undefined {
    const err = this.check(seq) ?? this.game!.reveal(by, src);
    if (err) return err;
    const g = this.game!;
    if (g.stage === 'resolve') {
      this.resolveAt = Date.now() + (g.outcome!.kind === 'miss' ? MISS_MS : TRIO_MS);
      this.turnEndsAt = 0;
    } else this.armReveal(false);
    return undefined;
  }

  swapChoose(by: string, card: unknown): string | undefined {
    const err = this.check(undefined) ?? this.game!.swapChoose(by, card);
    if (err) return err;
    this.afterSwaps();
    return undefined;
  }

  /** Les échanges réglés : chacun des deux partenaires voit ce qu'il a donné et reçu, les bots s'en souviennent. */
  private afterSwaps(): void {
    const g = this.game!;
    const now = Date.now();
    for (const r of g.takeSwaps()) {
      for (const m of this.memories.values()) m.observeSwap(r);
      r.ids.forEach((id, i) => this.notes.set(id, { gave: r.gave[i], got: r.gave[1 - i], partner: r.ids[1 - i], until: now + NOTE_MS }));
    }
    if (g.stage !== 'swap') this.armStage();
  }

  private settle(): void {
    const g = this.game!;
    const by = g.current;
    const reveals = [...g.reveals];
    const trio = g.outcome?.kind === 'trio';
    g.settle();
    for (const m of this.memories.values()) m.observeTurn(reveals, trio);
    if (trio && by) this.botReacts(by, reveals[0].value);
    this.armStage();
  }

  /** De temps en temps, un bot réagit à un trio. */
  private botReacts(by: string, value: number): void {
    if (FAST || this.game?.stage === 'over') return;
    const author = this.get(by);
    if (author?.isBot && Math.random() < 0.35) {
      const pool = value === 7 ? ['🔥'] : ['🧠', 'Trop facile', '🔥'];
      setTimeout(() => this.onEmote(by, pool[crypto.randomInt(pool.length)]), 700);
      return;
    }
    const bots = this.players.filter((p) => p.isBot && p.status === 'playing' && p.id !== by);
    if (!bots.length || Math.random() > 0.25) return;
    const bot = bots[crypto.randomInt(bots.length)];
    const pool = ['👏', '😱', 'Bien vu !'];
    setTimeout(() => this.onEmote(bot.id, pool[crypto.randomInt(pool.length)]), 900);
  }

  private finishGame(): void {
    const g = this.game;
    if (!g?.victory) return;
    const v = g.victory;
    for (const id of v.ids) this.wins.set(id, (this.wins.get(id) ?? 0) + 1);
    this.final = {
      mode: g.mode,
      victory: { ...v, ids: [...v.ids], values: [...v.values] },
      turns: g.turns,
      middle: g.middle.filter((x): x is number => x !== null),
      players: g.order.map((id) => {
        const p = this.get(id);
        return {
          id,
          name: p?.name ?? '?',
          avatar: p?.avatar ?? AVATARS[0],
          trios: [...(g.trios.get(id) ?? [])],
          hand: [...g.hand(id)],
          team: g.teamOf.get(id) ?? null,
          wins: this.wins.get(id) ?? 0,
          winner: v.ids.includes(id),
        };
      }),
    };
    this.phase = 'finished';
    this.clearTimer();
  }

  // ───────────────────────────── Minuteries & pilote automatique ─────────────────────────────

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** À appeler après chaque changement : planifie la prochaine échéance puis diffuse l'état. */
  commit(): void {
    this.reschedule();
    this.onChange();
  }

  /** Quand agir pour un joueur : bot → délai naturel, absent → fin du délai de grâce, sinon fin du chrono. */
  private dueAt(p: Player | undefined, botAt: number, startedAt: number, limit: number): number {
    if (!p) return Date.now();
    if (p.isBot) return botAt;
    if (this.isAuto(p)) return Math.min(botAt, Math.max(startedAt + 1200, p.disconnectedAt + (p.left ? 0 : GRACE_MS)));
    if (!p.connected) return Math.min(limit, p.disconnectedAt + GRACE_MS);
    return limit;
  }

  private nextDue(): number {
    const g = this.game!;
    if (g.stage === 'over') return this.finishAt;
    if (g.stage === 'resolve') return this.resolveAt;
    if (g.stage === 'swap') {
      let due = Infinity;
      for (const id of g.swapWaiting()) due = Math.min(due, this.dueAt(this.get(id), this.swapDue.get(id) ?? Date.now(), this.swapStartedAt, this.swapEndsAt));
      return due;
    }
    return this.dueAt(this.get(g.current ?? undefined), this.botActAt, this.turnStartedAt, this.turnEndsAt > 0 ? this.turnEndsAt : Infinity);
  }

  private reschedule(): void {
    this.clearTimer();
    const g = this.game;
    if (this.phase !== 'playing' || !g) return;
    const now = Date.now();
    let due = this.nextDue();
    // Un événement ou une note affichés doivent disparaître des écrans à l'heure dite.
    for (const e of g.events) if (e.until > now) due = Math.min(due, e.until + 5);
    for (const n of this.notes.values()) if (n.until > now) due = Math.min(due, n.until + 5);
    if (!Number.isFinite(due)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.tick();
      } catch (e) {
        console.error(`[room ${this.code}]`, e);
      }
      this.commit();
    }, Math.max(0, Math.min(due - now, 2_147_000_000)));
  }

  tick(): void {
    const g = this.game;
    if (this.phase !== 'playing' || !g) return;
    const now = Date.now();
    for (const [id, n] of this.notes) if (n.until <= now) this.notes.delete(id);
    if (g.stage === 'over') {
      if (now >= this.finishAt) this.finishGame();
      return;
    }
    if (g.stage === 'resolve') {
      if (now >= this.resolveAt) this.settle();
      return;
    }
    if (g.stage === 'swap') {
      for (const id of g.swapWaiting()) {
        if (g.stage !== 'swap') break;
        const p = this.get(id);
        if (now < this.dueAt(p, this.swapDue.get(id) ?? now, this.swapStartedAt, this.swapEndsAt)) continue;
        // Un bot (ou un absent remplacé) choisit sa carte ; un joueur présent qui laisse filer le temps passe son tour d'échange.
        const choice = p && (p.isBot || this.isAuto(p)) ? botSwap(g, id) : 'pass';
        if (this.swapChoose(id, choice)) this.swapChoose(id, 'pass');
      }
      return;
    }
    const id = g.current;
    if (id && now >= this.dueAt(this.get(id), this.botActAt, this.turnStartedAt, this.turnEndsAt > 0 ? this.turnEndsAt : Infinity)) this.autoPlay(id);
  }

  /** Le bot révèle une carte ; le pilote automatique d'un absent fait de même, sans rien savoir de plus que ce qui est sous ses yeux. */
  autoPlay(id: string): void {
    const g = this.game!;
    const mem = this.memories.get(id) ?? new Memory(NO_MEMORY, id);
    const src = botReveal(g, mem);
    if (!this.reveal(id, src)) return;
    // Filet de sécurité : la partie ne doit jamais se bloquer.
    console.error(`[room ${this.code}] coup refusé`, src);
    const fallback = g.order.find((p) => g.hand(p).length);
    if (fallback) this.reveal(id, { kind: 'hand', player: fallback, end: 'low' });
    else {
      const slot = g.middle.findIndex((v, i) => v !== null && !g.up.has(i));
      this.reveal(id, { kind: 'middle', slot });
    }
  }

  dispose(): void {
    this.clearTimer();
  }

  // ───────────────────────────── Vue personnalisée ─────────────────────────────

  private gameView(g: Game, viewer: string): GameView {
    const now = Date.now();
    const seated = g.order.includes(viewer);
    const note = this.notes.get(viewer);
    const choice = g.swap?.choices.get(viewer);
    return {
      mode: g.mode,
      teams: g.teams ? g.teams.map((t) => [...t]) : null,
      order: [...g.order],
      stage: g.stage,
      turnId: g.current,
      turnEndsAt: g.stage === 'play' ? this.turnEndsAt : 0,
      seq: g.seq,
      middle: g.middle.map((v, i) => (v === null ? null : g.up.has(i) ? v : 'hidden')),
      reveals: g.reveals.map((r) => ({ value: r.value, src: { ...r.src } })),
      outcome: g.outcome ? { ...g.outcome } : null,
      hand: seated ? [...g.hand(viewer)] : null,
      swap: g.swap
        ? { teams: [...g.swap.teams], waiting: g.swapWaiting(), endsAt: this.swapEndsAt, reason: g.swap.reason }
        : null,
      myGift: choice ?? null,
      swapNote: note && note.until > now ? { ...note } : null,
      victory: g.victory ? { ...g.victory, ids: [...g.victory.ids], values: [...g.victory.values] } : null,
      events: g.events.filter((e) => e.until > now).map((e) => ({ ...e, teams: e.teams ? [...e.teams] : undefined })),
    };
  }

  viewFor(viewerId: string): RoomView {
    const g = this.phase === 'playing' ? this.game : null;
    const seated = this.seated;
    const preview = this.phase === 'lobby' && this.teamsActive();
    const waiting = g?.stage === 'swap' ? new Set(g.swapWaiting()) : null;
    return {
      code: this.code,
      phase: this.phase,
      me: viewerId,
      hostId: this.hostId,
      settings: { ...this.settings },
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isBot: p.isBot,
        isHost: p.id === this.hostId,
        connected: p.isBot || p.connected,
        autopilot: !p.isBot && p.status === 'playing' && this.isAuto(p),
        status: p.status,
        hand: g && g.hands.has(p.id) ? g.hand(p.id).length : null,
        trios: g ? [...(g.trios.get(p.id) ?? [])] : [],
        team: g ? (g.teamOf.get(p.id) ?? null) : preview && seated.includes(p) ? Math.floor(seated.indexOf(p) / 2) : null,
        wins: this.wins.get(p.id) ?? 0,
        swapping: !!waiting?.has(p.id),
      })),
      game: g ? this.gameView(g, viewerId) : null,
      final: this.final,
      serverNow: Date.now(),
    };
  }
}
