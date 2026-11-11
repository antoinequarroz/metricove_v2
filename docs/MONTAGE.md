# Montage vidéo IA (V1)

Metricove décrit le montage et le fait valider. Le Mac d'Antoine fait le travail lourd :
transcription (whisper-cli), propositions de Claude Code (`claude -p`, abonnement),
rendu (HyperFrames + ffmpeg, style du skill video-heds, sans DaVinci).

```
Navigateur (Metricove)            VPS (Metricove)                      Mac (worker)
Studio / choix des rushes  ──►  tâche « montage » en file  ◄── claim ──  boucle toutes les 5 s
Validation avant/après     ◄──  versions (EDL + aperçu)    ◄── upload ── transcrit, monte, rend
« Valider »                ──►  action « final »           ◄── upload ── rendu final → bibliothèque
```

Le worker ne fait que des requêtes **sortantes** vers Metricove, avec `Authorization: Bearer <API_TOKEN>`.

## Rushes

Un rush est un fichier vidéo brut.

- `origin: "mac"` : fichier présent sur le Mac (dossier surveillé, par défaut `~/Movies/Rushes`).
  Le worker envoie la liste avec `POST /api/montage/rushes/scan`.
- `origin: "upload"` : filmé dans le Studio ou envoyé depuis le téléphone. Le fichier transite par le VPS :
  le worker le télécharge (`GET /api/montage/rushes/:id/file`), le range dans le dossier du Mac,
  puis le libère (`DELETE /api/montage/rushes/:id/file`). Le rush devient alors `origin: "mac"`.

`POST /api/montage/rushes/scan` — corps : `{ "rushes": [{ "path", "name", "size", "duration", "mtime", "thumb"? }] }`
(`thumb` = petite image JPEG en data URL, ≤ 30 Ko). Remplace la liste des rushes `mac`.
Pour un rush rapatrié, ajouter `"from": "<id du rush upload>"` : il garde son id.

## Envoi de gros fichiers (par morceaux)

Le serveur refuse les corps de plus de 10 Mo. Tout fichier passe donc par morceaux de **8 Mo maximum** :

1. `POST /api/uploads` `{ "name": "prise-1.webm", "size": 123456 }` → `{ "id" }` (refusé avec 507 si le disque est trop plein)
2. `PUT /api/uploads/:id?offset=<octets déjà envoyés>` avec le morceau brut en corps → `{ "received" }`
3. L'`id` sert ensuite dans les autres appels (`upload`). Un envoi non utilisé est effacé après 24 h.

`POST /api/media` accepte aussi `{ "upload", "title"?, "post"? }` en JSON : c'est la voie à prendre pour toute vidéo de plus de 10 Mo (Claude Code, Hermes).

## Tâches

```ts
type Job = {
  id: string;
  kind: "montage" | "script" | "caption" | "cover" | "post";
  title: string;
  projectId?: string;
  status: "queued" | "working" | "review" | "rendering" | "done" | "failed" | "cancelled";
  /** Ce que le worker doit faire maintenant (null = rien). */
  action: null | "propose" | "preview" | "final" | "script" | "caption" | "cover" | "post";
  step?: string;          // « Transcription… », affiché tel quel
  progress?: number;      // 0..1
  error?: string;
  brief: {
    format: "9:16" | "4:5" | "1:1" | "16:9";
    seconds?: number;     // durée visée
    instructions?: string;// consigne libre
    hook?: string;        // accroche
    cta?: string;         // appel à l'action
  };
  script?: string;        // texte prévu (Studio) : aide à choisir les prises
  rushIds: string[];
  feedback?: string;      // commentaire pour la prochaine proposition
  versions: Version[];
  approved?: number;      // numéro de version validée
  mediaId?: string;       // vidéo finale dans la bibliothèque
  createdAt: string; updatedAt: string;
};

type Version = { n: number; edl: Edl; notes?: string; preview: boolean; by: "claude" | "edit"; createdAt: string };
```

