# Worker de montage (Mac)

Le travail lourd du montage IA de Metricove tourne sur le Mac (contrat : [docs/MONTAGE.md](../../docs/MONTAGE.md)) :

1. **Rushes** : inventaire de `rushesDir` (par défaut `~/Movies/Rushes`) toutes les 60 s ; les rushes filmés dans le Studio sont rapatriés depuis le VPS puis libérés.
2. **Transcription** mot à mot avec whisper.cpp (`whisper-cli`, modèle large-v3-turbo), mise en cache.
3. **Proposition** : Claude Code (`claude -p`, abonnement du Mac) choisit les phrases, l'ordre, l'accroche, le carton de fin et 2-3 zooms.
4. **Rendu** (style du skill video-heds, sans logo) : coupe des phrases gardées, recadrage sur le visage (Vision), zooms lents d'une coupe à l'autre, sous-titres karaoké + accroche + carton de fin en HyperFrames, son à -14 LUFS en final, couverture et `.srt`.
5. Envoi de l'aperçu (540p) ou de la vidéo finale (1080p) à Metricove, par morceaux de 8 Mo.

Le worker ne fait que des requêtes **sortantes** : aucun port à ouvrir.

## Installation

```bash
cd worker/montage
cp config.example.json config.json   # puis ajuster les dossiers si besoin (disque externe possible)
node montage.mjs --check             # outils, disque, connexion
node montage.mjs --setup             # télécharge le modèle Whisper (≈ 1,6 Go) s'il y a la place
```

Outils requis : Node 20+, ffmpeg/ffprobe, whisper-cli (`brew install whisper-cpp`), Xcode Command Line Tools (`swift`), Claude Code connecté.
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
