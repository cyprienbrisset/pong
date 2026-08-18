# Rejeu de partie — design

Statut : approuvé pour implémentation.

## Objectif

Permettre de revoir un match terminé, image par image, à l'identique. Deux usages :
partager un beau point avec l'équipe, et reproduire exactement un bug signalé par un
collègue. La simulation est déjà déterministe (`stepWorld`, graine + axes) : il suffit
d'enregistrer la graine et la séquence des axes appliqués à chaque tick pour pouvoir
rejouer un match entier sans stocker la moindre position.

## Périmètre

- Seuls les matchs **valides** (déjà inscrits au classement, donc non abandonnés) ont un
  replay. Un match abandonné n'en génère pas — décision volontaire, pas une contrainte
  technique : la table `replays` est donc en 1-pour-1 avec `matches`, sans état à gérer
  pour les cas d'abandon.
- Lecture seule, vitesse normale, pas de vitesse variable ni de curseur de progression.
  Un bouton retour au menu suffit à interrompre la lecture.
- Accessible depuis un panneau « Replays » (liste des derniers matchs, comme le
  classement) et depuis un bouton « Revoir » sur l'écran de fin de partie qu'on vient de
  jouer.

## Approche

Enregistrer, pour chaque tick joué, la paire d'axes `[axisSide0, axisSide1]`
effectivement transmise à `stepWorld` (celle que `Room.tick()` calcule déjà). À la
lecture, le client relance `createWorld(config, seed)` puis rejoue `stepWorld` tick par
tick avec cette séquence, dans une boucle locale à 60 Hz — exactement les mêmes fonctions
pures que la simulation serveur et que les tests existants (`sim.test.ts`).

**Alternative écartée** : enregistrer un snapshot complet par tick plutôt que les axes.
Rejeté pour la taille (des centaines de Ko à quelques Mo par match contre ~15-20 Ko en
axes) et parce que ça perd la propriété qui rend cette fonctionnalité peu coûteuse :
la simulation est déjà déterministe, un enregistrement de position la duplique sans
raison.

**Risque accepté** : si la physique de `stepWorld` change un jour, un replay enregistré
avant ce changement rejouera différemment (même graine et mêmes axes, résultat
différent). On enregistre un `simVersion` (entier incrémenté à la main si un changement
de physique impactant arrive un jour) pour au moins détecter l'incompatibilité plutôt que
de laisser un vieux replay diverger silencieusement. Aucune vérification automatique dans
cette première version — un affichage « ce replay date d'une version antérieure » pourra
être ajouté plus tard si le besoin apparaît réellement.

## Modèle de données

Nouvelle table, dans `packages/server/src/db.ts` :

```sql
CREATE TABLE IF NOT EXISTS replays (
  match_id    INTEGER PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  arena       TEXT    NOT NULL,
  target      INTEGER NOT NULL,
  powerups    INTEGER NOT NULL,
  bot         INTEGER NOT NULL,
  bot_level   INTEGER NOT NULL,
  seed        INTEGER NOT NULL,
  sim_version INTEGER NOT NULL,
  axes        BLOB    NOT NULL
);
```

`axes` : deux octets par tick, un axe quantifié par camp (même codage que les entrées
réseau : `Math.round(clamp(axis, -1, 1) * 127)`, borné à un octet signé). Un match de
2-3 minutes à 60 Hz tient dans 15-20 Ko.

`Store` (`packages/server/src/db.ts`) :
- `recordMatch()` change de signature : renvoie désormais l'`id` du match inséré
  (`number`) au lieu de `void`, pour permettre à l'appelant de lier le replay.
- `saveReplay(matchId: number, replay: ReplayRecord): void` — insertion simple, pas
  d'`ON CONFLICT` nécessaire (un seul enregistrement par match, jamais réécrit).
- `getReplay(matchId: number): ReplayRecord | null`.

## Enregistrement (`packages/server/src/room.ts`)

- Nouveau champ privé `recordedAxes: number[]` (paires aplaties, valeurs déjà
  quantifiées), vidé dans `resetWorld()`.
