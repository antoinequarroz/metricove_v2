# Worker de montage (Mac)

Le travail lourd du montage IA de Metricove tourne sur le Mac (contrat : [docs/MONTAGE.md](../../docs/MONTAGE.md)) :

1. **Rushes** : inventaire de `rushesDir` (par défaut `~/Movies/Rushes`) toutes les 60 s ; les rushes filmés dans le Studio sont rapatriés depuis le VPS puis libérés.
2. **Transcription** mot à mot avec whisper.cpp (`whisper-cli`, modèle large-v3-turbo), temps des mots par alignement DTW (`--dtw`), recalés sur les silences entendus par ffmpeg ; mise en cache.
3. **Proposition** : Claude Code (`claude -p`, abonnement du Mac) choisit les phrases et l'ordre, coupe les « euh » et bégaiements mot par mot, propose 3 accroches, le carton de fin, des zooms, les mots clés, quelques emojis, la musique et 2 à 5 plans de B-roll (sauf `brollAuto: false`). Chaque plan est cherché dans `~/Movies/Metricove/broll` (nom de fichier), sinon sur Pexels ; un plan sans `source` (changé à la main) est recherché avant l'aperçu ou le final. Les notes dessinées (`job.marks`) sont écrites en `mark-<id>.jpg` dans le dossier de travail et Claude les lit (outil Read).
4. **Rendu** (style du skill video-heds, sans logo) :
   - image : coupe des phrases gardées sans les mots coupés, silences gardés / resserrés (> 0,3 s → 0,15 s) / retirés (même règle que la timeline de l'éditeur, `removedSpans`), recadrage sur le visage (Vision), zooms (un sur deux avant, un sur deux arrière) ;
   - B-roll (`edl.broll`) par-dessus Antoine, sa voix continue : plein écran recadré au format, ou fenêtre arrondie (~40 % de la largeur) dans le coin du haut opposé au visage ; sous les sous-titres ;
   - son : débruitage (DeepFilterNet si `deep-filter` est installé, sinon ffmpeg `afftdn`), musique du dossier `musicDir` qui baisse sous la voix, loudnorm −14 LUFS (2 passes en final, 1 en aperçu) ;
   - sous-titres HyperFrames selon `edl.captions`, sinon `job.style`, sinon défaut : position bas / haut / milieu / auto (sous ou au-dessus du visage), animation karaoké / pop / simple, taille, couleur des mots clés, emojis ; accroche et carton de fin ;
   - couverture et `.srt`.
5. Envoi de l'aperçu (540p) ou de la vidéo finale (1080p) à Metricove, par morceaux de 8 Mo. En final : chaque format de `edl.exports` est rendu et entre dans la bibliothèque comme sa propre vidéo (« Titre (4:5) »), puis la couverture du feed est faite (même travail que l'action `cover`).

Le worker ne fait que des requêtes **sortantes** : aucun port à ouvrir.

## Installation

```bash
cd worker/montage
cp config.example.json config.json   # puis ajuster les dossiers si besoin (disque externe possible)
node montage.mjs --check             # outils, disque, connexion
node montage.mjs --setup             # télécharge le modèle Whisper (≈ 1,6 Go) s'il y a la place
```

Outils requis : Node 20+, ffmpeg/ffprobe, whisper-cli (`brew install whisper-cpp`), Xcode Command Line Tools (`swift`), Claude Code connecté.

Facultatif :
- **DeepFilterNet** (meilleur débruitage, ≈ 28 Mo) : télécharger `deep-filter-0.5.6-aarch64-apple-darwin` depuis les releases GitHub de Rikorose/DeepFilterNet, le poser en `~/Movies/Metricove/outils/deep-filter` et le rendre exécutable (`chmod +x`). Sans lui, débruitage ffmpeg.
- **B-roll** : tes plans dans `~/Movies/Metricove/broll` avec des noms descriptifs (« ballon de foot.mp4 »). Pour Pexels, une clé gratuite (pexels.com/api) dans `"pexelsKey"` de `config.json` ; les vidéos téléchargées vont dans `~/Movies/Metricove/broll-cache`, plafonné à `brollCacheGb` (1 Go). Sans clé ni plan qui colle, le plan est retiré et une note le dit.
- **Musique** : fichiers MP3/M4A/WAV dans `~/Movies/Metricove/musique` (`musicDir`). Le morceau est choisi par son nom (`audio.music.track`), sinon par Claude, sinon le premier du dossier. Dossier vide : pas de musique, et une note le dit.
Le jeton API est lu dans la ligne `API_TOKEN=…` de `apiTokenFile` (par défaut `~/metricove-secrets.txt`), ou dans `METRICOVE_API_TOKEN`.

## Lancer

