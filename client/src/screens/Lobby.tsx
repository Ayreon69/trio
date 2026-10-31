// Salon : partage de la table, joueurs (et équipes), réglages de l'hôte et lancement.
import { motion } from 'framer-motion';
import { BookOpen, Bot, Check, Copy, Crown, LogOut, Play, QrCode, Share2, Shuffle, Trophy, UserX } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS, TEAM_SIZES, THINK_OPTIONS, type Mode, type PlayerView, type RoomView, type ThinkTime } from '../../../shared/protocol';
import { TrioCard } from '../components/Card';
import { Avatar, Backdrop, Button, Logo, Modal, Pill, Segmented, TeamDot, teamName } from '../components/Ui';
import { goalText } from '../lib/text';
import { cls, shareUrl } from '../lib/util';
import { leaveRoom, send } from '../net';
import { useStore } from '../store';

function PlayerRow({ view, p, i, isHost }: { view: RoomView; p: PlayerView; i: number; isHost: boolean }) {
  return (
    <motion.li className={cls('player-row', p.id === view.me && 'is-me')} initial={{ x: -10, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.03 }}>
      <Avatar avatar={p.avatar} className="player-avatar" />
      <span className="player-name">
        {p.name}
        {p.id === view.me && <span className="muted"> (toi)</span>}
      </span>
      {p.wins > 0 && (
        <Pill tone="yellow" className="wins-pill">
          <Trophy size={12} aria-hidden /> {p.wins}
        </Pill>
      )}
      {p.isHost && (
        <Pill tone="pink">
          <Crown size={12} aria-hidden /> Hôte
        </Pill>
      )}
      {p.isBot && <Pill tone="teal">Bot</Pill>}
      {!p.connected && <Pill>Hors ligne</Pill>}
      {isHost && p.id !== view.me && (
        <button type="button" className="icon-btn" aria-label={`Retirer ${p.name}`} onClick={() => void send('room:kick', { playerId: p.id })}>
          <UserX size={18} />
        </button>
      )}
    </motion.li>
  );
}

