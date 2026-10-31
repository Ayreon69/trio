// Sons synthétisés (Web Audio), aucun fichier à charger : cartes qui se retournent, paires, trios, ratés, cloche du tour et fanfares.
import { useStore } from '../store';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!useStore.getState().prefs.sound) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slide?: number; attack?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.1, t0 + (opts.attack ?? 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(dur: number, opts: { gain?: number; delay?: number; freq?: number; type?: BiquadFilterType; q?: number; fade?: number; sweep?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const buffer = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const data = buffer.getChannelData(0);
  const fade = opts.fade ?? 2;
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** fade;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = opts.type ?? 'bandpass';
  filter.frequency.setValueAtTime(opts.freq ?? 2400, t0);
  if (opts.sweep) filter.frequency.exponentialRampToValueAtTime(opts.sweep, t0 + dur);
  if (opts.q) filter.Q.value = opts.q;
  const g = a.createGain();
  g.gain.value = opts.gain ?? 0.25;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t0);
}

/** Do majeur, pour les petites fanfares. */
const C = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5, 1174.66, 1318.51];

export const sfx = {
  /** Une carte qu'on retourne : un claquement sec. */
  flip: () => {
    noise(0.05, { gain: 0.3, freq: 3200, q: 0.8, fade: 3 });
    tone(420, 0.06, { type: 'triangle', gain: 0.05, slide: 1.6 });
  },
  /** Deux pareilles : une note qui monte, l'espoir. */
  pair: () => {
    tone(C[4], 0.18, { type: 'triangle', gain: 0.07 });
    tone(C[7], 0.32, { type: 'triangle', gain: 0.07, delay: 0.09 });
  },
  /** Raté : deux notes qui descendent, et les cartes qui repartent. */
  miss: () => {
    tone(311.13, 0.22, { type: 'square', gain: 0.03 });
    tone(233.08, 0.4, { type: 'square', gain: 0.03, delay: 0.16, slide: 0.92 });
    noise(0.25, { gain: 0.1, freq: 1800, sweep: 500, delay: 0.5, fade: 1 });
  },
  /** Trio : un arpège qui grimpe et une pluie de confettis sonores. */
  trio: () => {
    [0, 2, 4, 7, 9].forEach((n, i) => tone(C[n], 0.4, { type: 'triangle', gain: 0.07, delay: i * 0.065 }));
    noise(0.35, { gain: 0.06, freq: 6500, delay: 0.3, fade: 1 });
  },
  /** À toi : deux notes claires. */
  turn: () => {
    tone(C[4], 0.5, { gain: 0.06 });
    tone(C[7], 0.7, { gain: 0.05, delay: 0.11 });
  },
  /** L'échange secret entre partenaires : deux cartes qui glissent. */
  swap: () => {
    noise(0.18, { gain: 0.16, freq: 900, sweep: 4200, q: 1.2, fade: 1 });
    noise(0.18, { gain: 0.16, freq: 4200, sweep: 900, q: 1.2, fade: 1, delay: 0.16 });
  },
  /** Fin de partie : la fanfare du vainqueur, plus modeste pour les autres. */
  fanfare: (won: boolean) => {
    const notes = won ? [0, 2, 4, 7, 4, 7, 9] : [4, 2, 0, 2, 4];
    notes.forEach((n, i) => tone(C[n], i === notes.length - 1 ? 0.9 : 0.22, { type: 'triangle', gain: 0.07, delay: i * 0.13 }));
  },
  tap: () => tone(880, 0.05, { gain: 0.025, slide: 1.4 }),
  /** Début de partie : on bat les cartes. */
  shuffle: () => {
    for (let i = 0; i < 8; i++) noise(0.04, { gain: 0.12, freq: 2600 + Math.random() * 1500, delay: i * 0.045, fade: 2 });
  },
};
