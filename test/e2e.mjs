// Test de bout en bout sur le serveur compilé : 3 humains (socket.io) + 2 bots jouent une partie complète,
// un spectateur arrive en cours de route, un joueur se déconnecte puis revient ; puis une revanche par équipes à 6.
// À chaque état reçu, on vérifie qu'aucune carte cachée ne fuite. Usage : npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['dist/server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), TR_FAST: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  server.kill();
  process.exit(1);
};
setTimeout(() => fail('délai dépassé (3 min)'), 180_000).unref();

await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('prêt') && resolve()));

const stats = { states: 0, reveals: 0, trios: new Set(), misses: 0, gifts: 0, passes: 0, refused: 0, swapRounds: new Set() };
const linked = (a, b) => a + b === 7 || Math.abs(a - b) === 7;

function client(name, { player = true, avatar = 'flamant' } = {}) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { name, socket, view: null, avatar, player, session: null, seen: new Map() };
  socket.on('state', (v) => {
    c.view = v;
    audit(c, v);
    if (c.player) play(c);
  });
  c.call = (event, payload = {}) => new Promise((res) => socket.emit(event, payload, res));
  return c;
}

/** Ce que reçoit chaque client : sa main seulement, le centre caché sauf pendant la révélation, aucun historique. */
function audit(c, v) {
  stats.states++;
  const json = JSON.stringify(v);
  for (const word of ['"token"', '"hands"', '"choices"', '"memories"', '"up"']) if (json.includes(word)) fail(`la vue contient ${word}`);
  for (const p of v.players) if (p.hand !== null && !Number.isInteger(p.hand)) fail(`la main de ${p.name} circule en clair`);
  const g = v.game;
  if (v.phase !== 'playing' || !g) return;
  const seated = g.order.includes(v.me);
  if (seated !== Array.isArray(g.hand)) fail(`${c.name} : main reçue à tort`);
  if (g.hand) {
    const count = v.players.find((p) => p.id === v.me).hand;
    if (g.hand.length !== count) fail(`${c.name} : sa main ne correspond pas au compte affiché`);
    if (g.hand.some((x, i) => i > 0 && x < g.hand[i - 1])) fail(`${c.name} : main mal rangée`);
  }
  if (g.reveals.length > 3) fail('plus de trois cartes révélées');
  if (g.events.length > 4) fail('trop d’événements : on dirait un historique');
  for (const e of g.events) if (e.until < v.serverNow - 50) fail('un événement expiré circule encore');
  g.middle.forEach((slot, i) => {
    if (slot === null || slot === 'hidden') return;
    if (!Number.isInteger(slot) || slot < 1 || slot > 12) fail(`centre invalide : ${slot}`);
    if (!g.reveals.some((r) => r.src.kind === 'middle' && r.src.slot === i && r.value === slot)) fail(`la carte ${i} du centre reste visible hors révélation`);
  });
  for (const r of g.reveals) if (!Number.isInteger(r.value) || r.value < 1 || r.value > 12) fail('révélation invalide');
  if (g.myGift !== null && (g.stage !== 'swap' || !seated)) fail('cadeau visible hors échange');
  if (g.swapNote && !seated) fail('un spectateur voit un échange secret');
  if (g.stage === 'swap') stats.swapRounds.add(`${g.seq}`);
  if (g.outcome?.kind === 'trio') stats.trios.add(`${g.seq}:${g.outcome.value}`);
  if (g.victory && g.stage !== 'over') fail('victoire annoncée avant la fin');
  // Le joueur se souvient du centre, comme à une vraie table.
  g.middle.forEach((slot, i) => (slot === null ? c.seen.delete(i) : Number.isInteger(slot) && c.seen.set(i, slot)));
}

