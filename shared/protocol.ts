// Contrat partagé entre le serveur et le client : vues de table, réglages, constantes et règles des cartes.

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;

/** Les 36 cartes : de 1 à 12, trois exemplaires de chaque. */
export const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const COPIES = 3;
export const DECK_SIZE = VALUES.length * COPIES;
/** Le trio de 7 gagne la partie, quel que soit le mode. */
export const SEVEN = 7;

/** La donne du livret : cartes par joueur et cartes au centre, selon le nombre de joueurs. */
export const DEAL: Record<number, { hand: number; middle: number }> = {
  3: { hand: 9, middle: 9 },
  4: { hand: 7, middle: 8 },
  5: { hand: 6, middle: 6 },
  6: { hand: 5, middle: 6 },
};
/** En équipes, tout est distribué : rien au centre. */
export const TEAM_DEAL: Record<number, { hand: number; middle: number }> = {
  4: { hand: 9, middle: 0 },
  6: { hand: 6, middle: 0 },
};
export const TEAM_SIZES = [4, 6] as const;

/** Mode piquant : deux nombres sont liés quand leur somme ou leur différence fait 7 (2 et 5, 2 et 9…). */
export function linked(value: number): number[] {
  return VALUES.filter((w) => w !== value && (w + value === 7 || Math.abs(w - value) === 7));
}
export function areLinked(a: number, b: number): boolean {
  return a !== b && (a + b === 7 || Math.abs(a - b) === 7);
}

export type Mode = 'simple' | 'piquant';
export const MODES: Mode[] = ['simple', 'piquant'];
/** Temps pour révéler chaque carte, en secondes (0 : sans limite). */
export const THINK_OPTIONS = [0, 20, 40] as const;
export type ThinkTime = (typeof THINK_OPTIONS)[number];

export interface Settings {
  mode: Mode;
  /** Jeu en équipes de deux, à 4 ou 6 joueurs. */
  teams: boolean;
  think: ThinkTime;
}

export const AVATARS = ['flamant', 'pasteque', 'cactus', 'licorne', 'citron', 'poulpe', 'casque', 'roller', 'glace', 'perroquet', 'disco', 'cerise'] as const;
export const EMOTES = ['🧠', '😱', '😅', '👏', '🤫', '🔥'] as const;
export const TAUNTS = ['Je m’en souviens !', 'Mince…', 'Bien vu !', 'Il est où ?', 'Trop facile', 'Le 7 est à moi'] as const;
export const TEAM_NAMES = ['rose', 'turquoise', 'jaune'] as const;

/** Où l'on révèle une carte : au centre, ou la plus petite / la plus grande de la main d'un joueur. */
export type End = 'low' | 'high';
export type Source = { kind: 'middle'; slot: number } | { kind: 'hand'; player: string; end: End };

export interface Reveal {
  value: number;
  src: Source;
}

/** Une carte du centre telle que tout le monde la voit : sa valeur si elle est révélée ce tour-ci, 'hidden' face cachée, null si elle est partie dans un trio. */
export type Slot = number | 'hidden' | null;

export type PlayerStatus = 'lobby' | 'playing' | 'spectator';

export interface PlayerView {
  id: string;
  name: string;
  avatar: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  autopilot: boolean;
  status: PlayerStatus;
  /** Cartes en main, sans celles révélées ce tour-ci (null hors partie). */
  hand: number | null;
  /** Les trios qu'il a gagnés. */
  trios: number[];
  /** Son équipe (au salon : les équipes prévues), null en solo. */
  team: number | null;
  /** Parties gagnées à cette table. */
  wins: number;
  /** Il doit encore choisir sa carte à échanger. */
  swapping: boolean;
}

export type Stage = 'swap' | 'play' | 'resolve' | 'over';

export type EventKind = 'start' | 'trio' | 'miss' | 'swap';

/** Ce qui vient de se passer. Le serveur ne garde ces événements que quelques secondes : ce n'est pas un historique. */
export interface GameEvent {
  id: number;
  at: number;
  until: number;
  kind: EventKind;
  by?: string;
  /** Trio : sa valeur. */
  value?: number;
  /** Échange : les équipes qui ont échangé une carte. */
  teams?: number[];
}

export interface Outcome {
  kind: 'miss' | 'trio';
  value: number;
}

export type VictoryReason = 'seven' | 'three' | 'linked';

export interface Victory {
  ids: string[];
  team: number | null;
  reason: VictoryReason;
  /** Les trios qui font gagner : le 7, les trois trios, ou les deux trios liés. */
  values: number[];
}

export interface SwapView {
  teams: number[];
  /** Ceux qui n'ont pas encore choisi. */
  waiting: string[];
  endsAt: number;
  reason: 'start' | 'trio';
}

/** Ce que tu as donné et reçu au dernier échange, visible de toi seul quelques secondes. */
export interface SwapNote {
  gave: number | null;
  got: number | null;
  partner: string;
  until: number;
}

export interface GameView {
  mode: Mode;
  /** Les équipes (ids), ou null en solo. */
  teams: string[][] | null;
  order: string[];
  stage: Stage;
  /** À qui de jouer (null pendant un échange et à la fin). */
  turnId: string | null;
  turnEndsAt: number;
  /** Numéro de l'action : une action envoyée pour un état déjà passé est refusée. */
  seq: number;
  middle: Slot[];
  /** Les cartes révélées ce tour-ci, dans l'ordre. Elles retournent à leur place à la fin du tour. */
  reveals: Reveal[];
  outcome: Outcome | null;
  /** Ta main, de la plus petite à la plus grande, sans les cartes que tu as révélées ce tour-ci. */
  hand: number[] | null;
  swap: SwapView | null;
  /** Ta carte choisie pour l'échange en cours. */
  myGift: number | 'pass' | null;
  swapNote: SwapNote | null;
  victory: Victory | null;
  events: GameEvent[];
}

export interface FinalPlayer {
  id: string;
  name: string;
  avatar: string;
  trios: number[];
  /** Les cartes qu'il avait encore en main, enfin dévoilées. */
  hand: number[];
  team: number | null;
  wins: number;
  winner: boolean;
}

export interface FinalView {
  mode: Mode;
  victory: Victory;
  turns: number;
  players: FinalPlayer[];
  /** Les cartes restées au centre. */
  middle: number[];
}

export interface RoomView {
  code: string;
  phase: 'lobby' | 'playing' | 'finished';
  me: string;
  hostId: string;
  settings: Settings;
  players: PlayerView[];
  game: GameView | null;
  final: FinalView | null;
  serverNow: number;
}

export type Ack<T = unknown> = (res: { ok: boolean; error?: string; data?: T }) => void;

/** Une source reçue du réseau, vérifiée dans sa forme (le moteur vérifie qu'elle existe). */
export function parseSource(raw: unknown): Source | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'middle') return typeof r.slot === 'number' && Number.isInteger(r.slot) && r.slot >= 0 && r.slot < 12 ? { kind: 'middle', slot: r.slot } : null;
  if (r.kind === 'hand') return typeof r.player === 'string' && (r.end === 'low' || r.end === 'high') ? { kind: 'hand', player: r.player, end: r.end } : null;
  return null;
}

export function sameSource(a: Source, b: Source): boolean {
  if (a.kind === 'middle') return b.kind === 'middle' && a.slot === b.slot;
  return b.kind === 'hand' && a.player === b.player && a.end === b.end;
}