- Nouveau champ privé `initialSeed: number`, capturé au moment de `createWorld()` dans le
  constructeur et dans `resetWorld()` — `world.seed` mute pendant la partie (le générateur
  aléatoire l'avance à chaque tirage), il faut donc conserver la graine de départ à part.
- `tick()` pousse la paire d'axes quantifiée à chaque appel, juste après le calcul de
  `axes` et avant `stepWorld` (peu importe l'ordre exact, les deux valeurs sont figées
  pour ce tick).
- Dans `finish()`, juste après un `store.recordMatch()` réussi (donc uniquement si
  `!this.abandoned`) : récupérer l'`id` renvoyé et appeler `store.saveReplay(id, {...})`
  avec la config de la manche, `initialSeed`, `SIM_VERSION` (constante exportée, `1` pour
  cette version), et `recordedAxes` empaqueté en `Buffer`.
- **Réordonnancement nécessaire** : `finish()` envoie aujourd'hui le message `'over'` à
  tous les clients *avant* d'appeler `store.recordMatch()` — au moment de construire ce
  message, l'`id` du match (donc du replay) n'existe pas encore. Il faut déplacer l'appel
  à `store.recordMatch()` (et `saveReplay()` qui en dépend) avant l'envoi du message
  `'over'`, pour pouvoir y inclure `matchId` quand l'enregistrement a réussi. Le message
  reste envoyé même en cas d'échec d'écriture (le `catch` existant ne doit pas empêcher
  les clients d'être notifiés de la fin de manche) — seul `matchId` sera alors absent.

## API (`packages/server/src/http.ts`)

- `GET /api/matches` (route existante, `recentMatches`) : la requête SQL ajoute
  `m.id AS match_id` et une colonne calculée `has_replay` (`EXISTS (SELECT 1 FROM
  replays WHERE match_id = m.id)`) — nécessaire car les matchs enregistrés avant ce
  déploiement n'ont pas de ligne `replays` correspondante.
- `GET /api/replays/:matchId` (nouvelle route, vérifiée par
  `url.pathname.startsWith('/api/replays/')` avant le `switch` existant, à l'image du
  traitement `POST /api/themes`) : `404` si absent, sinon
  `{ arena, target, powerups, bot, botLevel, seed, simVersion, axes: <base64> }`. Les
  octets bruts passent en base64 dans le JSON (pas de route binaire dédiée, le volume est
  trop faible pour le justifier).
- Le message de contrôle `ServerControl` de type `'over'` (protocole partagé) gagne un
  champ optionnel `matchId?: number`, présent uniquement quand le match a été enregistré
  — c'est ce qui alimente le bouton « Revoir » sur l'écran de fin de partie.

## Client

- `packages/shared/src/protocol.ts` : nouvelle fonction pure `worldSnapshot(world,
  opts?)`, qui transforme un `World` en la même forme que `Snapshot` (réutilise
  `paddleFlags`, déjà défini dans ce fichier). Un seul convertisseur, utilisé uniquement
  en lecture de replay — le chemin réseau (`encodeSnapshot`/`decodeSnapshot`) ne change
  pas.
- `packages/shared/src/protocol.ts` : `quantizeAxis`/`dequantizeAxis`, extraites de la
  logique déjà présente dans `encodeInput`/`decodeInput`, réutilisées à la fois par
  l'enregistrement serveur et la lecture client — une seule définition du codage.
- Nouveau module `packages/client/src/net/replay.ts` : reçoit les données d'un replay,
  reconstruit `createWorld(config, seed)`, boucle `requestAnimationFrame` à `TICK_DT`
  fixe qui appelle `stepWorld` avec la paire d'axes du tick courant, et pousse
  `renderer.draw({ snapshot: worldSnapshot(world), localSide: null, lerp: null, arena,
  arenaTime: world.tick * TICK_DT, countdownLabel: null }, dt)` à chaque image — le
  renderer existant n'a besoin d'aucune modification (`localSide: null` est déjà le mode
  spectateur).
- Interface : nouveau panneau `#panel-replays` (liste des derniers matchs avec bouton
  « Revoir », alimentée par `/api/matches`), et un bouton « Revoir » sur `#panel-over`
  actif quand `matchId` est présent dans le payload `over`.

## Tests

- `quantizeAxis`/`dequantizeAxis` : aller-retour, bornes (`shared`).
- `worldSnapshot()` : transforme un `World` connu en `Snapshot` attendu, drapeaux d'effet
  inclus (`shared`) — pure, aucun mock nécessaire.
- `Room` : après une séquence de ticks à axes connus, `recordedAxes` correspond
  exactement ; `finish()` appelle `saveReplay` avec le bon `matchId` seulement quand le
  match n'est pas abandonné (`server`, dans la continuité de `server.test.ts`).
- `Store` : `saveReplay`/`getReplay` round-trip, y compris le cas absent (`server`).
- Le module client `replay.ts` et la route HTTP suivent la convention déjà en place dans
  ce projet : pas de test unitaire dédié pour le câblage réseau/DOM, vérifié en
  navigateur réel (comme pour les fonctionnalités précédentes de cette session).

## Hors périmètre (volontairement)

- Vitesse de lecture variable, curseur de progression.
- Replays des matchs abandonnés.
- Suppression/expiration des replays anciens (même échelle que `matches`, déjà sans
  purge).
- Vérification automatique de compatibilité de `simVersion` au-delà du champ enregistré.
