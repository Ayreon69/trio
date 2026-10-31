// Simulation : des bots entre eux, pour juger leur niveau et la durée des parties (npx tsx test/sim.ts 200).
import type { Mode } from '../shared/protocol';
import { Memory, NO_MEMORY, botReveal, botSwap, randomSkill } from '../server/bots';
import { Game } from '../server/game';

const N = Number(process.argv[2] ?? 200);

function play(order: string[], mode: Mode, teams: string[][] | null, memory: (id: string) => Memory): { game: Game; ms: number; decisions: number } {
  const g = new Game(order, { mode, teams });
  const mem = new Map(order.map((id) => [id, memory(id)]));
  let ms = 0;
  let decisions = 0;
  for (let guard = 0; guard < 6000; guard++) {
    if (g.stage === 'over') break;
    if (g.stage === 'swap') {
      for (const id of g.swapWaiting()) g.swapChoose(id, botSwap(g, id));
      for (const r of g.takeSwaps()) for (const m of mem.values()) m.observeSwap(r);
      continue;
    }
    if (g.stage === 'resolve') {
      const reveals = [...g.reveals];
      const trio = g.outcome!.kind === 'trio';
      g.settle();
      for (const m of mem.values()) m.observeTurn(reveals, trio);
      continue;
    }
    const id = g.current!;
    const t = performance.now();
    const src = botReveal(g, mem.get(id)!);
    ms += performance.now() - t;
    decisions++;
    const err = g.reveal(id, src);
    if (err) throw new Error(`${err} ${JSON.stringify(src)}`);
  }
  if (g.stage !== 'over') throw new Error('partie sans fin');
  return { game: g, ms, decisions };
}

for (const mode of ['simple', 'piquant'] as Mode[]) {
  for (const n of [3, 4, 5, 6]) {
    const order = Array.from({ length: n }, (_, i) => `p${i}`);
    let turns = 0;
    let ms = 0;
    let decisions = 0;
    const reasons: Record<string, number> = { seven: 0, three: 0, linked: 0 };
    let sharpWins = 0;
    for (let k = 0; k < N; k++) {
      const r = play(order, mode, null, (id) => new Memory(randomSkill(), id));
      turns += r.game.turns;
      ms += r.ms;
      decisions += r.decisions;
      reasons[r.game.victory!.reason]++;
      // p0 a une bonne mémoire, les autres jouent sans rien retenir : la mémoire doit payer.
      const duel = play(order, mode, null, (id) => new Memory(id === 'p0' ? randomSkill() : NO_MEMORY, id));
      if (duel.game.victory!.ids.includes('p0')) sharpWins++;
    }
    console.log(
      `${mode} ${n} joueurs : ${(turns / N).toFixed(1)} tours/partie, ${(ms / decisions).toFixed(1)} ms/coup, victoires ${Object.entries(reasons)
        .map(([k, v]) => `${k} ${Math.round((v / N) * 100)} %`)
        .join(', ')} ; le bot à mémoire gagne ${Math.round((sharpWins / N) * 100)} % (hasard : ${Math.round(100 / n)} %)`,
    );
  }
  for (const n of [4, 6]) {
    const order = Array.from({ length: n }, (_, i) => `p${i}`);
    const half = n / 2;
    const teams = Array.from({ length: half }, (_, i) => [order[i], order[i + half]]);
    let turns = 0;
    for (let k = 0; k < N; k++) turns += play(order, mode, teams, (id) => new Memory(randomSkill(), id)).game.turns;
    console.log(`${mode} ${n} joueurs en équipes : ${(turns / N).toFixed(1)} tours/partie`);
  }
}