const busy = new Set();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Un joueur moyen : il cherche au centre ce dont il se souvient, sinon il demande au hasard. */
function play(c) {
  const v = c.view;
  const g = v?.game;
  if (!v || v.phase !== 'playing' || !g || !g.order.includes(v.me)) return;
  const send = (key, event, payload) => {
    if (busy.has(key)) return;
    busy.add(key);
    c.socket.emit(event, payload, (res) => {
      if (!res?.ok) stats.refused++;
    });
  };
  if (g.stage === 'swap') {
    if (!g.swap.waiting.includes(v.me) || g.myGift !== null) return;
    const card = Math.random() < 0.2 || !g.hand.length ? 'pass' : pick(g.hand);
    card === 'pass' ? stats.passes++ : stats.gifts++;
    return send(`${c.name}:swap:${g.seq}`, 'game:swap', { card });
  }
  if (g.stage !== 'play' || g.turnId !== v.me) return;
  const want = g.reveals[0]?.value;
  const sources = [];
  g.middle.forEach((slot, i) => slot === 'hidden' && sources.push({ kind: 'middle', slot: i, score: want !== undefined && c.seen.get(i) === want ? 5 : 0 }));
  for (const id of g.order) {
    const n = v.players.find((p) => p.id === id).hand;
    if (!n) continue;
    if (id === v.me) {
      if (want !== undefined && g.hand[0] === want) sources.push({ kind: 'hand', player: id, end: 'low', score: 4 });
      if (want !== undefined && g.hand.at(-1) === want) sources.push({ kind: 'hand', player: id, end: 'high', score: 4 });
      if (want === undefined) sources.push({ kind: 'hand', player: id, end: pick(['low', 'high']), score: 0 });
      continue;
    }
    sources.push({ kind: 'hand', player: id, end: 'low', score: 0 }, { kind: 'hand', player: id, end: 'high', score: 0 });
  }
  if (!sources.length) return;
  const best = Math.max(...sources.map((s) => s.score));
  const { score, ...src } = pick(sources.filter((s) => s.score === best));
  stats.reveals++;
  send(`${c.name}:reveal:${g.seq}:${g.reveals.length}`, 'game:reveal', { src, seq: g.seq });
}

