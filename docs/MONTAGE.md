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
    source?: "mine" | "pexels" | "library"; // choisi dans la page ou rempli par le worker une fois le plan trouvé ; absent = à chercher
    ref?: string;                  // nom du fichier dans ~/Movies/Metricove/broll, id de la vidéo Pexels, ou id du média de la bibliothèque
    url?: string;                  // Pexels choisi dans la page : lien du fichier (https://videos.pexels.com/…), le Mac le prend sans clé
    from?: number;                 // seconde du plan où il commence (worker 0.13.0)
    sound?: number;                // volume du son du plan sous la voix, 0 à 1 ; absent = muet (worker 0.13.0)
    thumb?: string;                // petite image : data URL JPEG (≤ 40 Ko), image Pexels, ou /api/media/<id>/cover
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
- Références du profil (`refs`) : `examples` (posts modèles, 8 au plus), `ideas` (idées de posts) changent par le
  `PUT` ; `images` (images d'inspiration, 6 au plus) par `POST /api/profiles/:projectId/images?name=…` (corps =
  l'image, JPEG/PNG/WebP, 1,5 Mo au plus), `GET` et `DELETE /api/profiles/:projectId/images/:imageId`.
- Les tâches `script`, `caption` et `post` d'un projet portent `job.voice = { tone?, skill?, examples?, images? }`,
  copié à la création. Le worker met `tone` à la place de ses règles de ton d'origine ; si `skill` désigne un
  dossier qui contient un `SKILL.md`, il ajoute ce fichier au prompt (8 000 caractères au plus ; rien d'autre
  n'est lu) ; `examples` sont donnés comme modèles à imiter ; pour un `post`, il télécharge `images` (adresses
  `/api/profiles/…`) dans son dossier de travail et demande à Claude de les lire. Worker 0.3.0 pour le ton et le
  skill, 0.4.0 pour les références. Un worker plus ancien ignore ce qu'il ne connaît pas.
- Les tâches `montage` et `cover` reçoivent le profil au moment où le Mac les prend (`POST /api/montage/worker/claim`),
  sans qu'il soit enregistré dans la tâche : un montage dure plusieurs jours et suit ainsi le profil du jour.
  `job.voice = { tone?, skill? }` guide ce que Claude écrit et choisit (accroches, carton de fin, mots clés, emojis,
  musique, B-roll, accroche de couverture). `job.theme = { accent, ink, dark?, text?, font?, googleFont?, fontStretch? }`
  vient de l'apparence d'un profil **enregistré** (jamais d'un style de départ) et passe avant le thème du Mac :
  couleurs des sous-titres, du bandeau d'accroche, du carton de fin et des couvertures génériques. `googleFont`
  (police « Grotesque ») est téléchargée une fois dans `fontsDir` (`~/Movies/Metricove/polices`) ; sans réseau,
  les polices de secours servent. Worker 0.5.0.

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


### Reel animé (`kind: "motion"`, action `motion`)

Le Studio (onglet « Reel animé ») demande une vidéo 9:16 sans rush, faite de scènes de texte animées dans
l'apparence du projet.

- `POST /api/montage/jobs` avec `{ kind: "motion", scenes: [{ title, body }], look, music, projectId? }` : 1 à 8 scènes
  (titre 120 caractères, texte 240). `look` est vérifié comme celui d'un profil ; le logo n'est pas gardé dans la tâche,
  le Mac reçoit celui du profil du projet quand il prend la tâche (`job.motion.look.logo`).
- Les textes peuvent être écrits par Claude avec une tâche `post` qui porte `reel: true` (scènes courtes, faites pour être
  regardées).
- Worker 0.6.0 (`lib/motion.mjs`) : page HTML animée (GSAP) rendue par HyperFrames en MP4, polices Google téléchargées une
  fois, puis ffmpeg ajoute un morceau du dossier musique (`music`), sinon une piste muette. La vidéo est envoyée comme un
  rendu final (`POST /api/montage/jobs/:id/final`) : elle entre dans la bibliothèque et la tâche passe à `done` avec `mediaId`.
  Depuis le worker 0.9.0, ce chemin n'est plus qu'un repli : le reel devient la version 1 de sa tâche (voir « Écran de montage du reel »).
- Durée d'une scène : `min(7, max(2,8, 1,9 + 0,058 × caractères))` secondes, plus 1,2 s pour la dernière, le tout multiplié par le
  rythme (`calm` × 1,25, `fast` × 0,8). La page du Studio affiche la même estimation, ou une fourchette quand Claude
  choisit le rythme.
- `gsapFile` (config du Mac, facultatif) : copie locale de `gsap.min.js` pour rendre sans réseau.

#### Scènes libres (worker 0.7.0)

- Une scène peut porter `anim` (300 caractères) : une consigne de motion design (« des couvertures qui tombent en cascade »).
  Elle reste 1,5 s de plus à l'écran.
- Le Mac demande à Claude le code de ces scènes en une fois (`lib/motion-art.mjs`) : `{ index, html, css, js }` par scène.
  Le code vit dans `#sN .art` ; le worker garde le fond, la transition, la barre de progression, la signature et l'effacement.
- Vérifications avant le rendu (`checkArt`) : CSS limité à `#sN`, sans @règle ni animation CSS ; aucun lien externe, aucun
  script dans le HTML ; JS sans réseau, minuterie, `Date`, `Math.random` ni `window`, compilé à blanc. Puis
  `hyperframes validate` charge la page dans Chrome : une scène qui lève une erreur reprend l'animation standard.
- Si le rendu échoue quand même, le reel est refait avec l'animation standard partout. Les notes partent avec le rendu final (`notes`) : la page les montre.

#### Consignes pour tout le reel (worker 0.8.0)

- `direction` (1000 caractères) et `pace` (`calm`, `normal`, `fast`) dans la demande.
  Avec une consigne, `lib/motion-direct.mjs` demande à Claude, pour chaque scène, une entrée du texte (`rise`, `type`,
  `punch`, `slide`, `blur`), une transition (`auto`, `up`, `circle`, `side`, `cut`), un décor (`ring`, `dots`, `bars`,
  `none`), un mot en couleur, un compteur, et au besoin un calque HyperFrames `{ html, css, js }` placé derrière le texte
  (le `js` est le corps d'une fonction `(tl, gsap, root, t0, d, c)` qui ajoute ses animations à la timeline). Chaque calque
  est vérifié (`cleanLayer` : taille, balises permises, classes préfixées `k<n>-`, pas de réseau, pas de script, pas du
  mot `document` ni de remontée vers la page, css sans `@` ni animation) puis enfermé dans sa scène (css imbriqué sous
  `#x<i>`, html posé dans sa boîte, sélecteurs GSAP limités à la boîte par `gsap.context`). Un calque refusé laisse sa
  scène avec un décor prêt à l'emploi ; si le rendu échoue avec les calques, le reel est rendu une seconde fois sans eux.
  Ces replis sont dits à Antoine : le Mac envoie `notes` avec le rendu final, la page les montre. Sans `pace`, Claude
  choisit le rythme. `hyperframesReference` (config, facultatif) : notes HyperFrames données à Claude.
- Une scène qui porte sa propre consigne (`anim`) reste une scène libre : la consigne générale ne lui donne que sa transition.


#### Écran de montage du reel (worker 0.9.0)

Un reel généré n'arrive plus directement dans la bibliothèque : il devient la version 1 de sa tâche (`status: "review"`) et s'ouvre dans `/videos/montage/<id>` (`src/components/montage/reel-review.tsx`). Antoine le regarde, le retouche, puis le valide.

- **Plan** : chaque version garde `reel` (`ReelPlan`, `src/lib/montage.ts`) : les scènes dans l'ordre (`id`, textes, `fx`, durée voulue `seconds`, `cut`, durée rendue `dur`), le style, la musique (`music`, `volume`), le rythme. Le code écrit par Claude (`layer`, `art`) reste dans le plan côté serveur et Mac ; la page ne reçoit que `custom: "layer" | "art"` (`pageReel`). `renderPlan` (worker) refait exactement la vidéo d'un plan : les scènes non touchées gardent le même plan d'une version à l'autre (la barre de progression, le numéro et le bonus de durée de la dernière scène suivent leur place ; une scène libre garde les couleurs de la place pour laquelle elle a été écrite, `art.at`). Si un code tout juste écrit casse le rendu, il est retiré en premier et le code des autres scènes reste.
- **Première génération** : `POST /api/montage/jobs/:id/versions` avec `{ reel, notes, upload }`. Un ancien serveur répond 400 : le worker retombe alors sur `/final` (ancien comportement).
- **Demande à Claude** : `PATCH /jobs/:id { revise, marks?, range?: [début, fin], from? }` → action `motion`. Le worker (`lib/motion-revise.mjs`) ne laisse Claude modifier que les scènes qui recoupent le passage (plus de 0,15 s) ou qui portent une note dessinée ; tout changement ailleurs est ignoré. Sans passage ni note, toutes les scènes sont ouvertes. Le code rendu passe par les mêmes contrôles (`cleanLayer`, `checkArt`).
- **Retouche à la main** : `PATCH /jobs/:id { reel, from }` → nouvelle version `by: "edit"` et action `preview` (rendu sans Claude). Le serveur reprend le code des scènes par `id` depuis la version de départ (`cleanReel`) ; un texte modifié fait retomber une scène libre (`art`) en animation standard, car son code contenait l'ancien texte.
- **Validation** : `PATCH /jobs/:id { approve: n }` range l'aperçu de la version (déjà en pleine qualité) dans la bibliothèque, sans passer par le Mac.
- **Corps envoyés par le worker pour un reel** : `POST /versions` `{ reel, notes, upload }` ; `POST /versions/:n/preview` `{ upload, reel, notes? }`.
- **Échec d'une retouche** : si le reel a déjà une version avec vidéo, la tâche revient à `review` avec `error` (affichée dans la page) ; les versions retouchées à la main restées sans vidéo sont retirées, le texte de la demande est gardé pour être reformulé. Sans aucune version, la tâche passe à `failed` (bouton « Réessayer »).
- **Reprendre une demande** : `PATCH /jobs/:id { withdraw: true }` tant que le Mac n'a pas commencé (`status: "queued"`).
- **Ce que la page reçoit** : `pageJob` (`src/server/montage.ts`) retire le code de Claude et remplace les dessins par un lien ; seul `worker/claim` donne la tâche entière.

### Timelines et outils (worker 0.10.0)

Les deux écrans de montage (face caméra : `timeline.tsx` + `review-page.tsx` ; reel animé : `reel-timeline.tsx` + `reel-review.tsx`) partagent `src/components/montage/timeline-kit.tsx` :

- **Zoom** : 1 = toute la vidéo dans la largeur. Boutons, touches `+` `−` `0`, ⌘ ou Ctrl + molette (autour du pointeur). La vue suit la tête de lecture pendant la lecture.
- **Pistes** : images de la vidéo (extraites dans le navigateur depuis l'aperçu), plans ou scènes, son (forme d'onde décodée dans le navigateur ; abandonnée au-delà de 60 Mo).
- **Aimantation** aux débuts et fins de plans et à la tête de lecture (8 px).
- **Raccourcis** : Espace, ← → (une image, Maj : une seconde), J K L, S (couper à la tête de lecture), M (repère), Suppr (retirer), ⌘Z / ⇧⌘Z, Début / Fin. Jamais pris dans un champ de texte.
- **Annuler / rétablir** : pile locale à l'écran (80 pas), vidée quand une version arrive ou quand les modifications sont envoyées.

**Musique** — `MusicCue { start?, fadeIn?, fadeOut? }` (secondes) : `edl.audio.music.{track, start, fadeIn, fadeOut}` pour un montage, `reel.track` + `reel.cue` pour un reel. Le Mac annonce les fichiers de son dossier Musique dans `POST /worker/claim` (`tracks: string[]`, renvoyé à la page dans `worker.tracks`). Un morceau introuvable : le Mac prend le premier du dossier et le dit dans les notes de la version.

**Repères** — une note posée à la tête de lecture (touche M) est un `MontageMark` sans image (`{ id, version, t, text }`), envoyé avec `revise` comme les notes dessinées.

**Couverture d'un reel** — l'image affichée est prise dans le navigateur et envoyée après la validation par `PUT /api/media/:id/cover` (JPEG).

**Textes libres (worker 0.11.0)** — `texts: FreeText[]` dans `edl` (vidéo face caméra) et dans `reel` (reel animé), 12 au plus : `{ id, text, start, end, x, y, size: "s"|"m"|"l"|"xl", style: "plain"|"band" }`. `start` / `end` en secondes de la vidéo montée ; `x`, `y` : centre du texte, de 0 à 1 de l'image. Posés sans Claude depuis l'onglet « Textes » (composants `free-texts.tsx` : piste de la timeline, réglages, poignée sur la vidéo). Le Mac les dessine avec `worker/montage/lib/texts.mjs` : dans la surcouche des sous-titres pour une vidéo, dans la page du reel pour un reel. Une nouvelle proposition de Claude garde les textes de la version précédente.

**Vitesse d'un plan et recadrage (worker 0.12.0)** — `segment.speed` (0,5 à 2, absent = 1) : la durée du plan sur la timeline est divisée par la vitesse, dans `src/lib/montage.ts` comme dans `worker/montage/lib/edl.mjs` (`timeline`, `toTimeline`, `toRush`, `renderPlan`). Le rendu ralentit ou accélère l'image (`setpts`) et le son (`atempo`, sans changer la hauteur de la voix). Pour un passage seulement : le couper d'abord avec S. `zoom.hold: true` : plan serré fixe (recadrage), le même grossissement (jusqu'à ×2) tout le passage, sans mouvement ; il ne compte pas dans l'alternance avant / arrière des autres zooms.

**Piste Sous-titres (worker 0.13.0)** — les blocs de sous-titres sont calculés de la même façon dans l'éditeur (`captionBlocks` dans `src/lib/montage.ts`) et sur le Mac (`chunksOf` dans `worker/montage/lib/hf.mjs`) : 2 lignes au plus, coupe sur la ponctuation, les silences de plus de 0,35 s et les changements de plan. Deux marques posées à la main sur les mots (`EdlWord`) : `brk` (un bloc commence à ce mot) et `glue` (pas de coupe avant ce mot, 3 lignes au plus). Dans la piste (`caption-track.tsx`) : double-clic pour corriger le texte d'un bloc (même nombre de mots : chaque mot garde son temps ; sinon les nouveaux mots se partagent le temps du bloc ; le son ne change pas), tirer la limite entre deux blocs, couper un bloc à un mot, fusionner avec le suivant, mettre un mot en couleur ou lui ajouter un emoji. Chaque changement fige d'abord les blocs du plan tels qu'ils sont affichés, pour que les blocs suivants ne bougent pas.

**B-roll choisi à la main (worker 0.13.0)** — dans l'inspecteur d'un plan de B-roll, « Choisir le plan » ouvre `broll-picker.tsx` : les plans du dossier B-roll du Mac (le worker envoie `brolls: [{ name, thumb, dur }]` avec sa demande de travail quand le dossier change ; vignettes gardées dans `broll-cache/vignettes.json` ; `GET /api/broll`), les vidéos de la bibliothèque (le Mac les télécharge par `/api/media/:id/file` dans `broll-cache`), ou une recherche Pexels faite par le serveur (`GET /api/broll/pexels?q=&format=` ; clé dans Réglages → B-roll Pexels, ou `PEXELS_KEY` dans le .env). Réglages du plan : son (Muet, Discret 20 %, Moyen 50 %, Fort 100 %, mélangé sous la voix) et début dans le plan. Les blocs de la piste montrent la vignette, le mode (plein écran ou incrusté) et une icône quand le son est gardé.

**« Claude, propose du B-roll ici » (worker 0.13.0)** — glisser sur la piste B-roll choisit un passage (un clic seul ajoute un plan de 2 s). `PATCH /api/montage/jobs/:id` `{ brollAsk: { range: [de, à], note? }, edl }` : l'EDL à l'écran devient une version « edit », `job.brollAsk` est gardé et l'action `broll` part au Mac. Le worker donne à Claude les mots dits dans le passage (temps de timeline) et les fichiers du dossier B-roll (`proposeBroll`), garde 1 à 3 plans entièrement dans le passage, remplace ceux qui y étaient, cherche les fichiers, rend l'aperçu et l'envoie avec `POST …/versions/:n/preview` `{ upload, broll, notes }`. Si Claude échoue, l'aperçu part quand même avec une note, sans changement dans le passage.