### EDL (liste de montage)

Les temps des segments et des mots sont **dans le rush** (secondes). La timeline se déduit des segments gardés, dans l'ordre.

```ts
type Edl = {
  format: "9:16" | "4:5" | "1:1" | "16:9";
  segments: {
    id: string;
    rush: string;         // id du rush
    in: number; out: number;
    text: string;         // phrase dite
    kept: boolean;        // false = coupé (reste visible, barré, dans l'interface)
    reason?: string;      // « raté », « doublon », « silence »… (pour les coupés)
    words?: {
      t0: number; t1: number; w: string;   // sous-titres karaoké, temps dans le rush
      cut?: boolean;   // mot retiré de la vidéo (« euh », bégaiement) : image et son coupés, la phrase reste
      hl?: boolean;    // mot clé : couleur captions.highlight
      emoji?: string;  // emoji affiché avec le sous-titre pendant ce mot
    }[];
  }[];
  title?: { text: string; until: number } | null;   // accroche en ouverture (until = secondes de timeline)
  endCard?: { text: string } | null;                 // carton de fin
  zooms?: { at: number; dur: number; scale: number }[]; // temps de timeline
  crop?: "face" | "center";
  hooks?: string[];                // autres accroches proposées (title.text = celle retenue). Claude en propose 3.
  captions?: {                     // absent = job.style, sinon le style par défaut
    on: boolean;
    position: "auto" | "top" | "middle" | "bottom"; // auto = au-dessus ou en dessous du visage (suivi du visage)
    look: "karaoke" | "pop" | "simple";
    size: "s" | "m" | "l";
    highlight?: string;            // #rrggbb, sinon l'accent du projet
    emoji: boolean;                // Claude peut ajouter des emojis (words[].emoji)
  };
  audio?: {                        // absent = { denoise: true, silences: "tight", music: { on: false } }
    denoise: boolean;              // débruitage de la voix (DeepFilterNet), puis loudnorm −14 LUFS
    silences: "keep" | "tight" | "cut"; // tight = silences > 0,3 s ramenés à 0,15 s ; cut = retirés
    music: { on: boolean; track?: string; volume: number; duck: boolean }; // track = fichier du dossier musique du Mac ; duck = baisse sous la voix
  };
  exports?: ("9:16" | "4:5" | "1:1" | "16:9")[]; // formats en plus, rendus avec la version finale
  brollAuto?: boolean;             // absent = true : Claude place du B-roll là où il aide
  broll?: {                        // plans d'illustration par-dessus Antoine (sa voix continue), temps de timeline
    at: number; dur: number;
    query: string;                 // ce que le plan montre, en quelques mots (sert à chercher)
    source?: "mine" | "pexels";    // rempli par le worker une fois le plan trouvé ; absent = à chercher
    ref?: string;                  // nom du fichier dans ~/Movies/Metricove/broll, ou id de la vidéo Pexels
    thumb?: string;                // petite image JPEG en data URL (≤ 40 Ko)
    mode: "full" | "pip";          // plein écran, ou petite fenêtre (Antoine reste visible)
  }[];
};
```

### B-roll

À la proposition (`propose`), si `brollAuto` n'est pas `false`, Claude place 2 à 5 plans (`query` en français, sur les
mots concrets) et le worker les cherche : d'abord dans `~/Movies/Metricove/broll` (noms de fichiers descriptifs),
sinon sur Pexels (clé `pexelsKey` du `config.json` du worker, vidéos verticales de préférence). Il remplit `source`, `ref`, `thumb`.
Un plan sans `source` (ajouté ou changé à la main dans la timeline) est cherché au prochain aperçu.
Les sous-titres restent au-dessus du B-roll.

Durée d'un segment sur la timeline = `out − in −` (mots coupés + part des silences retirée selon `audio.silences`, sans la détection ffmpeg). Voir `removedSpans` dans src/lib/montage.ts.