export function Lobby({ view }: { view: RoomView }) {
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const isHost = view.hostId === view.me;
  const seated = view.players.filter((p) => p.status !== 'spectator');
  const spectators = view.players.filter((p) => p.status === 'spectator');
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(false);
  const url = shareUrl(view.code);
  const host = view.players.find((p) => p.id === view.hostId);
  const s = view.settings;
  const teamsOk = (TEAM_SIZES as readonly number[]).includes(seated.length);
  const teamsShown = s.teams && teamsOk;
  const blocked = seated.length < MIN_PLAYERS ? `Il faut au moins ${MIN_PLAYERS} joueurs` : s.teams && !teamsOk ? 'En équipes : 4 ou 6 joueurs' : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      useStore.getState().showToast(`Lien : ${url}`, 'info');
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Trio', text: `Rejoins ma table de Trio (code ${view.code}) !`, url });
      } catch {
        /* partage annulé */
      }
    } else void copy();
  };

  const teams = teamsShown ? [...new Set(seated.map((p) => p.team ?? 0))].sort().map((t) => seated.filter((p) => p.team === t)) : [];

  return (
    <Backdrop quiet>
      <div className="lobby">
        <header className="lobby-top">
          <Logo size="sm" />
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter
          </Button>
        </header>

        <motion.section className="code-panel" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <span className="eyebrow">Code de la table</span>
          <div className="big-code" aria-label={`Code ${view.code.split('').join(' ')}`}>
            {view.code.split('').map((c, i) => (
              <motion.span key={i} className={`is-c${i}`} initial={{ y: -18, rotate: -8 }} animate={{ y: 0, rotate: i % 2 ? 4 : -4 }} transition={{ delay: i * 0.06, type: 'spring', stiffness: 260, damping: 14 }}>
                {c}
              </motion.span>
            ))}
          </div>
          <div className="share-row">
            <Button variant="primary" icon={<Share2 size={18} />} onClick={share}>
              Inviter des amis
            </Button>
            <Button icon={copied ? <Check size={18} /> : <Copy size={18} />} onClick={copy}>
              {copied ? 'Lien copié !' : 'Copier le lien'}
            </Button>
            <Button icon={<QrCode size={18} />} onClick={() => setQr(true)} aria-label="Afficher le QR code">
              QR
            </Button>
          </div>
        </motion.section>

        <div className="lobby-grid">
          <section className="panel">
            <div className="panel-head">
              <h3>
                Joueurs <span className="muted">{seated.length}/{MAX_PLAYERS}</span>
              </h3>
              {isHost && (
                <Button variant="soft" icon={<Bot size={18} />} disabled={seated.length >= MAX_PLAYERS} onClick={() => void send('room:addBot')}>
                  Ajouter un bot
                </Button>
              )}
            </div>
            {teamsShown ? (
              <div className="team-boxes">
                {teams.map((members, t) => (
                  <div key={t} className={cls('team-box', `is-team${t}`)}>
                    <span className="team-title">
                      <TeamDot team={t} /> {teamName(t)}
                    </span>
                    <ul className="player-list">
                      {members.map((p, i) => (
                        <PlayerRow key={p.id} view={view} p={p} i={i} isHost={isHost} />
                      ))}
                    </ul>
                  </div>
                ))}
                {isHost && (
                  <Button variant="soft" icon={<Shuffle size={18} />} onClick={() => void send('room:teams')}>
                    Mélanger les équipes
                  </Button>
                )}
              </div>
            ) : (
              <ul className="player-list">
                {seated.map((p, i) => (
                  <PlayerRow key={p.id} view={view} p={p} i={i} isHost={isHost} />
                ))}
                {Array.from({ length: Math.max(0, MIN_PLAYERS - seated.length) }, (_, i) => (
                  <li key={`empty${i}`} className="player-row is-empty">
                    <span className="player-ghost">?</span>
                    <span className="player-name muted">En attente d'un joueur…</span>
                  </li>
                ))}
              </ul>
            )}
            {spectators.length > 0 && <p className="muted small">Spectateurs : {spectators.map((p) => p.name).join(', ')}</p>}
            <p className="muted small lobby-note">De 3 à 6 joueurs. Plus on est nombreux, plus il y a de cartes à retenir !</p>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Réglages</h3>
              {!isHost && <span className="muted small">choisis par {host?.name ?? "l'hôte"}</span>}
            </div>
            <span className="field-label">Pour gagner</span>
            <Segmented<Mode>
              label="Mode de jeu"
              value={s.mode}
              disabled={!isHost}
              onChange={(mode) => void send('room:settings', { mode })}
              options={[
                { value: 'simple', label: 'Simple', sub: '3 trios ou le 7' },
                { value: 'piquant', label: 'Piquant', sub: '2 trios liés ou le 7' },
              ]}
            />
            {s.mode === 'piquant' && (
              <div className="links-hint">
                <TrioCard value={2} links className="links-card" />
                <p className="muted small">
                  Deux nombres sont <b>liés</b> quand leur somme ou leur différence fait 7 : le 2 va avec le 5 et le 9. Ils sont écrits en bas de chaque carte.
                </p>
              </div>
            )}
            <span className="field-label">Équipes</span>
            <Segmented<boolean>
              label="Équipes"
              value={s.teams}
              disabled={!isHost}
              onChange={(teams) => void send('room:settings', { teams })}
              options={[
                { value: false, label: 'Chacun pour soi' },
                { value: true, label: 'Par deux', sub: 'à 4 ou 6' },
              ]}
            />
            {s.teams && (
              <p className="muted small lobby-note">
                {teamsOk
                  ? 'Toutes les cartes sont distribuées. Les partenaires échangent une carte en secret au début, puis chaque fois que l’équipe adverse gagne un trio. Interdit de se parler !'
                  : `Les équipes se jouent à 4 ou 6 : vous êtes ${seated.length}.`}
              </p>
            )}
            <span className="field-label">Temps pour chaque carte</span>
            <Segmented<ThinkTime>
              label="Temps pour chaque carte"
              value={s.think}
              disabled={!isHost}
              onChange={(think) => void send('room:settings', { think })}
              options={THINK_OPTIONS.map((t) => ({ value: t, label: t === 0 ? 'Sans limite' : `${t} s` }))}
            />
            <p className="muted small lobby-note">Le temps écoulé, le pilote automatique révèle une carte à ta place. Objectif : {goalText(s.mode)}.</p>
          </section>
        </div>

        <div className="lobby-cta">
          {isHost ? (
            <Button variant="primary" className="btn-lg btn-wide" icon={<Play size={20} />} disabled={!!blocked} onClick={() => void send('game:start')}>
              {blocked ?? `Lancer la partie (${seated.length} joueurs)`}
            </Button>
          ) : (
            <div className="waiting" role="status">
              <span className="spinner" /> En attente que {host?.name ?? "l'hôte"} lance la partie…
            </div>
          )}
          <Button variant="ghost" icon={<BookOpen size={18} />} onClick={() => setRulesOpen(true)}>
            Nouveau ? Les règles en 2 minutes
          </Button>
        </div>

        <Modal open={qr} onClose={() => setQr(false)} title={`Table ${view.code}`}>
          <div className="qr-box">
            <QRCodeSVG value={url} size={220} bgColor="#fffaf2" fgColor="#1f1b2e" level="M" includeMargin />
            <p className="muted small">Scanne pour rejoindre la table directement.</p>
            <code className="url-code">{url}</code>
          </div>
        </Modal>
      </div>
    </Backdrop>
  );
}
