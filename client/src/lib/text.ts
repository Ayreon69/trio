// Les mots de la table : noms, objectifs, ce qui vient de se passer et d'où vient chaque carte.
import { TEAM_NAMES, type GameEvent, type Mode, type RoomView, type Source, type Victory } from '../../../shared/protocol';

export function nameOf(view: RoomView, id: string | undefined | null): string {
  if (!id) return '?';
  if (id === view.me) return 'toi';
  return view.players.find((p) => p.id === id)?.name ?? '?';
}

/** « Léa, Zino et Sam ». */
export function listing(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

/** « un 7 », « un 11 ». */
export function un(value: number): string {
  return `un ${value}`;
}

export function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function goalText(mode: Mode): string {
  return mode === 'simple' ? '3 trios, ou le trio de 7' : '2 trios liés, ou le trio de 7';
}

/** La même chose en très court, pour l'en-tête de la table. */
export function goalShort(mode: Mode): string {
  return mode === 'simple' ? '3 trios ou le 7' : '2 trios liés ou le 7';
}

/** D'où vient une carte révélée, en deux mots. */
export function sourceText(view: RoomView, src: Source): string {
  if (src.kind === 'middle') return 'centre';
  const who = src.player === view.me ? 'toi' : nameOf(view, src.player);
  return `${who} ${src.end === 'low' ? '↓' : '↑'}`;
}

export function sourceLong(view: RoomView, src: Source): string {
  if (src.kind === 'middle') return 'une carte du centre';
  const end = src.end === 'low' ? 'plus petite' : 'plus grande';
  return src.player === view.me ? `ta ${end}` : `la ${end} de ${nameOf(view, src.player)}`;
}

/** Les gagnants : « Tu gagnes », « Léa gagne », « Léa et toi gagnez ». */
export function winners(view: RoomView, v: Victory): { who: string; verb: string } {
  const names = v.ids.map((id) => (id === view.me ? 'toi' : nameOf(view, id)));
  if (v.ids.length === 1) return v.ids[0] === view.me ? { who: 'Tu', verb: 'gagnes' } : { who: names[0], verb: 'gagne' };
  const mine = v.ids.includes(view.me);
  const others = names.filter((n) => n !== 'toi');
  return mine ? { who: `${listing(others)} et toi`, verb: 'gagnez' } : { who: listing(names), verb: 'gagnent' };
}

export function reasonText(v: Victory): string {
  if (v.reason === 'seven') return 'avec le trio de 7';
  if (v.reason === 'three') return `avec trois trios : ${listing(v.values.map(String))}`;
  return `avec deux trios liés : ${v.values[0]} et ${v.values[1]}`;
}

/** Ce qui vient de se passer, en une phrase ; null pour ce qui se voit déjà ailleurs. */
export function eventText(view: RoomView, e: GameEvent): string | null {
  const mine = e.by === view.me;
  switch (e.kind) {
    case 'start':
      return mine ? 'Tu commences !' : `${nameOf(view, e.by)} commence.`;
    case 'trio':
      return mine ? `Tu gagnes le trio de ${e.value} !` : `${nameOf(view, e.by)} gagne le trio de ${e.value}.`;
    case 'swap':
      if (!e.teams?.length) return 'Pas d’échange cette fois.';
      return e.teams.length === 1 ? `Équipe ${TEAM_NAMES[e.teams[0]]} : échange secret.` : 'Échanges secrets entre partenaires.';
    case 'miss':
      return null;
  }
}
