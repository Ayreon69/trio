// Fin de partie : les trios gagnants, la table enfin dévoilée (les mains et le centre), les victoires et la revanche.
import confetti from 'canvas-confetti';
import { motion } from 'framer-motion';
import { LogOut, RotateCcw, Trophy } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { RoomView } from '../../../shared/protocol';
import { TrioCard } from '../components/Card';
import { Avatar, Backdrop, Button, Logo, TeamDot, teamName } from '../components/Ui';
import { sfx } from '../lib/sound';
import { reasonText, winners } from '../lib/text';
import { cls, reducedMotion } from '../lib/util';
import { leaveRoom, send } from '../net';

export function Final({ view }: { view: RoomView }) {
  const final = view.final!;
  const v = final.victory;
  const isHost = view.hostId === view.me;
  const iWon = v.ids.includes(view.me);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    sfx.fanfare(iWon);
    if (reducedMotion()) return;
    const t = window.setTimeout(() => {
      void confetti({ particleCount: iWon ? 180 : 90, spread: 100, origin: { y: 0.3 }, colors: ['#ff5fa2', '#ffd23f', '#19b3b1', '#4a6cff', '#b5e04a', '#1f1b2e'], scalar: 0.95, disableForReducedMotion: true });
    }, 400);
    return () => window.clearTimeout(t);
  }, [iWon]);

  const w = winners(view, v);
  const players = [...final.players].sort((a, b) => Number(b.winner) - Number(a.winner) || b.trios.length - a.trios.length);

  return (
    <Backdrop quiet>
      <div className="final">
        <header className="final-top">
          <Logo size="sm" />
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter
          </Button>
        </header>

        <motion.section className="final-hero" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }}>
          <span className="eyebrow">
            Partie terminée en {final.turns} tour{final.turns > 1 ? 's' : ''}
            {v.team !== null && ` · ${teamName(v.team)}`}
          </span>
          <h1>
            {w.who} {w.verb} !
          </h1>
          <p className="final-reason">{reasonText(v)}</p>
        </motion.section>

        <div className="final-trios" aria-label="Les trios gagnants">
          {v.values.map((value, i) => (
            <motion.div key={`${value}-${i}`} className="trio-stack is-big" initial={{ y: 30, opacity: 0, rotate: -6 }} animate={{ y: 0, opacity: 1, rotate: (i - (v.values.length - 1) / 2) * 6 }} transition={{ delay: 0.3 + i * 0.12, type: 'spring', stiffness: 170, damping: 14 }}>
              {[0, 1, 2].map((k) => (
                <TrioCard key={k} value={value} links={final.mode === 'piquant'} />
              ))}
            </motion.div>
          ))}
        </div>

        <section className="panel final-table">
          <h3>La table dévoilée</h3>
          <ul className="final-list">
            {players.map((p) => (
              <li key={p.id} className={cls('final-row', p.winner && 'is-winner', p.id === view.me && 'is-me')}>
                <div className="final-who">
                  <Avatar avatar={p.avatar} className="player-avatar" />
                  <b>{p.id === view.me ? 'Toi' : p.name}</b>
                  <TeamDot team={p.team} />
                  {p.wins > 0 && (
                    <span className="final-wins" title="Parties gagnées à cette table">
                      <Trophy size={13} aria-hidden /> {p.wins}
                    </span>
                  )}
                </div>
                <div className="final-cards">
                  <span className="final-label">Trios</span>
                  {p.trios.length ? (
                    <span className="chip-row">
                      {p.trios.map((t, i) => (
                        <span key={i} className="trio-chip">
                          <TrioCard value={t} mini />
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="muted small">aucun</span>
                  )}
                </div>
                <div className="final-cards">
                  <span className="final-label">En main</span>
                  {p.hand.length ? (
                    <span className="mini-row">
                      {p.hand.map((c, i) => (
                        <TrioCard key={i} value={c} mini />
                      ))}
                    </span>
                  ) : (
                    <span className="muted small">plus rien</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {final.middle.length > 0 && (
            <div className="final-cards final-middle">
              <span className="final-label">Au centre</span>
              <span className="mini-row">
                {final.middle.map((c, i) => (
                  <TrioCard key={i} value={c} mini />
                ))}
              </span>
            </div>
          )}
        </section>

        <div className="lobby-cta">
          {isHost ? (
            <Button variant="primary" className="btn-lg btn-wide" icon={<RotateCcw size={20} />} onClick={() => void send('game:restart')}>
              Rejouer
            </Button>
          ) : (
            <div className="waiting" role="status">
              <span className="spinner" /> En attente de la revanche…
            </div>
          )}
        </div>
      </div>
    </Backdrop>
  );
}