Les mots d'un segment peuvent dépasser `in`/`out` (plan raccourci dans la timeline) : ne garder que la partie entre `in` et `out`.

Un segment peut être coupé en deux dans la timeline : les deux moitiés gardent le même `rush`, la 2e reçoit un nouvel `id`.

### Côté worker

- `POST /api/montage/worker/claim` `{ "worker": "mac", "version": "0.2.0" }` (`version` sert à l'interface : « Écrire le post » demande 0.2.0 au moins)
  → `204` s'il n'y a rien, sinon `{ job, action, rushes }`. La tâche passe en `working`.
  Chaque rush : `{ id, name, origin, size, duration?, path?, createdAt, url? }`. `url` (chemin relatif) n'existe que pour un rush `upload` à télécharger.
  Une tâche prise sans nouvelles pendant 15 minutes est redonnée (Mac en veille, plantage) : envoyer `step`/`progress` régulièrement.
  Sert aussi de signal de vie : Metricove affiche « Mac connecté » si le dernier appel date de moins de 30 s.
- `PATCH /api/montage/jobs/:id` `{ "step", "progress" }` pendant le travail, ou `{ "status": "failed", "error" }`.
- `action: "propose"` : transcrire, demander à Claude une EDL (avec `brief`, `script`, `feedback`, `marks`, dernière version),
  rendre un aperçu léger (540p), puis
  `POST /api/montage/jobs/:id/versions` `{ "edl", "notes", "upload"? }` → statut `review`.
- `action: "preview"` : l'utilisateur a modifié l'EDL à la main. C'est toujours la **dernière** version (`by: "edit"`, `preview: false`). Rendre seulement l'aperçu,
  puis `POST /api/montage/jobs/:id/versions/:n/preview` `{ "upload", "broll"? }` (`broll` : les plans avec `source`/`ref`/`thumb` trouvés, ils remplacent ceux de la version).
- `action: "final"` : rendu pleine qualité de la version `approved`, puis
  `POST /api/montage/jobs/:id/final` `{ "upload", "title"? }` → la vidéo entre dans la bibliothèque, statut `done`.
- `action: "script"` (`kind: "script"`) : écrire un texte de prompteur à partir de `brief.instructions`,
  puis `PATCH /api/montage/jobs/:id` `{ "script", "status": "done" }`.
- `action: "caption"` (`kind: "caption"`) : écrire la description d'un post. `job.caption` donne
  `{ networks, accounts: [{ network, handle }], project?, draft?, mediaId?, youtube }`. `draft` est ce
  qu'Antoine a déjà tapé : un brouillon à réécrire ou une consigne. Quand il y a une vidéo, le claim
  renvoie aussi `media: { id, title, duration, aspect, url }` (`url` relative, avec le jeton) pour la
  transcrire. Répondre vite (l'interface attend au plus 4 min), avec `step` pour l'avancement, puis
  `PATCH /api/montage/jobs/:id` `{ "status": "done", "caption", "youtubeTitle"? }`. L'interface
  supprime la tâche une fois la description lue.
- `action: "post"` (`kind: "post"`, worker 0.2.0) : écrire un post entier à partir d'une idée (Studio → Carrousel et photo).
  `job.post` donne `{ idea, slides, networks, accounts: [{ network, handle }], project? }` : `slides` est le nombre de
  visuels voulus (1 à 10). Pas de délai côté interface : le résultat reste proposé dans « Carrousel et photo »
  jusqu'à ce qu'il soit repris, puis la tâche est supprimée. Envoyer
  `PATCH /api/montage/jobs/:id` `{ "status": "done", "post": { "caption", "slides": [{ "title", "body" }] } }`.
  Les visuels sont dessinés par Metricove, le worker n'écrit que les textes.
- `action: "cover"` (`kind: "cover"`) : faire la couverture du feed (image JPEG 1080×1920) de la vidéo
  `job.cover.mediaId`, dans le style du projet `job.cover.project` (consignes éventuelles dans
  `job.cover.instructions`). Le claim renvoie `media` (avec `url` de la vidéo). Le texte clé doit rester
  entre y 420 et 1500 (recadrage 3:4, 4:5 et 1:1 de la grille Instagram). Envoyer l'image brute en
  `PUT /api/media/:id/cover` (JPEG ou PNG, 8 Mo au plus), puis `PATCH /api/montage/jobs/:id`
  `{ "status": "done" }`. L'interface attend 5 min au plus.

## Couverture du feed

- `PUT /api/media/:id/cover` (corps = image JPEG ou PNG), `GET` pour la lire, `DELETE` pour la retirer.
- À la publication Instagram, Metricove envoie `cover_url` (lien signé). Sans couverture, Instagram
  prend la 1re image de la vidéo. TikTok (envoi dans l'app) ne prend pas de couverture.

### Notes dessinées (`job.marks`)

Envoyées avec une demande de nouvelle version : `{ id, version, t, text, image? }`.
`t` = seconde de la timeline de la version `version` ; `image` = JPEG (data URL) de l'image à ce moment avec le dessin d'Antoine
(flèches, cadres, traits). Le worker écrit chaque image dans le dossier de travail et demande à Claude de la lire
(outil Read) avec le texte : c'est une demande précise sur ce passage. Les marks sont remplacées à chaque demande.

### Style du projet

`GET|PUT /api/montage/styles/:projectId` (corps = `captions`). Un nouveau montage d'un projet reçoit `job.style`
(copie du style au moment de la création) : le worker l'utilise quand l'EDL n'a pas de `captions`.

### Profil de style du projet (`job.voice`)

Chaque projet a un profil de style (Réglages → Styles) : l'apparence de ses visuels (fond, couleur, texte,
signature, logo), le ton de Claude et, au choix, le dossier d'un skill sur le Mac.

- `GET /api/profiles` → `{ profiles: { [projectId]: { preset, look, tone, skill, saved } } }`. Sans profil
  enregistré, le projet reçoit un style de départ d'après son nom (AntoineQuarroz, LivreMatch, Carnadzons).
- `PUT /api/profiles/:projectId` `{ look?, tone?, skill?, preset? }` (seuls les champs envoyés changent),
  `DELETE` pour revenir au style de départ.
- Les tâches `script`, `caption` et `post` d'un projet portent `job.voice = { tone?, skill? }`, copié à la création.
  Le worker (0.3.0) met `tone` à la place de ses règles de ton d'origine et, si `skill` désigne un dossier qui
  contient un `SKILL.md`, ajoute ce fichier au prompt (8 000 caractères au plus ; rien d'autre n'est lu).
  Un worker plus ancien ignore `voice` et garde ses règles d'origine.

### Côté interface

- `POST /api/montage/jobs` `{ kind, title, projectId?, brief, rushIds?, script? }` → `queued`, action `propose` (ou `script`).
- `POST /api/montage/jobs` `{ kind: "caption", accountIds, draft?, mediaId?, projectId? }` → action `caption`.
- `POST /api/montage/jobs` `{ kind: "post", idea, slides?, accountIds?, projectId? }` → action `post`.
- `PATCH /api/montage/jobs/:id`
  - `{ "revise": "plus court, garde la prise 2", "marks"?: [...] }` → action `propose` (8 notes max, 400 Ko par image)
  - `{ "edl": {…} }` → nouvelle version `by: "edit"`, action `preview`
  - `{ "approve": <n> }` → statut `rendering`, action `final`
  - `{ "cancel": true }`
- `DELETE /api/montage/jobs/:id` (efface aussi les aperçus).
- `GET /api/montage/jobs/:id/versions/:n/preview` : l'aperçu MP4.
