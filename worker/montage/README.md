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
`themes["<projectId>"]` surcharge le thème pour un projet ; `job.theme` (prévu côté API) surcharge le tout.

Autres réglages : `brollDir`, `brollCache`, `brollCacheGb`, `pexelsKey`, `musicDir`, `deepFilter` (chemin du binaire), `silenceDb` (seuil de silence, −35 dB), `whisper.dtw` (préréglage DTW du modèle, vide pour le couper), `whisper.dtwShift` (avance des débuts de mots, 0,15 s).

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