```bash
node montage.mjs            # boucle (à lancer via Portly pour qu'il reste actif)
node montage.mjs --once     # une seule tâche
node montage.mjs --dry-run  # travaille mais n'envoie rien à Metricove
```

## Thème

`theme` dans `config.json` : police (`font`, `fontFiles` pour des polices locales), couleurs (`accent`, `text`, `ink`, `dark`), `logo`, signes par ligne de sous-titres, durée du carton de fin.
`themes["<projectId>"]` surcharge le thème pour un projet ; `job.theme` (apparence du profil de style enregistré du projet, Réglages → Styles) surcharge le tout.

Autres réglages : `brollDir`, `brollCache`, `brollCacheGb`, `pexelsKey`, `musicDir`, `deepFilter` (chemin du binaire), `silenceDb` (seuil de silence, −35 dB), `whisper.dtw` (préréglage DTW du modèle, vide pour le couper), `whisper.dtwShift` (avance des débuts de mots, 0,15 s).

## Reel vidéo (worker 0.15.0)

Un reel animé demandé en mode vidéo (« Reel animé » du Studio) n'est plus une suite de scènes : c'est **un seul plan continu** de 15 à 60 s. Claude écrit la **partition** (temps forts : texte, mise en page, liaison avec le précédent, état de la forme de marque, caméra) et, si la demande appelle un visuel précis, au plus 3 **moments** (petites animations HyperFrames sur mesure, posées dans une zone fixe). Le moteur Plateau du Mac (`lib/reel/stage.mjs`) met le tout en scène : typographie, zone sûre, couleurs du projet, déterminisme.

Installation, une fois (après `git pull`) :

```bash
node montage.mjs --setup-reel   # GSAP local, Chrome hors ligne, rendu de mesure ×2, test de Claude restreint
node montage.mjs --check        # nouvelles lignes : GSAP, Chrome hors ligne, lint de la fixture, drapeaux claude, reel-stats.json
```