const waitPhase = (c, phase) =>
  new Promise((resolve) => {
    const check = setInterval(() => {
      if (c.view?.phase === phase) {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });

/** Le gagnant l'est pour la bonne raison, et ses trios sont réels. */
function checkFinal(final, { players, team }) {
  if (!final || final.players.length !== players) fail(`table finale incomplète (${final?.players.length})`);
  const v = final.victory;
  if (!v.ids.length) fail('aucun gagnant');
  if (team !== (v.team !== null)) fail('victoire d’équipe incohérente');
  const group = final.players.filter((p) => v.ids.includes(p.id));
  const trios = group.flatMap((p) => p.trios);
  if (v.reason === 'seven' && !trios.includes(7)) fail('victoire par le 7 sans trio de 7');
  if (v.reason === 'three' && trios.length < 3) fail('victoire à 3 trios sans 3 trios');
  if (v.reason === 'linked' && !trios.some((a) => trios.some((b) => linked(a, b)))) fail('victoire piquante sans trios liés');
  if (!group.every((p) => p.winner)) fail('gagnant mal marqué');
  const all = [...final.players.flatMap((p) => [...p.trios.flatMap((t) => [t, t, t]), ...p.hand]), ...final.middle].sort((a, b) => a - b);
  if (all.length !== 36) fail(`le paquet ne fait plus 36 cartes (${all.length})`);
  for (let n = 1; n <= 12; n++) if (all.filter((x) => x === n).length !== 3) fail(`il n'y a pas trois ${n}`);
  return v;
}

// ── Partie 1 : chacun pour soi, mode simple, 3 humains + 2 bots ──
const host = client('Ana');
await new Promise((r) => host.socket.on('connect', r));
const created = await host.call('room:create', { name: 'Ana', avatar: 'flamant', bots: 2 });
if (!created.ok) fail(`création : ${created.error}`);
const code = created.data.code;
const bob = client('Bob');
const chloe = client('Chloé');
await Promise.all([bob, chloe].map((c) => new Promise((r) => c.socket.on('connect', r))));
for (const c of [bob, chloe]) {
  const res = await c.call('room:join', { code, name: c.name, avatar: 'cactus' });
  if (!res.ok) fail(`arrivée de ${c.name} : ${res.error}`);
  c.session = res.data;
}
if (!(await host.call('room:settings', { mode: 'simple', think: 20 })).ok) fail('réglages refusés');
if ((await bob.call('room:settings', { mode: 'piquant' })).ok) fail('un invité a changé les réglages');
if ((await host.call('room:settings', { teams: true })).ok === false) fail('le réglage équipes est refusé');
if ((await host.call('game:start')).ok) fail('une partie en équipes à 5 a été lancée');
await host.call('room:settings', { teams: false });
const start = await host.call('game:start');
if (!start.ok) fail(`lancement : ${start.error}`);

// Un spectateur arrive en cours de partie : il voit les cartes révélées, rien d'autre.
await new Promise((r) => setTimeout(r, 300));
const watcher = client('Dora', { player: false, avatar: 'licorne' });
await new Promise((r) => watcher.socket.on('connect', r));
const joined = await watcher.call('room:join', { code, name: 'Dora', avatar: 'licorne' });
if (!joined.ok) fail(`spectateur : ${joined.error}`);
watcher.session = joined.data;
await new Promise((r) => setTimeout(r, 100));
if (watcher.view.players.find((p) => p.name === 'Dora')?.status !== 'spectator') fail('la retardataire devrait regarder');

// Bob se déconnecte un moment, puis revient avec sa session.
await new Promise((r) => setTimeout(r, 400));
bob.socket.disconnect();
await new Promise((r) => setTimeout(r, 900));
bob.socket.connect();
await new Promise((r) => bob.socket.on('connect', r));
const back = await bob.call('room:join', { code, playerId: bob.session.playerId, token: bob.session.token, resumeOnly: true });
if (!back.ok) fail(`retour de Bob : ${back.error}`);
const intruder = await chloe.call('room:join', { code, playerId: bob.session.playerId, token: 'faux', resumeOnly: true });
if (intruder.ok) fail('une session volée a été acceptée');

await waitPhase(host, 'finished');
const v1 = checkFinal(host.view.final, { players: 5, team: false });
const turns1 = host.view.final.turns;
const name = (id) => host.view.final.players.find((p) => p.id === id).name;
const winner1 = v1.ids.map(name).join(' et ');
if (!host.view.players.some((p) => p.wins === 1)) fail('la victoire n’est pas comptée');

// ── Partie 2 : revanche par équipes de deux, mode piquant, à 6 (Dora s'assoit) ──
if ((await bob.call('game:restart')).ok) fail('un invité a relancé la partie');
if (!(await host.call('game:restart')).ok) fail('revanche refusée');
await new Promise((r) => setTimeout(r, 150));
if (host.view.phase !== 'lobby') fail('la revanche ne ramène pas au salon');
watcher.player = true;
const seatedNow = host.view.players.filter((p) => p.status !== 'spectator').length;
if (seatedNow !== 6) fail(`6 joueurs attendus au salon, ${seatedNow} trouvés`);
if (!(await host.call('room:settings', { mode: 'piquant', teams: true, think: 0 })).ok) fail('réglages d’équipe refusés');
if (!(await host.call('room:teams')).ok) fail('mélange des équipes refusé');
await new Promise((r) => setTimeout(r, 100));
const preview = new Map(host.view.players.filter((p) => p.status !== 'spectator').map((p) => [p.id, p.team]));
if ([...preview.values()].some((t) => t === null) || new Set(preview.values()).size !== 3) fail('aperçu des équipes incorrect');
const before = stats.swapRounds.size;
if (!(await host.call('game:start')).ok) fail('lancement de la partie en équipes refusé');
await new Promise((r) => setTimeout(r, 50));
const g2 = host.view.game;
if (!g2 || g2.middle.length !== 0) fail('en équipes, il ne doit rien rester au centre');
if (!g2.teams || g2.teams.length !== 3) fail('trois équipes attendues');
// Chacun garde l'équipe (et la couleur) vue au salon.
for (const p of host.view.players) if (preview.has(p.id) && p.team !== preview.get(p.id)) fail(`${p.name} a changé d'équipe au lancement`);
// Les partenaires sont assis face à face.
for (const [a, b] of g2.teams) if (Math.abs(g2.order.indexOf(a) - g2.order.indexOf(b)) !== 3) fail('des partenaires sont côte à côte');

await waitPhase(host, 'finished');
const v2 = checkFinal(host.view.final, { players: 6, team: true });
if (stats.swapRounds.size === before) fail('aucun échange entre partenaires n’a eu lieu');
const winner2 = v2.ids.map(name).join(' et ');

console.log(`✓ partie 1 (simple, 5 joueurs) : ${turns1} tours, gagnée par ${winner1} (${v1.reason}).`);
console.log(`✓ partie 2 (piquant, 3 équipes) : ${host.view.final.turns} tours, gagnée par ${winner2} (${v2.reason}).`);
console.log(
  `  ${stats.reveals} cartes révélées par les humains, ${stats.trios.size} trios vus, ${stats.gifts} cadeaux et ${stats.passes} refus d'échange, ${stats.refused} coups refusés (tour passé), ${stats.states} états vérifiés sans fuite.`,
);
for (const c of [host, bob, chloe, watcher]) c.socket.close();
server.kill();
process.exit(0);
