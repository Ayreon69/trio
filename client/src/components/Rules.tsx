// Les règles, lisibles en deux minutes et consultables à tout moment.
import { ArrowDownNarrowWide, ArrowUpNarrowWide, Brain, LayoutGrid, Repeat2, Trophy, Users } from 'lucide-react';
import { useStore } from '../store';
import { TrioCard } from './Card';
import { Modal } from './Ui';

export function RulesModal() {
  const open = useStore((s) => s.rulesOpen);
  const setOpen = useStore((s) => s.setRulesOpen);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Les règles" wide>
      <div className="rules">
        <section className="rule-hero">
          <div className="rule-fan" aria-hidden>
            <TrioCard value={9} />
            <TrioCard value={9} />
            <TrioCard value={9} />
          </div>
          <p>
            36 cartes, de 1 à 12, en <b>trois exemplaires</b>. Le but : réunir <b>trois cartes identiques</b>, un trio. Chacun tient sa main rangée de la plus petite à la plus grande ; le reste est posé face cachée au centre.
          </p>
        </section>

        <section>
          <h3>À ton tour, révèle des cartes une par une</h3>
          <ul className="rule-actions">
            <li>
              <ArrowDownNarrowWide size={20} aria-hidden />
              <div>
                Demande à un joueur <b>sa plus petite</b> ou <b>sa plus grande</b> carte. Tu peux aussi révéler la tienne, mais toujours un bout de ta main, jamais le milieu.
              </div>
            </li>
            <li>
              <LayoutGrid size={20} aria-hidden />
              <div>
                Ou retourne <b>une carte du centre</b>, celle que tu veux.
              </div>
            </li>
            <li>
              <ArrowUpNarrowWide size={20} aria-hidden />
              <div>Tu peux refaire la même demande : après sa plus grande, la plus grande de ce qu'il lui reste.</div>
            </li>
          </ul>
        </section>

        <section className="rule-split">
          <div className="rule-case">
            <h3>
              <Repeat2 size={18} aria-hidden /> Raté
            </h3>
            <p>Dès que deux nombres diffèrent, ton tour s'arrête. Toutes les cartes révélées retournent à leur place : au centre face cachée, ou dans la main de leur propriétaire.</p>
          </div>
          <div className="rule-case">
            <h3>
              <Trophy size={18} aria-hidden /> Trio !
            </h3>
            <p>Trois nombres identiques : tu gagnes le trio et le poses devant toi, face visible. C'est ensuite au joueur suivant.</p>
          </div>
        </section>

        <section className="rule-warn">
          <h3>
            <Brain size={18} aria-hidden /> Tout est dans la mémoire
          </h3>
          <p>Une carte révélée ne reste visible qu'un instant, puis elle retourne à sa place. Retiens qui a quoi, et où sont les cartes du centre : personne ne te le rappellera.</p>
        </section>

        <section>
          <h3>Pour gagner</h3>
          <div className="rule-goals">
            <div>
              <b>Simple</b>
              <span>3 trios, n'importe lesquels.</span>
            </div>
            <div>
              <b>Piquant</b>
              <span>
                2 trios <b>liés</b> : leur somme ou leur différence fait 7 (le 2 et le 5, le 2 et le 9…). Les nombres liés sont écrits en bas de chaque carte.
              </span>
            </div>
            <div className="is-seven">
              <TrioCard value={7} mini />
              <span>Dans les deux modes, le trio de 7 gagne tout de suite !</span>
            </div>
          </div>
        </section>

        <section>
          <h3>
            <Users size={18} aria-hidden /> Par équipes de deux (à 4 ou 6)
          </h3>
          <p>
            Toutes les cartes sont distribuées, rien au centre. Les partenaires s'assoient face à face et mettent leurs trios en commun. Au début, ils peuvent échanger une carte en secret, puis à nouveau chaque fois que l'autre équipe gagne un trio. C'est leur seule façon de communiquer : pas un mot, pas un clin d'œil !
          </p>
        </section>

        <section className="rule-memory">
          <h3>Dans cette version</h3>
          <ul>
            <li>Touche « petite » ou « grande » sous la main d'un joueur, une carte du centre, ou un bout de ta main.</li>
            <li>Les cartes révélées restent visibles le temps de les retenir, puis repartent. Aucun historique n'est gardé.</li>
            <li>Un joueur absent plus de 20 secondes est remplacé par le pilote automatique jusqu'à son retour. Il ne se souvient de rien !</li>
          </ul>
        </section>

        <p className="rule-foot">
          D'après <i>Trio</i>, le jeu de Kaya Miyano (Cocktail Games). Création de fans, non officielle, avec ses propres visuels.
        </p>
      </div>
    </Modal>
  );
}
