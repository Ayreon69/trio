# Trio

**Plus petite ? Plus grande ? Retiens tout, et réunis trois cartes pareilles.**

👉 **Jouer : https://trio-k6b5.onrender.com** (la première ouverture peut prendre jusqu'à une minute, le temps que le serveur gratuit se réveille)

Jeu de cartes multijoueur en ligne, à jouer entre amis depuis un navigateur, sur téléphone ou ordinateur, sans compte ni installation.
D'après *Trio*, le jeu de Kaya Miyano édité par Cocktail Games (création de fans, non officielle, avec ses propres visuels).

## Règles en bref

- De 3 à 6 joueurs. 36 cartes de 1 à 12, en trois exemplaires.
- Chacun tient sa main rangée de la plus petite à la plus grande ; le reste est posé face cachée au centre (à 3 : 9 cartes chacun et 9 au centre ; à 4 : 7 et 8 ; à 5 : 6 et 6 ; à 6 : 5 et 6).
- À son tour, on révèle des cartes une par une :
  - **la plus petite ou la plus grande carte d'un joueur**, soi compris (toujours un bout de sa main, jamais le milieu) ;
  - **ou une carte du centre**, celle qu'on veut.
- Dès que deux nombres diffèrent, le tour s'arrête et toutes les cartes révélées retournent à leur place.
- Trois nombres identiques : on gagne le **trio** et on le pose devant soi.
- **Simple** : 3 trios pour gagner. **Piquant** : 2 trios **liés** (leur somme ou leur différence fait 7). Dans les deux modes, **le trio de 7 gagne tout de suite**.
- **Par équipes de deux**, à 4 ou 6 : tout est distribué, les partenaires s'assoient face à face et mettent leurs trios en commun. Ils échangent une carte en secret au début, puis chaque fois que l'autre équipe gagne un trio.

Les règles suivent le livret Cocktail Games : distribution selon le nombre de joueurs, révélations, trio, modes simple et piquant, trio de 7, variante par équipes et échanges.

Sont des choix de ce jeu :

- **Une carte révélée reste visible le temps du tour, puis quelques secondes après la fin**, le temps de la retenir. Ensuite elle retourne à sa place. Aucun historique n'est gardé ni envoyé au client : tout se joue de mémoire.
- **Le centre garde ses places** : chaque carte du centre reste au même endroit toute la partie, pour qu'on se souvienne de chacune par sa position.
- **Le temps pour chaque carte est réglable** par l'hôte (sans limite, 20 ou 40 secondes) ; le temps écoulé, le pilote automatique révèle à ta place.
- **Un joueur absent plus de 20 secondes est remplacé par le pilote automatique** jusqu'à son retour. Le pilote ne se souvient de rien.
- **Un échange que personne ne fait** passe au bout de 45 secondes.

## Les bots

Ils ne voient que ce qu'un joueur voit : les cartes révélées, les trios posés, et, pour leurs propres échanges, la carte donnée et la carte reçue. Ils s'en souviennent, avec un peu d'oubli :

- ils retiennent les cartes du centre par leur place, et pour chaque joueur la suite de ses plus petites et de ses plus grandes cartes ;
- à leur tour, ils estiment les chances de finir un trio avec ce qu'ils savent, et visent d'abord ce qui gagne la partie, puis ce qui empêche un adversaire de la gagner ;
- quand ils ne savent rien, ils explorent, en évitant de montrer leurs propres cartes.

Entre bots, une partie dure 25 à 30 tours ; un bot qui retient bat de 89 à 97 % du temps une table de bots qui ne retiennent rien (`npx tsx test/sim.ts 200` pour mesurer).

## Fonctionnalités

- Tables privées avec code à 4 lettres, lien d'invitation, partage natif et QR code
- Partie contre 2 à 5 bots en un clic
- Un geste par carte : toucher « petite » ou « grande » sur le siège d'un joueur, une carte du centre, ou un bout de sa main ; ce qui est jouable s'illumine
- La carte se retourne sur place et sa copie file vers la jauge du trio, au centre de la table, avec sa provenance ; « Raté » ou « Trio ! » s'y tamponne
- Les trios volent vers leur gagnant, confettis à la clé ; écran de victoire, puis la table dévoilée : toutes les mains, les trios et le centre
- Équipes : couleurs, partenaire en face, échange secret en deux touches et rappel de ce qu'on a donné et reçu
- Victoires de la soirée, revanche en un clic
- Réactions, règles consultables en jeu
- Reprise automatique après une coupure, pilote automatique, spectateurs
- Sons synthétisés et vibrations, animations réduites si le système le demande

## Développement

```bash
npm install
npm run dev:server   # serveur temps réel sur http://localhost:3180
npm run dev:client   # interface sur http://localhost:5197
npm test             # paquet, tours, trios, victoires, équipes, bots et table
npm run build && npm run e2e   # parties complètes avec de vrais clients connectés
npx tsx test/sim.ts 200        # force des bots : 200 parties par configuration
```

`TR_FAST=1` accélère les bots et les chronos (tests locaux uniquement).

## Architecture

- `shared/` : contrat client/serveur, constantes du paquet et de la distribution
- `server/` : Express + Socket.IO, moteur de partie (`game.ts`), bots et leur mémoire (`bots.ts`), table et minuteries (`room.ts`). Le serveur fait autorité : chacun ne reçoit que sa main, les cartes du centre ne circulent que pendant leur révélation, et rien de passé n'est renvoyé
- `client/` : React + Vite + Framer Motion. Les cartes sont dans `components/Card.tsx`, la table, la jauge et les vols de cartes dans `screens/Table.tsx`
- Déploiement : un seul service Node (`npm ci && npm run build`, puis `npm start`)
