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

Next.js 15.5.28 est corrigé par `patches/next@15.5.28.patch` (`patchedDependencies` de `pnpm-workspace.yaml`, copié par le Dockerfile avant `pnpm install`). Avec un middleware en runtime Node.js, Next n'attendait pas la remise en place du corps de la requête après le middleware : en production, tout corps encore en route (au-delà d'environ 64 Ko : morceau d'envoi, planche d'un reel, image) arrivait « disturbed » à la route, d'où un 500 en page HTML (« Response body object should not be disturbed or locked ») avant notre code. `pnpm dev` ne le montre pas. À la prochaine montée de version de Next, vérifier si le correctif (`await requestData.body.finalize()` dans `dist/server/next-server.js`) est arrivé, sinon refaire le patch.

## Tâches

```ts
type Job = {
  id: string;
  kind: "montage" | "script" | "caption" | "cover" | "post" | "motion" | "brand" | "plan" | "asset";
  title: string;
  projectId?: string;
  status: "queued" | "working" | "review" | "rendering" | "done" | "failed" | "cancelled";
  /** Ce que le worker doit faire maintenant (null = rien). */
  action: null | "propose" | "preview" | "final" | "script" | "caption" | "cover" | "post" | "motion" | "broll";
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
  minWorker?: string;     // plus ancien worker qui peut prendre le job ("0.15.0" pour un reel vidéo)
  run?: JobRun;           // état vivant d'un job pris (voir « Reel vidéo continu »)
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

**Autre prise (A-roll)** — dans l'inspecteur d'un plan, « Autre prise » liste les passages coupés qui disent la même chose (mots en commun, `otherTakes` dans `src/lib/montage.ts`). Le choix prend la place du plan dans l'ordre du montage, avec sa vitesse ; l'ancien plan passe dans les coupés (« autre prise »). Rien à faire côté Mac.

### Reel vidéo continu (worker 0.15.0)

> Contrat entre le site et le Mac pour METRI-16/17. Les types font foi dans `src/lib/montage.ts` et `src/lib/worker-version.ts` ; le nettoyage côté serveur dans `src/server/montage.ts` ; le moteur et la chaîne du Mac dans `worker/montage/lib/reel/`. Les anciens reels à scènes (sections précédentes) ne changent pas.

Un reel vidéo est **un seul plan continu**, pas une suite de cartes. Claude écrit la *partition* (3 à 12 temps forts et la façon dont chacun naît du précédent) et au plus 3 *moments* HyperFrames sur mesure, enfermés dans un bac à sable. Le moteur du Mac (`worker/montage/lib/reel/`) compile le tout en une composition HyperFrames 1080×1920 à 30 i/s : une scène, une caméra, une timeline GSAP en pause. Il possède la typographie, la zone sûre, la marque, le déterminisme et la continuité. Un rendu moteur seul, sans moment, est toujours possible (plancher de repli).

#### Plan d'une vidéo

Une version garde `reel: ReelPlan`. Un plan vidéo est un `ReelPlan` qui porte `video` et dont `scenes` vaut `[]` ; `pace` est le rythme de toute la vidéo ; `look`, `logo`, `music`, `volume`, `track`, `cue` et `texts` gardent leur sens. Tout ce qui teste `v.reel && v.preview` (retrait, échec renvoyé en review, base d'une retouche, édition à la main, validation) continue de marcher.

```ts
type ReelVideo = {
  engine: 1;                 // VIDEO_ENGINE : un plan d'un moteur plus récent est refusé, jamais deviné
  request: string;           // ≤ 4000, la demande d'Antoine
  source: "idea" | "script" | "post";
  target?: 15 | 30 | 45 | 60;// absent = Auto
  direction?: string;        // ≤ 1000, mise en scène facultative
  title: string;             // ≤ 80, titre écrit par Claude
  shape: "orb" | "line" | "none";  // forme de marque qui vit d'un bout à l'autre
  beats: ReelBeat[];         // 3 à 12 écrits, 2 gardés au moins
  moments: ReelMoment[];     // ≤ 3
  caption?: string;          // ≤ 2200, description du post écrite avec la vidéo
  seed: number;              // uint32 : hachage de job.id (job.id + n à une régénération), fixe ensuite
  tools?: { worker?: string; hyperframes?: string };
  captions?, voiceOver?, motionStyle?  // réservés (METRI-18, METRI-27/28), jamais lus en v1
};
type ReelBeat = {            // un repère de la vidéo : une idée
  id: string;                // /^[a-z][a-z0-9-]{0,23}$/ (VIDEO_BEAT_ID), stable d'une version à l'autre
  title: string;             // ≤ 40, nom du repère
  text: string;              // ≤ 110
  sub?: string;              // ≤ 160 (layout cta : texte de la pastille, « Abonne-toi » par défaut)
  items?: string[];          // layout list : 2 à 4 de ≤ 40
  emphasis?: string;         // ≤ 60, mots recopiés de text
  count?: boolean;           // layout number : le nombre compte
  layout: "hero" | "stack" | "number" | "list" | "cta";
  bridge: "rise" | "morph" | "carry" | "zoom" | "cut";   // naissance depuis le précédent (ignorée sur le premier)
  actor: "rest" | "dot" | "underline" | "highlight" | "bar" | "hidden";
  camera: "drift" | "push" | "still";
  seconds: number;           // durée voulue 1,5–10 (lire avec reelBeatSeconds)
  fixed?: boolean;           // posée à la main : gardée telle quelle
  cut?: boolean;             // coupé à la main, gardé dans le plan
  say?: string;              // réservé METRI-18
  start?: number; end?: number;  // secondes de la vidéo, écrites par le Mac seulement
};
type ReelMoment = {          // visuel sur mesure sur 1 à 3 temps forts consécutifs (sans limite pour behind)
  id: string;                // /^[a-z][a-z0-9]{0,11}$/ (VIDEO_MOMENT_ID)
  brief: string;             // ≤ 200, affiché dans la page
  from: string; to: string;  // ids de temps forts
  zone: "above" | "below" | "behind" | "full";
  code?: { html: string; css: string; js: string };  // serveur et Mac seulement (12k / 8k / 12k, 60k en tout)
  custom?: boolean;          // côté page : le code existe sur le serveur (false = retiré à la main)
};
```

Constantes partagées (`src/lib/montage.ts`) : `VIDEO_WORKER = "0.15.0"`, `VIDEO_ENGINE = 1`, les listes `REEL_LAYOUTS`, `REEL_BRIDGES`, `REEL_ACTORS`, `REEL_CAMERAS`, `REEL_ZONES`, `REEL_SHAPES`, `REEL_SOURCES`, `REEL_TARGETS` (une par ligne : `reel-vocab.test.mjs` les compare à `lib/reel/vocab.mjs`), `REEL_VIDEO` (limites de la demande, des temps forts, des durées), `READ_PACE`, `VIDEO_LIMITS` (longueurs des textes et du code), `VIDEO_BUDGETS` (caractères par layout à la taille de départ : hero 60 ; stack 90 + sub 160 ; number 40 + sub 120 ; list 50 + items de 40 ; cta 50 + sub 60), `VIDEO_BEAT_ID`, `VIDEO_MOMENT_ID`.

Le choix se fait toujours sur `isVideoJob(job)` (`kind === "motion"` et `motion.mode === "video"` ou une version avec `reel.video`) et sur `v.reel.video`, jamais sur une forme devinée. Les anciens plans à scènes (art, layer, fx, dur) n'ont pas `video` : `cleanReel`, `renderPlan`, `reviseMotion`, `ReelReview` et `reelTimeline` les traitent comme avant. `MontageVersion.edl` reste `EMPTY_EDL` 9:16.

#### Durée d'un temps fort (même formule dans la page et sur le Mac)

`reelBeatSeconds(beat, last, pace)` (`src/lib/montage.ts`) et `score.mjs` (worker) calculent exactement la même chose :

- mots = morceaux séparés par des espaces (espaces insécables compris, `\s`) qui contiennent au moins une lettre ou un chiffre (`/[\p{L}\p{N}]/u`) ; on compte ceux de `text`, `sub` et de chaque item ;
- lecture minimale (`reelReadSeconds`) = (0,9 + 0,28 × mots + 0,6 si `count` + 0,3 × nombre d'items) × `READ_PACE[pace]` (calm 1,15, normal 1, fast 0,88) ;
- durée = `fixed` ? `seconds` : max(`seconds`, lecture minimale), puis bornée à 1,5–10 s ; le dernier temps fort gardé fait au moins 2,5 s (`REEL_VIDEO.last`, aussi quand il est `fixed`) ; puis arrondie à l'image (`Math.round(s × 30) / 30`).

`cleanScore` écrit dans `seconds` les durées après mise à l'échelle vers la cible : un recalcul sans cible redonne donc les mêmes temps. Les temps forts gardés se suivent bout à bout : start₀ = 0, endᵢ = arrondi à l'image de (startᵢ + durée), startᵢ₊₁ = endᵢ ; la durée de la vidéo est la fin du dernier.

- `videoTimeline(plan, rendered)` : les temps forts gardés au format de `reelTimeline()` (`scene.title` = nom du repère, `scene.body` = texte, `scene.custom = "art"` quand un moment vivant couvre le temps fort). Avec `rendered`, les `start`/`end` écrits par le Mac, si tous les temps forts gardés les ont ; sinon bout à bout avec `reelBeatSeconds`.
- `reelSettle({ start, end })` = start + min(1,2 ; 0,6 × (end − start)) : l'instant où le temps fort est posé (tuile de la planche, couverture).

#### Tâche

- `job.motion` (vidéo) : `{ mode: "video", scenes: [], request, source, seconds?, pace?, direction?, music, track?, logo, look, project? }`. Le logo n'est jamais stocké : la route claim l'injecte dans `motion.look.logo`, comme aujourd'hui.
- `job.minWorker = "0.15.0"` sur un job vidéo ; absent sur les autres (n'importe quel worker les prend).
- `job.regen` : la prochaine action `motion` écrit une nouvelle vidéo à partir de la demande (version n+1, nouvelle graine) au lieu de retoucher.
- `job.run` (`JobRun`), état vivant d'un job pris, en heures du serveur ; `queue()` et `release()` l'effacent :
  `{ startedAt, by?, beatAt, phase?, phases?, phaseAt?, etaAt?, frames?: [i, n], beats?: [{ id, title, start, end }], board?: { v, n, frames: [{ id, t }] }, done?: [{ phase, s }] }`.
- Phases (`JOB_PHASES`) : `write`, `check`, `review`, `render`, `finish`, `upload`. Prévues : création `write, check, review, render, finish, upload` (review retirée si la relecture est sautée) ; retouche `write, check, render, finish, upload` ; édition à la main (`preview`) `check, render, finish, upload`.
- `job.ahead` : réponses GET seulement, jamais stocké (jobs avec une action créés avant celui-ci).

#### Contrats HTTP

Page → serveur :
- `POST /api/montage/jobs` `{ kind: "motion", mode: "video", request, source?, seconds?, pace?, direction?, music, track?, logo, look, projectId }` → 201. `videoJob()` stocke `motion` (ci-dessus, look sans logo), `minWorker: "0.15.0"`, `brief: { format: "9:16", seconds }`, `status: "queued"`, `action: "motion"`, titre « Reel animé : <première ligne de la demande, ≤ 60> ». Moins de 10 caractères → 400 « Écris ta demande (10 caractères au moins) ». `{ kind: "motion", scenes }` sans `mode` reste l'ancien chemin.
- `PATCH /api/montage/jobs/:id` :
  - `{ regenerate: true, request?, seconds? }` → 409 « Le Mac travaille déjà sur ce reel » si le job a une action, 400 si ce n'est pas une vidéo (ou une demande de moins de 10 caractères) ; sinon met à jour `motion.request` et `motion.seconds` (+ `brief.seconds`) s'ils sont donnés (`seconds` hors de 15/30/45/60, `null` compris = Auto), `regen = true`, efface `feedback`, `marks`, `range`, `base`, puis `queue("motion")`.
  - `{ stop: true }` → seulement un reel VIDÉO (`isVideoJob`) avec une action et une version `reel` + aperçu, sinon 400 « Rien à rétablir : annule plutôt ». Un reel vidéo sans action (le Mac a fini entre le clic, après le `confirm()`, et la requête) → 200 avec le job tel quel, comme `withdraw` ; fait `restoreReel`, `regen = undefined`, `release("review")`. Une première génération s'annule par `DELETE`. Un reel à scènes n'a pas `stop` : son worker ne s'arrête que sur un 404 (job supprimé), jamais sur `action: null` ; il garde `withdraw` et `cancel`.
  - Inchangés : `{ revise, marks?, range?, from? }` (`revise: ""` sans version = Réessayer), `{ reel, from }` (édition à la main), `{ approve: n }`, `{ withdraw: true }`, `{ cancel: true }`, `DELETE`. `withdraw`, `cancel` et une retouche (`revise` sur un reel) effacent aussi `regen` : une régénération reprise ou annulée ne revient jamais avec la retouche suivante (le Mac choisit `makeVideo` dès que `regen` est posé).
- `GET /api/montage` ajoute `now` (ms du serveur) et `ahead` sur les jobs en attente. `GET /api/montage/jobs/:id` → `{ job: pageJob, worker: workerStatus(), now }` (le Mac ne lit que le statut 404 et `.job`). `GET /api/montage/jobs` passe aussi par `pageJob`.
- `workerStatus()` → `{ online, lastSeen?, name?, version?, tracks?, busy?: { id, title }, silent?, speed?: { frameMs?, writeS? } }` (type `WorkerStatus` de `use-montage.ts`). `busy` ne compte que tant que le Mac tient ce job : une action ET pas en file (fini, arrêté ou supprimé : le Mac est libre ; de nouveau en file après un arrêt : personne ne l'a encore réclamé).
- `GET /api/montage/jobs/:id/board?v=<run.board.v>` → l'image de la planche (`image/jpeg`, `private, no-store`), 404 s'il n'y en a pas. Elle reste dans `DATA_DIR/montage/<id>/` jusqu'à la validation (`dropPreviews`) ou la suppression du job.

Mac → serveur :
- `POST /api/montage/worker/claim` `{ worker, version, tracks?, brolls?, speed?: { frameMs, writeS } }`. `claimJob(version)` saute les jobs où `!atLeast(version, job.minWorker)` et pose `run = { startedAt, by: version, beatAt }` (pour tout job, quel que soit le worker : le Studio connaît toujours le temps écoulé). Pour une vidéo, la réponse ajoute `job.voice = { tone, skill, examples, images, strategy }` (`voiceOf` ; `strategy` = la stratégie digitale du projet, donnée à Claude avec les modèles ; `images` = adresses `/api/profiles/:id/images/:img` que le Mac télécharge avec son jeton) et le logo dans `motion.look.logo`. `speed` est gardé (bornes : `frameMs` 1–10 000, `writeS` 1–3600) pour l'estimation « prête dans environ N min » de la page.
- Identité du passage : chaque écriture du worker (`PATCH`, `POST /board`, `POST /versions`, `POST /versions/:n/preview`) peut porter `run` = le `run.startedAt` reçu à la réclamation (facultatif, worker ≥ 0.15.0). `staleWrite(job, run)` répond 409 sans rien enregistrer (l'envoi d'une version refusée est effacé aussitôt) quand :
  - `run` est donné et diffère de `job.run?.startedAt` (passage arrêté, annulé, ou repris par une autre réclamation : `queue()` et `release()` effacent `run`, une réclamation en pose un nouveau) ;
  - `run` est absent et le job est une vidéo sans action (arrêtée, annulée, finie) ou de nouveau en file (une nouvelle demande faite après un arrêt, que personne n'a encore réclamée). Ainsi la version, la planche, le PATCH ou l'échec tardif d'un passage arrêté n'efface plus la demande qui suit et ne remet plus l'ancien passage à l'écran.
  - Les autres jobs sans `run` (anciens workers, reels à scènes, face caméra, textes…) gardent leur comportement, sauf un PATCH de progression sur un job sans action ou en file : ignoré (200, rien d'enregistré, le Mac n'est pas marqué occupé).
  - Le worker 0.15.0 DOIT traiter ce 409 comme l'ordre de s'arrêter, tout de suite (pas seulement comme une écriture perdue) : sur un PATCH de progression, sur la planche, sur la version et sur l'aperçu (`handleVideo`, `lib/reel/index.mjs` : `ended(e)` → `controller.abort(cancelled(…))`), puis aucun `PATCH failed`. C'est le SEUL signal qu'il reçoit quand la page a cliqué « Arrêter » puis fait une nouvelle demande avant sa veille suivante : le job est alors de nouveau en file avec une action, sans `run`, et la veille (404, `action: null`, ou `run.startedAt` présent et différent) ne voit rien. Un 404 (job supprimé) arrête de la même façon.
  - Une écriture refusée rafraîchit la présence du Mac (`workerSeen({})`, sans le marquer occupé) : la carte de la nouvelle demande ne lit pas « Ton Mac est éteint » pendant que le Mac lâche l'ancien passage.
- `PATCH /api/montage/jobs/:id` `{ step, progress, phase?, phases?, eta?, frames?, beats?, done?, run? }`. `step` (≤ 200) et `progress` (0..1) sont TOUJOURS envoyés (ancien serveur, ancienne page). Le serveur valide : `phase` dans `JOB_PHASES` ; `phases` ⊂ `JOB_PHASES`, ≤ 6 ; `eta` en secondes 0..3600 ; `frames` [i, n] entiers, 0 ≤ i ≤ n ≤ 20000 ; `beats` ≤ 12 `{ id: VIDEO_BEAT_ID, title ≤ 40, 0 ≤ start < end ≤ 61 }` ; `done` ≤ 6 `{ phase, s: 0..3600 }`. Puis `run.beatAt = maintenant`, `run.phaseAt = maintenant` si la phase change, `run.etaAt = maintenant + eta`, `touchWorker(job.id)`. Au plus un PATCH toutes les 1,5 s, plus un à chaque changement de phase ; battement de 15 s qui renvoie le dernier corps. Un ancien serveur ignore les champs en plus.
- `POST /api/montage/jobs/:id/board` `{ image: "data:image/jpeg;base64,…" (≤ 800 000 caractères, ≤ 600 Ko décodés, un vrai JPEG FF D8 … FF D9), frames: [{ id: VIDEO_BEAT_ID, t: 0..61 }] (1 à 12), run? }` → 200 `{ board }`, `DATA_DIR/montage/<id>/board.jpg` et `run.board = { v: Date.now(), n, frames }` (constantes `VIDEO_BOARD`). 400 « Planche réservée aux reels vidéo » pour un autre job (texte, description, face caméra…), 400 si le corps n'est pas un objet, 400 avec la raison en français si l'image ou les tuiles sont invalides ; 409 si le passage est terminé (`staleWrite` : arrêté, fini, de nouveau en file, ou `run` différent). Planche-sprite : tuiles 180×320 côte à côte, une par temps fort gardé, à son instant posé (`reelSettle`). Un ancien serveur répond 404 : le Mac l'ignore.
- `POST /api/montage/jobs/:id/versions` `{ reel, notes (≤ 2000), upload, run? }` (409 si le passage est terminé, voir l'identité du passage). À la première version vidéo, le job devient « Reel animé : <video.title> » et `regen` est effacé. Un 400 sur un plan vidéo fait échouer le job avec « Metricove ne connaît pas encore les reels vidéo : mets le site à jour. » : JAMAIS de repli `/final` pour une vidéo (le repli reste pour une première génération à scènes). Toute réponse refusée (400, 404, 409) efface aussitôt l'envoi (`dropUpload`) au lieu de le garder 24 h : le repli `/final` d'un ancien worker renvoie son fichier avant (`api.upload` de nouveau dans `jobs.mjs`). Comme toutes les réponses aux routes du worker (`/versions`, `/versions/:n/preview`, `/final`, `PATCH` d'échec ou de fin), elle passe par `pageJob` : jamais de code de moment, même vers le Mac.
- `POST /api/montage/jobs/:id/versions/:n/preview` `{ upload, reel, notes, run? }` : inchangé (`cleanReel` sans base accepte le plan vidéo du Mac ; les textes posés à la main sont gardés), sauf le 409 d'un passage terminé (une nouvelle édition faite après un arrêt peut reprendre le même numéro de version).
- Un PATCH de progression qui arrive sur un job sans action ou en file n'enregistre rien (ni `step`, ni `progress`, ni `run`, ni l'état occupé) ; une réclamation d'un job vidéo repart toujours sans `step`/`progress`.
- Ordre des routes d'écriture du worker (`PATCH`, `/board`, `/versions`, `/versions/:n/preview`) : le corps est lu EN ENTIER avant `getJob()`. Tout ce qui suit est synchrone (better-sqlite3, `fs.*Sync`), donc la vérification (`staleWrite`) et l'enregistrement (`saveJob`, un upsert) voient un arrêt, une annulation ou un `DELETE` arrivé pendant l'envoi du corps : une planche de 800 Ko en route pendant un `DELETE` ne recrée pas le job. Un corps JSON `null` (ou illisible) vaut `{}` (jamais de 500).

Nettoyage côté serveur (`cleanReel` → `cleanVideo`) :
- Depuis le Mac (sans base) : `engine === 1`, sinon « Moteur vidéo inconnu : mets le site à jour » ; textes bornés par `VIDEO_LIMITS`, listes forcées, `seconds` 1,5–10, `start`/`end` gardés si 0 ≤ start < end ≤ 61 ; ≤ 12 temps forts aux ids uniques ; ≤ 3 moments aux ids uniques dont `from`/`to` existent ; code au-delà de 12k/8k/12k par moment ou 60k en tout → « Code des animations trop long ». `scenes = []` et la règle « Garde au moins une scène » est sautée.
- Depuis la page (avec base) : `engine`, `request`, `source`, `target`, `direction`, `title`, `shape`, `caption`, `seed`, `tools` et les champs réservés viennent TOUJOURS de `base.video` ; temps forts : seuls les ids de la base, champs modifiables `title`, `text`, `sub`, `items`, `emphasis`, `count`, `layout`, `bridge`, `actor`, `camera`, `seconds`, `fixed`, `cut` et l'ordre, `start`/`end` retirés ; moments : gardés seulement si la base a l'id ET que la page envoie `custom: true`, avec `brief`, `from`, `to`, `zone` et `code` de la base ; au moins 2 temps forts gardés, sinon « Garde au moins deux temps forts ». `duration` vient du Mac seulement.
- `pageReel` : `video.moments` sans `code`, avec `custom: !!code`. Le code ne va jamais au navigateur.

#### Vie d'un reel vidéo

1. **Création** (page) : `POST /api/montage/jobs` `{ kind: "motion", mode: "video", … }` → job `queued`, action `motion`, `minWorker: "0.15.0"`. La page suit le job avec `GET /api/montage/jobs/:id` (toutes les 2 s tant qu'il est en file ou en cours).
2. **Attente** : un Mac plus ancien que 0.15.0, ou qui ne dit pas sa version, reçoit 204 ; le job attend, `ahead` donne sa place dans la file et `worker` dit pourquoi (hors ligne, occupé, trop ancien).
3. **Réclamation** par un Mac ≥ 0.15.0 : `run = { startedAt, by, beatAt }`, `status: "working"`, `step: "Pris en charge par le Mac"` ; le job arrive avec `voice` et le logo.
4. **Écriture, vérification, relecture, rendu, finition, envoi** : `PATCH { step, progress, phase, phases, eta, frames?, beats?, done? }` au plus toutes les 1,5 s et toutes les 15 s au moins ; `beats` dès que la partition est connue (avant le rendu) ; `POST /board` après les premières images (vers 40 %).
5. **Fin** : `POST /versions { reel, notes, upload }` → version `claude` avec aperçu, `release("review")`, `run` effacé, titre « Reel animé : <video.title> » à la première vidéo.
6. **Ensuite**, depuis l'écran de retouche ou le Studio :
   - retouche d'un passage par Claude : `PATCH { revise, marks?, range, from }` → action `motion` avec `job.base` → le Mac (`reviseVideo`) ne réécrit que les temps forts ouverts → `POST /versions` ;
   - édition à la main : `PATCH { reel, from }` → version `edit`, action `preview` → le Mac (`renderVideo`) rend le plan stocké SANS Claude (le code hérité repasse le bac à sable) → `POST /versions/:n/preview` ;
   - régénérer : `PATCH { regenerate: true }` → action `motion` avec `regen` → nouvelle vidéo (version n+1, nouvelle graine, idée différente demandée) ;
   - arrêter : `PATCH { stop: true }` → `restoreReel`, `release("review")`. Le Mac s'arrête à la PREMIÈRE de ces deux choses : sa veille (toutes les 10 s) voit `action: null`, ou sa prochaine écriture (un PATCH de progression part au plus toutes les 1,5 s pendant le travail, et au moins toutes les 15 s avec le battement) reçoit 409 (`staleWrite`). Si une nouvelle demande (régénérer, retouche, édition) a été mise en file avant la veille suivante, la veille ne voit plus rien (une action, pas de `run`) : seul le 409 l'arrête, donc en 15 s au plus (mesuré : 1,5 s, scénario `stop-regen`). Il tue alors ses processus, n'envoie ni version, ni aperçu, ni planche, et ne doit envoyer aucun `PATCH failed` (s'il en envoie un, il porte l'ancien `run` et reçoit 409 : la nouvelle demande reste intacte). Puis il réclame la nouvelle demande ;
   - valider : `PATCH { approve: n }` → média dans la bibliothèque (planche et aperçus supprimés), puis `PUT /api/media/:id/cover`.
7. **Échec** : `PATCH { status: "failed", error }` → `regen` effacé ; s'il existe une version avec aperçu : `restoreReel` et `release("review")` (la dernière bonne version reste jouable, l'erreur est affichée) ; sinon `failed` (le job n'est plus supprimé par le Studio : Réessayer = `PATCH { revise: "" }`).

#### Porte de version et présence du Mac

- `atLeast(version, min)` (`src/lib/worker-version.ts`) compare des triplets numériques ; une version absente ou illisible vaut `"0.0.0"` ; `min` absent = pas de minimum (vrai). Un Mac jamais vu, ou une réclamation sans version, ne reçoit aucun job à `minWorker`.
- `workerSeen(info, { idle })` garde la version, `tracks` et `speed` précédents quand ils manquent (la route scan n'efface plus la version) ; la route claim passe `idle: true` (efface `busy`). `touchWorker(jobId)` : `at = maintenant`, `busy = jobId`.
- `online` = vu depuis moins de 30 s, ou occupé et vu depuis moins de 90 s ; `silent` = occupé et sans nouvelles depuis 45 s pour un job vidéo tenu par un worker ≥ 0.15.0 (`run.by`), 120 s sinon. Le battement de 15 s n'existe que sur le chemin vidéo du worker 0.15.0 (`Progress`) : ses autres chemins (texte de prompteur, description, post, couverture, face caméra, reels à scènes) battent toujours toutes les 60 s, comme les anciens workers.
- Reprise : une réclamation est périmée après 15 min, ou après 90 s pour un job vidéo dont `run.by` ≥ 0.15.0 (battement de 15 s ; `workDir/worker.lock` garantit un seul worker). Un job vidéo repris repart avec un nouveau `run` (`startedAt` change : l'ancien worker, s'il revient, s'arrête) et sans `step`/`progress` de l'essai précédent. Un job pris par un worker plus ancien garde les 15 min.
- Tout PATCH de progression et toute planche du passage en cours rafraîchissent la présence (`touchWorker`), quelle que soit la version du worker : un Mac occupé n'apparaît plus « hors ligne » au bout de 30 s. Une écriture refusée par `staleWrite` rafraîchit la présence sans marquer le Mac occupé (`workerSeen({})` : nom, version, pistes et vitesse gardés ; `busy` laissé, et `workerStatus` ne compte plus un job qui n'est pas au Mac). Un PATCH de progression d'un ancien worker sur un job sans action ou en file n'est pas refusé (200) et ne touche pas la présence.

#### Modules du worker (`worker/montage/lib/reel/`)

Nouveaux fichiers seulement ; `motion.mjs`, `motion-direct.mjs`, `motion-art.mjs` et `motion-revise.mjs` ne changent pas. Aucun fichier n'appartient à deux paquets.

`Finding = { code: string, severity: "block" | "review" | "note", target: "engine" | "moment:<id>" | "beat:<id>", message: string (français), fixHint?: string }`.

Paquet A (moteur, interfaces figées) :
- `vocab.mjs` : la source unique du vocabulaire, lue par le moteur, le bac à sable ET le prompt. Listes `LAYOUTS`, `BRIDGES`, `ACTORS`, `CAMERAS`, `ZONES`, `SHAPES`, `SOURCES`, `TARGETS`, `PACES` (égales aux `REEL_*` de `src/lib/montage.ts`, même ordre) ; `VIDEO` (= `REEL_VIDEO`), `READ_PACE`, `VIDEO_LIMITS`, `BUDGETS` (= `VIDEO_BUDGETS`), `BEAT_ID`, `MOMENT_ID`, `DEFAULTS` ; durées et règles (`READ`, `TIMING`, `RULES`, `RHYTHM` : décalage des mots 0,07 / 0,05 / 0,035 s, liaison 0,9 / 0,7 / 0,5 s) ; cadres (`SAFE` x 90–990 y 280–1450, `CAPS_BAND` y 1450–1700 réservée aux sous-titres, `ZONE_FRAMES` : `above` moment x90 y280 900×620 et texte y940–1440, `below` texte y300–860 et moment x90 y900 900×540, `behind` plein cadre, `full` moment x90 y420 900×1020 et surtitre y290–400) ; `TYPE` (tailles de départ, planchers, pas ×0,94) ; constantes de mouvement (`EASE`, `ENTER`, `BRIDGE`, `ACTOR`, `CAMERA`, `DECOR`, `COUNT`, `CHROME`) ; listes du bac à sable (`MOMENT`, `CODE`, `MOMENT_TAGS`, `MOMENT_ATTRS`, `BANNED_IDENTIFIERS`, `BANNED_METHODS`, `BANNED_PROPS`…) ; `FONTS` copiée de `motion.mjs` ; `INFO` (libellés français et « quand l'utiliser ») ; `TS_MIRROR` (pour `reel-vocab.test.mjs`) ; fonctions pures `countWords`, `minSeconds`, `beatSeconds` (= `reelBeatSeconds`), `settleAt` (= `reelSettle`), `quantize`, `seedOf(jobId, n?)` (FNV-1a 32 bits de `job.id`, ou de `"<job.id>#<n>"` à une régénération, n = numéro de la version créée) et `grammarLines()` (section « grammaire » du prompt).
- `score.mjs` :
  - `cleanScore(raw, { target, pace, base, seed, request, source, direction })` → `{ video, pace, fixes: string[], findings: Finding[] }` (`request`, `source`, `direction` : champs d'en-tête repris de la tâche). `raw` = sortie de `SCORE_SCHEMA` (ou un `ReelVideo`) ; `target` = secondes ou absent (Auto) ; `pace` = rythme imposé ou absent ; `base` = `ReelVideo` d'avant (relecture, retouche) ; `seed` = uint32 calculé par B (création : hachage de `job.id` ; régénération : `job.id` + n ; sinon `base.seed`). Le `pace` rendu (imposé, sinon celui de Claude, sinon `normal`) va dans `ReelPlan.pace`. `fixes` = lignes en français pour les notes.
  - `timeScore(video, { pace })` → `{ video, duration, settle: number[] }` : `start`/`end` sur les temps forts gardés (formule ci-dessus), `duration` = fin du dernier, `settle` = un instant posé par temps fort gardé.
  - `lintScore(video, { pace })` → `Finding[]` (`texte_trop_long`, `accroche_trop_longue`, `monotone`, `appel_absent`, `trop_long` ; severity `review` ou `note`).
  - `openBeats(video, { range, marks, pace })` → ids des temps forts ouverts (recoupent le passage de plus de 0,15 s, ou contiennent l'instant d'une note ; tous sans passage ni note).
  - `mergeRevision(video, rev, open)` → `{ video, changed: boolean, ignored: string[], fresh: Set<string> }` (`rev` = sortie de `REVISE_SCHEMA` ; temps forts verrouillés identiques à l'octet hors `start`/`end` ; `fresh` = ids des moments remplacés ou nouveaux).
  - `applyReview(video, patch)` → `{ video, fresh: Set<string> }` (`patch` = sortie de `REVIEW_SCHEMA` ; l'appelant repasse ensuite par `cleanScore` avec `base`).
- `sandbox.mjs` : `checkMoments(moments)` (tailles cumulées) et `checkMoment(m, { id })` → `{ ok: true, code: { html, css, js }, advice?: string[] }` | `{ ok: false, why: string[] }` (règles de la section sécurité du design ; `advice` : couleurs hors palette, pour la relecture).
- `stage.mjs` : `stagePage(cfg, plan, hfDir, { safe, notes })` → `Promise<{ duration, settle: number[], marks: [{ id, title, start, end }], momentIds: string[] }>`.
  - `plan` : `ReelPlan` vidéo nettoyé, `look.logo` en data URL (réinjecté par l'appelant), `texts`, `pace`. stagePage appelle `timeScore` lui-même et écrit les temps dans `score.js`.
  - Il ne construit que les moments qui ont `code` (déjà passé par `checkMoment`, dont l'appelant reprend `code`) ; `safe: true` = aucun moment, liaisons rise/cut, caméra still, acteur rest/underline. `momentIds` = moments construits.
  - `notes` : tableau où stagePage ajoute ses notes en français (police de repli…).
  - Écrit dans `hfDir` (copies, jamais de liens) : `index.html`, `hyperframes.json`, `package.json`, `index.motion.json`, `assets/` (`gsap.min.js` et plugins de `cfg.gsapDir`, polices `display-N.woff2`/`body-N.woff2`, `logo.png`, `score.js`, `m-<id>.js`, `texts.js`, `stage.js`). Clés de config lues : `gsapDir` (obligatoire), `gsapFile`, `fontsDir`.
- `stage-runtime.js` (copié en `assets/stage.js`, `engine: 1`) : lit `window.__SCORE`, `window.__MOMENTS`, `window.__TEXTS`, pose `window.__timelines.main` après le chargement des polices. Erreurs d'un moment préfixées `moment <id>: ` (console.error) ; texte au plancher : `console.warn("texte trop long <beatId>")`.

Paquet B (chaîne du worker) :
- `lib/util.mjs` : `run(cmd, args, { …, timeoutMs, signal, onLine })` (ajouts seulement) : lancement detached, à l'expiration ou à l'annulation `kill(-pid, "SIGTERM")` puis `SIGKILL` 3 s plus tard, erreur en français ; `onLine` reçoit stdout découpé sur `\r` et `\n`, sans codes ANSI.
- `lib/claude.mjs` : `askStream(cfg, prompt, schema, cwd, { tools, timeoutMs, signal, onDelta, effort })` → `structured_output` ; `claudeFlags(cfg)` (`--restricted`, `--tools`, stream-json ; mis en cache). `ask()` ne change pas.
- `lib/api.mjs` : `step(id, s, p, extra = {})`, `board(id, image, frames)` (avale le 404), `claim(version, tracks, brolls, speed)`.
- `lib/jobs.mjs` : aiguillage du bloc motion : `job.motion?.mode === "video" || v?.reel?.video` → `handleVideo` ; action `preview` → `renderVideo` (sans Claude) ; action `motion` → `makeVideo` (`job.regen` ou aucune version vidéo) ou `reviseVideo` (avec une base). Pas de `/final` pour une vidéo, pas de PATCH failed après une annulation. Un plan à `engine` > 1 → « Ce reel a été fait par un Mac plus récent : mets le Mac à jour ».
- `lib/reel/hf-cli.mjs` : `HF_TIMEOUTS` (lint 60 s, check 180 s, snapshot 120 s), `browserPath(cfg, { ensure })`, `renderTimeout(frames, maxFrameMs)` (120 s + images × maxFrameMs, 25 min au plus), `RENDER_PROGRESS`, `parseSummary(line)`, `hfEnv(cfg)` (variables `HYPERFRAMES_NO_TELEMETRY`, `…_NO_UPDATE_CHECK`, `…_NO_AUTO_INSTALL`, `…_SKIP_SKILLS` = 1, `HYPERFRAMES_BROWSER_PATH` = `workDir/chrome-offline.sh`), `offlineBrowser(cfg)`, `lint(cfg, dir, o)` et `check(cfg, dir, o)` → `{ blocking: Finding[], advice: Finding[] }`, `snapshot(cfg, dir, times, o)` → chemins des PNG, `render(cfg, dir, out, { onFrame, signal, timeoutMs })` → `{ summary }`, `blame(findings, momentIds)` → `{ engine: Finding[], moments: { [id]: Finding[] } }`. `o = { signal, timeoutMs }`.
- `lib/reel/progress.mjs` : `new Progress(steps, cfg, job, { kind: "write" | "revise" | "edit" })` (phases prévues `PLANS`, durées par défaut `DEFAULTS`, textes `STEP`, fraction, eta, PATCH limités, battement de 15 s), `readStats`, `learnStats` et `speedOf(cfg)` (`reel-stats.json`, moyenne glissante α 0,3 ; `speed` de la réclamation).
- `lib/reel/prompt.mjs` : `SCORE_SCHEMA`, `REVIEW_SCHEMA`, `REVISE_SCHEMA`, `writePrompt`, `reviewPrompt`, `revisePrompt`.
- `lib/reel/render.mjs` : `produce(cfg, ctx)` (échelle de qualité : checkMoment, stagePage, lint, check, planche, relecture, rendu, repli), `reelCfg(cfg)` (valeurs par défaut `REEL_DEFAULTS`), `withMeta`, `vet`, `renderedPlan`, `applyPatch`, finition ffmpeg copiée de `motion.mjs`, contrôle `probe` (ffprobe).
- `lib/reel/index.mjs` : `handleVideo(api, cfg, job, action, dir)` → `makeVideo`, `reviseVideo`, `renderVideo`.
- `prompts/reel-video.md` (savoir-faire), `montage.mjs` (`VERSION = "0.15.2"` (porte vidéo du serveur : 0.15.0), `--setup-reel`, lignes de `--check`, verrou, `speed` dans la réclamation), `config.example.json`, `README.md`.

Paquet C : `src/lib/montage.ts`, `src/lib/worker-version.ts`, `src/server/montage.ts`, les routes `api/montage` (dont `jobs/[id]/board`, et le 409 d'un passage terminé dans `jobs/[id]/versions/[n]/preview`), cette section, et les outils de test `worker/montage/test/mock-server.mjs` (`MOCK=video`), `check-video-run.mjs`, `claude-spy.sh`, `config.sandbox.json`.

Paquet D : `src/components/montage/reel-studio.tsx`, `reel-progress.tsx`, `use-reel-job.ts`, `cover-capture.ts`, `video-review.tsx`, `video-beats.tsx`, `use-montage.ts`, `src/app/(app)/videos/studio/anime/page.tsx`. Il importe les types et fonctions de `src/lib/montage.ts` et `atLeast`. Les retouches d'une ligne dans `review-page.tsx`, `reel-timeline.tsx` et `visuals-page.tsx` se font en dernier, à l'intégration.

#### Configuration et fichiers du Mac

- `config.json` : `gsapFile`, `gsapDir` (obligatoire pour la vidéo : Chrome hors ligne ne joint aucun CDN), `fontsDir`, `hyperframesReference`, `reel: { review: true, effort: "", restricted: true, claudeWriteMin: 6, claudeReviewMin: 4, claudeReviseMin: 5, maxFrameMs: 400, jobMaxMin: 30, reviewWithinMin: 6 }` (`review: false` saute la relecture en images ; `restricted: false` est écrit par `--setup-reel` quand Claude refuse le mode restreint : écriture par l'ancien appel, sans relecture).
- `workDir/chrome-offline.sh` (Chrome sans DNS hors de la boucle locale), `workDir/reel-stats.json` (durées apprises), `workDir/worker.lock` (`{ pid, startedAt }`).
- Installation (une fois) : `git pull`, `node montage.mjs --setup-reel` (gsap 3.14.2 local, navigateur hors ligne, rendu de mesure de 3 s rendu deux fois au même framemd5, test de `claude -p --restricted`), `node montage.mjs --check`, redémarrage. HyperFrames reste épinglé à 0.8.137 (`lint`, `check`, `snapshot`, `render` ; jamais `validate`, `add` ni `skills update`).

#### Déploiement et retour arrière

1. Serveur et interface d'abord. Sans danger avec un Mac plus ancien (0.13, ou 0.14.x de la stratégie et de la charte) : les demandes vidéo attendent (204 à la réclamation, bannière « Le programme du Mac est trop ancien »), tout le reste est inchangé. Puis recharger les onglets Metricove ouverts (ordinateur, téléphone) : un onglet resté sur l'ancien éditeur de scènes (« Reel animé » d'avant) interroge encore `/api/montage` avec l'ancien code, prend pour lui une vidéo en cours et supprime une vidéo échouée qui n'a pas encore de version (son erreur et sa planche avec). Le nouveau code ne touche pas aux jobs `motion.mode = "video"` ; le serveur, lui, ne les protège pas d'un ancien onglet.
2. Sur le Mac d'Antoine (le worker tourne sous Portly) :
   ```bash
   cd ~/…/metricove_v2 && git pull
   cd worker/montage
   node montage.mjs --setup-reel   # GSAP local, Chrome hors ligne, rendu de mesure ×2, test de claude restreint (≈ 1 min)
   node montage.mjs --check        # toutes les lignes en ✓ (≈ 10 s)
   ~/.local/bin/portly restart "Metricove v2/montage"
   ```
   Le Studio montre alors « Mac prêt » ; tant que le worker n'a pas redémarré, il dit « Mac à mettre à jour (0.14.1 → 0.15.0) » et les demandes vidéo attendent.
3. Les demandes vidéo en attente partent seules, dans l'ordre.

Chaque côté peut revenir en arrière seul : le serveur ignore les champs en plus du worker (`speed`, `phase`…), un worker plus ancien (0.13, 0.14) ne voit jamais un job à `minWorker`, et un worker 0.15 contre un ancien serveur échoue clairement sur une vidéo (pas de `/final`) mais fait tout le reste comme avant. Une réserve pour le serveur : l'ancien `pageReel` ne connaît pas `video` et ne retire que `art`/`layer` des scènes. Après un retour arrière du serveur, chaque version vidéo gardée en base enverrait donc `video.moments[].code` à la page (affiché nulle part, jamais exécuté, mais la règle « le code ne va jamais au navigateur » ne tient plus) : supprimer les jobs vidéo avant le retour arrière (`DELETE /api/montage/jobs/<id>`, ou les lignes de `montage_jobs` dont le JSON a `"mode":"video"`), ou l'accepter le temps de revenir.

#### Tests

- Unitaires du worker : `cd worker/montage && node --test test/*.test.mjs` (`reel-sandbox`, `reel-score`, `reel-vocab`, `reel-progress`).
- Moteur seul, sans Claude : `node test/reel-render.mjs test/fixtures/reel/<fixture>.json <sortie>`.
- Worker de bout en bout contre un faux Metricove (`test/mock-server.mjs`, `MOCK=video`) : `node test/check-video-run.mjs --run [scénario] [--fake] [--root /tmp/mc] [--gsap <dist>]` prépare le bac à sable (dossiers, piste de 30 s, config dérivée de `test/config.sandbox.json`, avec `claude.bin` = le `claude-spy.sh` du dépôt où tourne le script et GSAP pris dans `--gsap` ou `gsapDir`, refusé s'il manque `gsap.min.js`), lance le faux serveur et `node montage.mjs`, attend la fin, arrête tout et vérifie (`<sortie>/check.json`). Sans `--run`, `node test/check-video-run.mjs <sortie>` vérifie un passage déjà fait. Scénarios :
  - `suite` (défaut) : v1 (Claude écrit) → retouche du 2e repère (« rends le chiffre plus frappant ») → v2 → édition à la main (texte du 1er temps fort et d'un temps fort du moment, un temps fort coupé, un moment retiré s'il y en a deux, musique coupée ; action `preview`) → aperçu → régénération → nouvelle version. Vérifie : phases dans l'ordre, progression jamais en recul, temps restant qui descend pendant le rendu, images qui avancent, repères avant le rendu, `done`, planche (JPEG, une tuile par temps fort), plan conforme (scenes [], engine 1, temps forts contigus de 0 à `duration`, 15–60 s, ≤ 3 moments, champs connus), mp4 (h264 1080×1920, 30 i/s, round(D × 30) ± 1 images, aac), temps forts hors du passage identiques à l'octet en v2, AUCUN appel à Claude pendant l'édition (`claude-spy.sh`), moment gardé malgré le texte changé, idée différente à la régénération, moins de 15 min ;
  - `short` (v1 seulement), `stop` (arrêt au premier PATCH du rendu qui annonce des images, donc pendant que Chrome capture : aucun envoi, aucun PATCH failed, plus aucun PATCH 12 s après, les Chrome vus sous le worker morts 10 s après, suivis par pid même s'ils ont été rattachés à init), `stop-regen` (le même arrêt, puis « Régénérer » 1 s après, avant la veille suivante du Mac : aucun PATCH failed, plus aucun PATCH du passage arrêté 15 s après l'arrêt, aucun envoi entre l'arrêt et la réclamation suivante, les Chrome vus avant l'arrêt morts 10 s après, et la nouvelle demande réclamée moins de 30 s après l'arrêt ; les écritures portent `run`, le faux serveur les attribue à leur passage), `oldserver` (400 sur la version vidéo → « mets le site à jour », 404 sur la planche, rien sur `/final`), `evil` (moment piégé stocké + édition → retiré, rendu sans lui, note), `claude-timeout` (faux Claude muet, `reel.claudeWriteMin` 0,05 → « Claude n'a pas fini d'écrire… », aucun Claude orphelin, suivi par pid), `old` (réclamations sans version et 0.13.0 → 204, 0.15.0 → le job), `legacy` (ancien reel à scènes → `renderPlan`).
  - `--fake` : faux Claude (`CLAUDE_FAKE=1`, partition de la fixture `score-basic`) pour tester la chaîne sans payer ; sans lui, le vrai `claude` passe par `claude-spy.sh`, qui note chaque appel dans `$CLAUDE_SPY_LOG` et chaque prompt dans `$CLAUDE_PROMPT_LOG` (`<sortie>/claude-prompts.log`). La suite y vérifie que le prompt de la régénération donne les titres de la version d'avant et demande « une idée visuelle nettement différente », et que la première écriture n'en parle pas (avec `--fake`, les titres de la nouvelle version sont forcément les mêmes : seule la graine change).
  - Chrome hors ligne : si `<root>/work/chrome-offline.sh` manque, le script l'écrit comme `--setup-reel` (Chrome de HyperFrames + `--host-resolver-rules`, sans le rendu de mesure ni le test de Claude). Chaque scénario vidéo vérifie qu'aucun « Chrome hors ligne absent » n'est dans `worker.log` et que chaque navigateur vu sous le worker porte le drapeau.
  - `--minutes` : délai du scénario, par défaut 30 min pour la suite avec `--fake` et 45 min avec le vrai Claude (la suite réelle dépasse 30 min sur un conteneur Linux), 15 min (avec `--fake`) ou 20 min pour les autres.
  - `old` est un auto-test du FAUX serveur (sa porte compare les versions avec `src/lib/worker-version.ts` quand Node ≥ 22.18 sait le lire, sinon une copie) : la porte réelle se vérifie avec `server`.
- Serveur réel, sans worker : `node test/check-video-run.mjs --run server [--server http://localhost:3000] [--token <API_TOKEN>] [--slow]` joue le Mac et la page contre `pnpm dev` : porte de `claimJob` (sans version, 0.13.0 et 0.9.9 → 204, 0.15.0 → la vidéo avec `run`), identité du passage (`run` différent → 409), écritures tardives d'un passage arrêté refusées avec ou sans `run` (PATCH, planche, version, échec) alors qu'une nouvelle demande attend, vidéo refusée effacée aussitôt, nouvelle demande intacte, réclamation suivante sans progression héritée, édition à la main de la page (`PATCH { reel, from: 1 }` qui change un texte et essaie de changer le code, la zone, le début et le brief d'un moment, d'ajouter un moment, et de changer `engine`, `seed`, `request`, `title`) : le Mac reçoit le code de la version 1 à l'octet près, rien de ce que la page a injecté, aucun moment en plus, et les champs réservés de la base (la moitié serveur de la frontière du bac à sable), `regen` effacé par `withdraw`, `cancel` et la retouche, `stop` refusé sur un reel à scènes (pris par un Mac 0.13.0, versions sans `run` acceptées comme avant), espaces insécables gardés, code jamais renvoyé à la page, aperçu en Range, valider (`{ approve: 3 }` → 200 et un média, supprimé à la fin) ; `--slow` : silence à 45 s sur une vidéo, pas sur un texte de prompteur (deux attentes de 50 s), toujours en ligne à 60 s sans réclamation, puis « Arrêter », « Régénérer » et un rapport de l'ancien passage → 409 et le Mac reste en ligne, pas occupé. Il refuse de tourner (code 2) si la file du serveur n'est pas vide ou si un autre worker l'interroge, et supprime ce qu'il crée. Il réclame sous le nom `check-video-run` : à la fin, file vide, une dernière réclamation remet le nom et la version d'avant dans la fiche de présence (le Mac paraît alors en ligne 30 s ; sans elle, la dernière version annoncée, 0.13.0, ferait dire au Studio « Mac à mettre à jour »).
- Serveur réel : les routes ci-dessus contre `pnpm dev`. Puis le vrai worker contre `METRICOVE_URL=http://localhost:3000` (`--once`, faux Claude) : création suivie comme le Studio (GET /jobs/:id toutes les 2 s : phases, `etaAt`, images, repères, planche, Mac occupé et en ligne, progression jamais en recul), édition à la main rendue sans Claude, validation (la planche part avec les aperçus). Sur un serveur qui a des rushes, faire passer le worker par un relais qui répond lui-même à `POST /api/montage/rushes/scan` : un `rushesDir` vide effacerait les rushes du Mac.

#### Intégration : de vraies vidéos depuis le Studio (19 novembre 2026)

Bac à sable monté comme un Mac (`--setup-reel` : 47 s, 144 ms par image au rendu de mesure, deux rendus identiques au `framemd5` ; `--check` : 9,7 s, tout en ✓), vrai serveur (`pnpm dev`, mode démo), vrai worker 0.15.0, vrai `claude -p`, et un navigateur (Playwright) qui remplit le Studio « Reel animé » comme Antoine et photographie chaque état à 1280×720 et à 1920×1080 (×2). Durées vues par la page (début de chaque phase de `run.phase`), même conteneur Linux sans GPU que plus bas :

| Passage | Vidéo | Images | write | check | review | render | finish | upload | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Idée « 3 romantasy à lire après Fourth Wing », profil LivreMatch, 30 s (avant réglage) | 39,3 s, 7 temps forts, 1 moment | 1178 | 38 s | 101 s | 9 s | 150 s | 21 s | 23 s | 343 s |
| Script d'Antoine (Claude Code), profil AntoineQuarroz (nuit, #ff5a1f, sans) | 32,9 s, 11 temps forts, 2 moments | 987 | 85 s | 83 s | sautée ¹ | 145 s | 39 s | 14 s | 366 s |
| Post collé (outil interne en 2 semaines), papier, sérif, #e11d48 | 33,5 s, 11 temps forts, 2 moments | 1005 | 93 s | 82 s | sautée ¹ | 153 s | 45 s | 16 s | 388 s |
| Retouche par Claude du passage « Premiers retours » (3 bulles de message) | 34,1 s, 3 moments | 1023 | 26 s | 79 s | — | 182 s ² | 56 s | 13 s | 356 s |
| Édition à la main (texte du 1er temps fort, durée du 3e : 4,0 → 3,2 s), sans Claude | 33,3 s | 998 | — | 76 s | — | 151 s | 41 s | 9 s | 285 s |
| Même idée, LivreMatch, 30 s, après réglage et correctif de la relecture | 36,6 s, 10 temps forts, 2 moments | 1099 | 85 s | 87 s | 114 s ³ | 104 s | 16 s | 20 s | 427 s |

¹ Défaut trouvé ici et corrigé : HyperFrames 0.8 pagine les planches de `snapshot` par 9 images (`contact-sheet-1.jpg`, `-2.jpg`…) et le worker ne cherchait que `contact-sheet.jpg` ; au-delà de 9 temps forts la relecture était sautée sans un mot. Le worker passe maintenant toutes les planches à Claude (`HF.contactSheets`, test « plus de 9 temps forts »).
² Deux vérifications à la main tournaient en même temps sur la machine pendant ce rendu.
³ Relecture de Claude sur les deux planches (47 s), qui a corrigé un moment, puis nouvelle vérification de la page corrigée.

- Coût du vrai Claude : écriture 0,47 à 0,65 $ (47 à 104 s), relecture 0,31 à 0,46 $ (9 à 47 s), retouche d'un passage 0,34 $ (25 s). L'édition à la main n'a fait aucun appel (`claude-spy.sh` : même nombre de lignes avant et après).
- Toujours vérifié : chaque état du Studio tient dans l'écran aux deux tailles (pas de défilement de la page), l'adresse suit le reel (`?reel=<id>`), la vidéo prête montre « Envoyer dans la bibliothèque », « Programmer », « Retoucher », « Régénérer » et se lit ; l'écran de montage d'une vidéo (`/videos/montage/<id>`) est `VideoReview` (rangée « Temps forts »), un ancien reel à scènes s'ouvre toujours dans `ReelReview` ; versions V1 (Claude), V2 (retouche, « Ce que Claude a changé »), V3 (édition, `by: "edit"`, moments gardés).
- Porte de version contre le vrai serveur : réclamations sans version et en 0.13.0 → 204, la vidéo reste en file sans `run` ; le Studio dit « Mac à mettre à jour (0.13.0 → 0.15.0) » puis, worker coupé, « Ton Mac est éteint ou en veille ».
- Réglages faits en regardant les planches à 0,5 s (la première vidéo ressemblait encore à un diaporama : textes petits, temps forts de 7 à 8 s, sous-titres longs, moitié basse vide) : textes plus courts et plus de temps forts plus brefs (`prompt.mjs`, `prompts/reel-video.md`), tailles de texte plus grandes et dérive de caméra plus marquée (`vocab.mjs`), unité collée au grand chiffre (« 3 h », « 15 min ») et Claude prié d'ouvrir un temps fort « number » par le nombre (« Maintenant : 20 minutes » affichait « 20 » au-dessus de la phrase qui le répète). Autre faux constat retiré : un texte qui sort de la zone pendant une liaison (plongée du zoom) donnait « Le texte du temps fort « Accroche » dépasse » ; il ne compte plus que pendant que le temps fort est posé (`HF.heldOnly`).
- `pnpm dev` répond parfois 500 « Unexpected end of JSON input » pendant qu'il compile une route à la demande (manifeste lu pendant son écriture) ; le worker note « étape non envoyée » et continue. Rien de tel avec `next start`.

#### Durées mesurées (novembre 2026, conteneur Linux 4 cœurs partagé, charge 9 à 14)

Rendu logiciel (pas de GPU), donc plus lent qu'un Mac ; `check` et `finish` sont les écarts au budget du plan (40 s et 8 s attendus).

| Passage | Images | write | check | review | render | finish | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| v1, vrai Claude (36 s) | 1080 | 63 s | 72 s | 112 s | 203 s | 118 s | 569 s |
| v2, retouche par le vrai Claude | 1080 | 11 s | 71 s | — | 226 s | 150 s | 457 s |
| v3, édition à la main (sans Claude) | 852 | — | 70 s | — | 167 s | 106 s | 343 s |
| Régénération, vrai Claude (28,6 s) | 858 | 73 s | 71 s | 126 s | 147 s | coupé | — |
| v1, faux Claude, faux serveur (20 s) | 600 | 0 s | 69 s | 0 s | 100 s | 61 s | 230 s |
| v1, faux Claude, vrai worker contre `pnpm dev` (20 s) | 600 | 0 s | — | — | 138 s de capture | — | 357 s |

- Coût du vrai Claude : écriture 0,46 à 0,48 $, relecture 0,36 à 0,38 $, retouche d'un passage 0,22 $ ; une génération coûte donc environ 0,85 $ et la suite complète (création, retouche, régénération) 1,90 $.
- Suite complète avec `--fake` (4 passages de 18 à 21 s) : 962 s (v1 208 s, retouche 237 s, édition 249 s, régénération 268 s), soit au-dessus des 15 min du plan sur cette machine alors qu'aucun Claude n'attend : `check` (~70 s) et `finish` (55 à 80 s) pèsent autant que le rendu.
- La régénération de la suite réelle a été coupée pendant `finish` par la limite de 30 min de l'outil de test (pas par le worker) ; la suite avec `--fake` la vérifie de bout en bout.
- Pendant le rendu, le temps restant remonte au début (moyenne mobile sur peu d'images, charge variable : 235 → 255 s à l'image 8, puis +5 s par palier jusqu'à l'image 170 environ) : la vérification « temps restant qui descend » a échoué sur v1 et v2 de la suite réelle (36 s, 1080 images) ; elle passe sur les quatre passages de la suite avec `--fake` (20 s).

## Stratégie digitale et charte graphique (worker 0.14.0)

Deux tâches sans vidéo, demandées depuis la page **Stratégie** et **Réglages → Styles**.

### `kind: "brand"` — lire une stratégie ou une charte

1. La page envoie chaque document : `POST /api/profiles/:projectId/sources?name=<nom>` avec le fichier brut
   (PDF, Word .docx/.doc, OpenDocument, RTF, PowerPoint .pptx, JPEG, PNG, WebP, texte, Markdown, CSV, CSS ou HTML ; 9 Mo au plus ;
   le Mac extrait le texte des documents bureautiques avec textutil, sinon depuis le XML du zip, worker 0.14.1) → `{ source: { id, name, type } }`.
2. `POST /api/montage/jobs` `{ kind: "brand", mode: "strategy" | "charte", projectId, sources, url?, text? }`.
3. Le Mac télécharge les documents (`GET /api/profiles/:projectId/sources/:id`), lit le site lui-même s'il y en a un
   (`lib/site.mjs` : variables CSS, couleurs, polices, logos possibles ; Claude n'a pas accès au web), puis Claude lit les fichiers avec Read.
4. Le Mac répond `PATCH { status: "done", brand }` :
   - stratégie : `{ strategy, ideas[], tone? }` ;
   - charte : `{ look: { theme, accent, font, fields, grid, align, logo? }, colors[], fonts[], tone?, notes }` (logo en `data:` URL, récupéré par le worker).
5. La page montre le résultat ; rien ne change dans le profil avant « Appliquer ». Supprimer la tâche supprime ses documents
   (un document jamais utilisé est effacé après deux jours).

La stratégie retenue est gardée dans le profil du projet (`strategy`, 12 000 caractères au plus) et part avec `job.voice.strategy`
pour les posts, descriptions et textes de prompteur, et pour l'écriture des reels vidéo continus (worker 0.15.0).

### `kind: "plan"` — proposer du contenu

`POST /api/montage/jobs` `{ kind: "plan", projectId, from: "AAAA-MM-JJ", days: 7 | 14 | 30, count: 1..15, formats[], focus? }`.
Le serveur y joint la stratégie, les comptes du projet et les posts déjà prévus autour de la période (`plan.taken`).
Le Mac répond `PATCH { status: "done", plan: { items: [{ date, time, format, pillar, idea, why, caption, networks }], notes } }`.
La page met chaque proposition en brouillon au calendrier, l'ouvre dans le Studio (`?idee=…`) ou la garde dans les idées du projet.

## Styles, bibliothèques et `kind: "asset"` (worker 0.16.0)

- Un projet a un style par défaut (`profile:<projet>`) et d'autres (`profile:<projet>:<style>`, liste `styles:<projet>`).
  Une tâche peut porter `styleId` : la voix, le thème et le logo envoyés au Mac viennent de ce style. Les **notes** du
  style (une règle par ligne) sont ajoutées à la fin de `voice.tone`.
- Bibliothèques (`/api/library`) : illustrations (PNG, JPEG, WebP, SVG) et bruitages (MP3, WAV, OGG, M4A), chacun
  rangé dans des styles `"<projet>:<style>"`. À la réclamation, une tâche montage, couverture ou reel reçoit
  `job.assets = { illustrations: [{ id, name, tags, url, type }], sfx: [...] }` : ceux de son style, sinon ceux sans style.
- `POST /api/montage/jobs` `{ kind: "asset", assetKind: "illustration" | "sfx", prompt, count: 1..4, projectId?, styleId? }`
  → `job.asset = { kind, prompt, count, styles, palette?, style? }`, `minWorker` 0.16.0. Le Mac envoie chaque fichier
  à `POST /api/library?kind=…&name=…&tags=…&styles=…&source=claude` (corps = le fichier), puis
  `PATCH { status: "done", asset: { result: [ids] } }`.

## Mise en scène des temps forts (worker 0.17.0)

L'EDL d'un face cam peut porter, en secondes de la timeline de l'éditeur :

- `stages: [{ at, dur, kind: "split" | "card" | "pip", title, body?, illustration?, anim?: "rise" | "slide" | "pop" | "wipe" }]`
  (12 au plus). `split` : carte en haut (à gauche en 16:9), visage recadré dans l'autre moitié, sous-titres sur la
  jointure. `card` : carte plein écran, la voix continue. `pip` : carte plein écran, visage dans une pastille ronde.
  `illustration` = id d'une illustration de la bibliothèque. Sans `anim`, le Mac en prend une différente de la carte
  d'avant. Deux temps forts qui se chevauchent : le Mac garde le premier.
- `sfx: [{ at, sound, name, volume? }]` (20 au plus) : `sound` = id d'un bruitage de la bibliothèque, ou
  `builtin:whoosh|swoosh|pop|click|ding|impact|riser|thud` (fait par le Mac avec FFmpeg). Volume 0,05 à 1,5 (0,6 par défaut).
- `stageAuto: false` : Claude ne propose ni temps forts ni bruitages à la prochaine version.

Claude (proposition de montage) reçoit les illustrations et bruitages de `job.assets` par leur nom et leurs mots clés,
et pose 2 à 4 temps forts pour 45 s (jamais sur l'accroche, ni sur un B-roll, ni deux fois la même mise en page de suite)
et 2 à 5 bruitages. Rendu : cartes dans la surcouche HyperFrames (sous les sous-titres), visage recadré ou en pastille
par FFmpeg, bruitages mélangés sous la voix. Un Mac plus ancien ignore ces champs.

## Écran de relecture du face cam : retours, transcription, inspecter (METRI-36)

- **Retours** gardés sur le serveur (réglage `review:<job>`, dessins dans `DATA_DIR/montage/<job>/notes/`) :
  `GET|POST /api/montage/jobs/:id/notes` `{ version, t, text?, image? (data URL), target? { kind, label, x, y } }`,
  `PATCH|DELETE /api/montage/jobs/:id/notes/:note` `{ text?, status: "open" | "resolved", t? }`,
  `GET …/notes/:note/image`. Supprimés avec le montage.
- « Envoyer les retours à Claude » : `PATCH /api/montage/jobs/:id { revise, notes: [ids] }` (8 au plus). Le serveur en
  fait les `job.marks` habituels (dessin en data URL, élément visé écrit au début du texte) : aucun changement côté Mac.
  Les retours envoyés gardent `sentIn` = la version demandée et restent ouverts jusqu'à « résolu ».
- Raccourcis : C (ou M) = un retour à la tête de lecture, V = inspecter (cliquer un élément de l'image : sous-titre,
  texte, carte d'un temps fort, accroche, B-roll, visage) pour voir sa place, le commenter ou le modifier.
- Transcription : clic sur un mot = aller à ce moment, Maj + clic = choisir des mots (couper, remettre, commenter),
  double-clic = corriger le mot.

## Règles tirées des retours et « Copier un créateur » (`kind: "style"`, worker 0.18.0, METRI-37)

Une tâche `kind: "style"` (action `style`, `minWorker` 0.18.0) porte `job.styleTask` :

- **`mode: "rules"`** — sous les retours de l'écran de relecture, « Proposer des règles ». Le serveur met dans
  `styleTask.notes` les retours **résolus** du montage `from` (« [élément visé] texte », 30 au plus) et dans `current` les
  notes actuelles du style. Le Mac (`lib/style.mjs`, `writeRules`) demande à Claude 1 à 6 règles générales, et renvoie
  `PATCH {status: "done", style: {rules}}` ; le serveur les garde dans `styleTask.result.rules`. Antoine coche celles à
  garder : l'interface les ajoute aux notes du style (`PUT /api/profiles/:id?style=…`), sans doublon, puis retire la tâche.
- **`mode: "copy"`** — Ressources → Styles → « Copier un créateur ». `refs` : jusqu'à 3 liens `https://` (lus par yt-dlp
  sur le Mac) ou vidéos de la bibliothèque (`mediaId`, téléchargées par `/api/media/:id/file`). Pour chaque reel le Mac
  mesure la durée, les coupes (`select=gt(scene,0.18)`, une au plus toutes les 0,25 s), le volume et la présence d'un fond
  sonore continu (`volumedetect` + `silencedetect`), le débit de parole (whisper) et fait 2 planches de 6 images ; Claude
  lit les planches et écrit 8 à 14 notes, un résumé et la couleur d'accent. Un reel illisible n'arrête pas la tâche (il
  est cité dans le résumé) ; aucun reel lisible = échec. À la fin le serveur crée un nouveau style du projet (copié du
  style choisi pour les couleurs et le ton) avec ces notes et cet accent : `styleTask.result.styleId`.

Réglages du Mac (`config.json`) : `ytDlp` (chemin de yt-dlp, `brew install yt-dlp`) et `ytDlpCookies` (navigateur dont
yt-dlp prend les cookies, par ex. `"chrome"` : Instagram demande souvent d'être connecté).