`--setup-reel` :
1. télécharge `gsap@3.14.2` (`npm pack`) dans `~/Movies/Metricove/outils/gsap` et ajoute `gsapDir` et `gsapFile` à `config.json` s'ils manquent (copie dans `config.json.bak`, ce qui change est affiché) ;
2. installe le Chrome de HyperFrames (`browser ensure`) et écrit `<workDir>/chrome-offline.sh`, qui le lance sans DNS hors de la boucle locale : même du code exécuté dans la page ne peut rien envoyer. Une image est rendue tout de suite par ce script (deux essais : un raté passager ne compte pas). S'il échoue deux fois ET que le Chrome de HyperFrames rend l'image sans lui, ce Mac le refuse : il est retiré et `! Chrome hors ligne refusé par ce Mac : seule la CSP bloque le réseau` s'affiche (les vidéos marchent, la CSP de la page reste la barrière). Si Chrome échoue aussi sans lui, le script est remis en place et `--setup-reel` s'arrête avec la raison. `--check` refait cet essai ;
3. rend deux fois la vidéo de mesure (sans Claude) : le temps par image amorce le temps restant affiché dans le Studio (`<workDir>/reel-stats.json`) et les deux rendus doivent être identiques image par image (`framemd5`) ;
4. lance `claude -p --restricted --tools "" --strict-mcp-config --no-session-persistence` (et `--model` s'il est réglé : le même appel que les vidéos) avec « Réponds ok » : si le mode restreint échoue à l'authentification, écrit `reel.restricted: false` (les vidéos s'écrivent alors par l'ancien appel, sans relecture en images ; la note de la version dit de relancer `claude`, `/login` puis `--setup-reel`).

Ce que fait le Mac pour une vidéo (`lib/reel/`) :
- **write** : Claude écrit la partition en flux (`claude -p --output-format stream-json --restricted --tools ""`, dossier dédié, 6 min au plus) ; le Studio voit « N temps forts » arriver. Une réponse inexploitable a droit à une seule réécriture.
- **check** : chaque moment passe le bac à sable statique (`sandbox.mjs`, dont les règles sont écrites telles quelles dans le prompt de Claude), puis `hyperframes lint` et `check` dans Chrome hors ligne. Une erreur d'un moment le retire (avec une note en clair ; le détail est au journal) ; une erreur du moteur fait sortir la vidéo en mode sûr. Si Chrome ne démarre pas (`check_runtime_failure` « Failed to launch the browser process »), `check` est relancé une fois, puis le job échoue avec « Chrome ne démarre pas sur le Mac (…) : relance node montage.mjs --setup-reel » : les moments ne sont pas retirés pour une panne du Mac.
- **review** (création seulement, s'il y a quelque chose à regarder) : une image par temps fort part au Studio (planche), puis Claude relit la planche (`--tools Read`, 4 min au plus) et corrige au plus une fois ; la correction est revérifiée. La page rendue est toujours la dernière page vérifiée. HyperFrames 0.8 pagine les planches par 9 images : au-delà de 9 temps forts, Claude reçoit `contact-sheet-1.jpg`, `contact-sheet-2.jpg`… (avant ce correctif, la relecture était sautée sans bruit dès 10 temps forts). Un texte hors de la zone sûre ou qui déborde ne compte que pendant que son temps fort est posé : pendant une liaison (plongée du zoom, sortie), le mouvement le fait sortir exprès, et ce n'est plus une note « dépasse » pour Antoine.
- **render**, **finish**, **upload** : `hyperframes render` (avancement image par image), musique ou piste muette (la vidéo de HyperFrames est gardée telle quelle si elle est sous 10 Mb/s, sinon réencodée une fois en `veryfast`, débit plafonné à 10 Mb/s), contrôle `ffprobe`, puis `POST /versions`. Si une étape échoue, la page rendue est toujours la dernière page vérifiée (chaque page vérifiée a son dossier `hf-<n>`). Une retouche d'un passage (`reviseVideo`) ne réécrit que les temps forts ouverts ; une édition à la main (`renderVideo`) ne rappelle jamais Claude.
- **Dossier de travail** : chaque passage d'un job vidéo a son propre dossier, `<workDir>/taches/<job>-r<horodatage>` : un passage arrêté qui finit de tuer ses processus ne touche jamais le passage suivant du même job. Il est supprimé à la fin (trois essais à 200 ms ; s'il résiste, une ligne au journal donne son chemin, le job n'échoue pas), aussi quand le worker sort sur un signal (Ctrl-C, kill, Portly). Ceux qu'un `kill -9` ou un plantage laisse (la vidéo de travail de HyperFrames : des centaines de Mo) sont supprimés au démarrage suivant, une fois le verrou pris.
- **Avant Claude** : GSAP (`gsapDir`), `npx` et le binaire de Claude sont vérifiés en quelques millisecondes avant l'écriture payée ; s'il en manque un, le job échoue tout de suite avec la marche à suivre (« GSAP introuvable… lance node montage.mjs --setup-reel », « npx introuvable pour le worker… », « Claude Code est introuvable sur le Mac (claude.bin = …) : corrige config.json »). `npx` est cherché d'abord dans le dossier du Node qui fait tourner le worker (PATH court de launchd ou de Portly, Node de nvm ou de Homebrew).
- **Hors ligne** : chaque appel à HyperFrames passe `npm_config_prefer_offline=true` : le paquet épinglé déjà en cache sert sans revérifier le registre npm (registre injoignable : 1 s au lieu de 70 s d'essais, qui faisaient échouer `lint` à 60 s). Seul le premier `--setup-reel` a besoin du registre.
- Rien d'infini : chaque commande a un délai et s'arrête avec son groupe de processus, chaque requête vers Metricove aussi (60 s, 3 min par morceau envoyé, 30 s par image d'inspiration et 100 s pour toutes : au-delà, Claude écrit sans elles), un job vidéo a un plafond dur de 30 min (le job rend la main à l'heure, même si une étape n'écoute pas l'arrêt), et la tâche est surveillée toutes les 10 s (supprimée, arrêtée depuis la page ou reprise ailleurs → arrêt immédiat, sans échec envoyé). Chaque écriture du worker (progression, planche, version, aperçu, échec) porte `run` (le `run.startedAt` de la réclamation) : un 409 de Metricove (passage terminé ou repris ailleurs) arrête le job comme une annulation. Un seul worker par Mac (`<workDir>/worker.lock` ; après une coupure, un verrou dont le pid n'est plus un worker est repris tout seul, sinon le message dit quel fichier supprimer).
- Arrêt du worker : Ctrl-C, `kill` ou SIGQUIT arrêtent aussi Claude, HyperFrames et Chrome en cours (SIGTERM puis SIGKILL 1,5 s plus tard), y compris pendant `--setup-reel` et `--check`. Fermer la fenêtre du Terminal (SIGHUP) fait de même quand le worker y a été lancé directement ; lancé détaché (`nohup node montage.mjs &`, Portly, sorties redirigées), il ignore SIGHUP et continue (Node ne garde pas le SIGHUP ignoré par nohup : c'est le worker qui le fait). `MONTAGE_SIGHUP=stop` ou `ignore` force l'un ou l'autre. Seul un `kill -9` du worker laisse ces processus tourner : ils s'arrêtent alors à leur propre délai (25 min au plus pour un rendu) ; `pkill -f hyperframes` les arrête tout de suite.

Réglages (`config.json` → `reel`) : `review` (relecture en images, `true`), `effort` (`--effort` de Claude, vide = défaut), `restricted` (`true`), `claudeWriteMin` (6), `claudeReviewMin` (4), `claudeReviseMin` (5), `maxFrameMs` (400 : délai du rendu = 120 s + 0,4 s par image, 25 min au plus), `jobMaxMin` (30), `reviewWithinMin` (6 : la relecture en images est sautée si le job a déjà pris plus de 6 min, pour ne pas allonger encore une vidéo lente). Les nombres sont bornés (`claudeWriteMin` et `claudeReviseMin` 1–15, `claudeReviewMin` 1–10, `jobMaxMin` 5–90, `maxFrameMs` 50–2000, `reviewWithinMin` 0–30) ; une valeur nulle, négative ou illisible reprend la valeur par défaut, avec une ligne au journal. Autres clés lues : `gsapDir`, `gsapFile`, `fontsDir`, `hyperframesReference`. Le savoir-faire donné à Claude est dans `prompts/reel-video.md`.

Réglé sur trois vraies vidéos (intégration de novembre 2026, voir `docs/MONTAGE.md`, « Intégration ») : textes courts (accroche de 2 à 5 mots, texte de 2 à 8 mots, `sub` de 12 mots au plus et jamais sur deux temps forts de suite), un temps fort toutes les 3 s environ (2 à 4 s chacun), 1 ou 2 moments dès que la demande a des objets, des chiffres, des étapes ou un avant/après, tailles de texte plus grandes (`TYPE.sizes` de `vocab.mjs`), dérive de caméra plus marquée. Dans un temps fort « number », une unité courte qui suit le nombre (« 3 h », « 15 min », « 2 ans ») monte avec lui dans le grand chiffre, et Claude est prié d'ouvrir le texte par le nombre.

## Illustrations et bruitages (worker 0.16.0)

Médias → Ressources → Illustrations ou Bruitages → « Créer avec Claude » envoie une tâche `asset` au Mac :

- **Illustrations** : Claude dessine des SVG aux couleurs du style choisi (fond transparent, sans texte). Un SVG qui
  contient du script, une image ou un lien vers l'extérieur est écarté.
- **Bruitages** : Claude décrit chaque son ; le Mac le fait faire par ElevenLabs (effets sonores) quand il trouve une clé,
  sinon par une recette FFmpeg (whoosh, pop, click, thud, ding, riser, glitch, impact, typing ; sources synthétiques
  seulement). Clé : variable `ELEVENLABS_API_KEY`, ou `"elevenlabsKeyFile"` dans config.json = un fichier qui contient
  une ligne `ELEVENLABS_API_KEY=…` (par ex. le `.env` d'un autre projet). La clé n'est jamais affichée.

Les fichiers arrivent dans la bibliothèque, rangés dans le style choisi.

## Mise en scène des temps forts (worker 0.17.0)

Dans un face cam, Claude choisit 2 à 4 temps forts où la mise en page change : écran coupé (carte en haut, visage en
bas), carte plein écran, ou carte avec le visage en pastille ronde. Chaque carte entre avec une animation différente de
la précédente, avec une illustration de la bibliothèque du style quand une colle. Il pose aussi 2 à 5 bruitages : ceux
de la bibliothèque, sinon des sons faits ici avec FFmpeg. Les fichiers de la bibliothèque sont gardés dans
`"libraryCache"` (par défaut `~/Movies/Metricove/bibliotheque-cache`, ~300 Mo au plus). Tout se retouche dans les
pistes « Mise en scène » et « Bruitages » de la timeline ; Réglages → Mise en scène coupe la proposition automatique.

## Disque

`workDir` et `rushesDir` sont configurables. Le worker refuse de travailler sous `minFreeGb` Go libres et efface ses fichiers intermédiaires après chaque rendu. HyperFrames rend avec `--workers 1` (sinon il stocke toutes les images sur le disque).

## Tester sans Metricove

```bash
node test/mock-server.mjs /tmp/montage-test 3999 &
MONTAGE_CONFIG=/chemin/config.test.json METRICOVE_API_TOKEN=test-token node montage.mjs --once   # proposition
MONTAGE_CONFIG=/chemin/config.test.json METRICOVE_API_TOKEN=test-token node montage.mjs --once   # rendu final
```

`config.test.json` : `{ "metricoveUrl": "http://localhost:3999", "rushesDir": "…", "workDir": "…" }`.
Sans modèle Whisper, un fichier `<rush>.words.json` posé à côté du rush (`[{ "t0", "t1", "w" }]`) remplace la transcription.

Le faux serveur sait aussi jouer une modification manuelle (`EDIT='{"audio":…,"captions":…,"exports":["1:1"]}'`), une note dessinée (`MARK=/chemin/image.jpg`) et un style de projet (`STYLE='{…}'`) : voir l'en-tête de `test/mock-server.mjs`.
