// Vocabulaire du moteur « Plateau » (reel vidéo continu, worker 0.14.0, engine 1).
// Ce que Claude peut écrire dans une partition (mises en page, liaisons, états de la forme, caméra, zones des moments),
// les limites et budgets de caractères, les cadres des zones, les préréglages de rythme et les constantes de mise en
// scène du moteur. Une seule source pour score.mjs, sandbox.mjs, stage.mjs et stage-runtime.js (moteur), prompt.mjs
// (grammaire donnée à Claude), render.mjs et progress.mjs. Les listes REEL_* de src/lib/montage.ts sont les mêmes
// (TS_MIRROR, vérifié par test/reel-vocab.test.mjs) : changer une liste ici veut dire la changer là-bas aussi.
// Rien ici ne lit le disque ni le réseau : des données figées et quelques fonctions pures (mots, durée de lecture,
// quantification, graine, grammaire).
// Les objets exportés sont gelés : les copier avant de les modifier.

/** Gèle un objet et tout ce qu'il contient (les listes du vocabulaire ne doivent jamais bouger à l'exécution). */
const frozen = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) frozen(v);
  }
  return o;
};

// ─── Scène et versions ──────────────────────────────────────────────────────────────────────────────────────────────

export const W = 1080, H = 1920, FPS = 30;
/** Tout est quantifié à l'image : 1/30 s. */
export const QUANTUM = 1 / FPS;
/** Version du moteur écrite dans video.engine. Un plan d'engine supérieur vient d'un Mac plus récent : refusé. */
export const ENGINE = 1;
/** Version minimale du worker pour un job vidéo (job.minWorker, VIDEO_WORKER côté site). */
export const VIDEO_WORKER = "0.14.0";
/** HyperFrames est épinglé : lint, check, snapshot et render, jamais validate (déprécié), jamais add. */
export const HYPERFRAMES = "0.8.137";
export const HF_PACKAGE = `hyperframes@${HYPERFRAMES}`;
/** video.tools du plan rendu. */
export const TOOLS = frozen({ worker: VIDEO_WORKER, hyperframes: HYPERFRAMES });
/** GSAP local (cfg.gsapDir = …/gsap/package/dist) : le cœur et les plugins copiés dans hf/assets s'ils sont présents. */
export const GSAP = frozen({
  version: "3.14.2",
  core: "gsap.min.js",
  plugins: [
    { name: "CustomEase", file: "CustomEase.min.js" },
    { name: "DrawSVGPlugin", file: "DrawSVGPlugin.min.js" },
    { name: "MorphSVGPlugin", file: "MorphSVGPlugin.min.js" },
  ],
});

// ─── Listes (les mêmes que REEL_* de src/lib/montage.ts) ────────────────────────────────────────────────────────────

/** Mise en page d'un temps fort. */
export const LAYOUTS = frozen(["hero", "stack", "number", "list", "cta"]);
/** Comment un temps fort naît du précédent (le bridge du premier est gardé mais ignoré : l'entrée de l'accroche est fixe). */
export const BRIDGES = frozen(["rise", "morph", "carry", "zoom", "cut"]);
/** État de la forme de marque (un seul #actor pour toute la vidéo) pendant un temps fort. */
export const ACTORS = frozen(["rest", "dot", "underline", "highlight", "bar", "hidden"]);
/** Mouvement de caméra en plus de la continuité pendant un temps fort. */
export const CAMERAS = frozen(["drift", "push", "still"]);
/** Zone d'un moment (visuel sur mesure écrit par Claude). */
export const ZONES = frozen(["above", "below", "behind", "full"]);
/** Forme de marque qui vit d'un bout à l'autre. */
export const SHAPES = frozen(["orb", "line", "none"]);
/** Nature de la demande d'Antoine. */
export const SOURCES = frozen(["idea", "script", "post"]);
/** Durées proposées dans le Studio (absent = Auto). */
export const TARGETS = frozen([15, 30, 45, 60]);
export const PACES = frozen(["calm", "normal", "fast"]);
/** Facteur de durée de lecture selon le rythme (READ_PACE côté site). */
export const READ_PACE = frozen({ calm: 1.15, normal: 1, fast: 0.88 });
/** Bornes d'une vidéo (REEL_VIDEO côté site) : demande, temps forts écrits [min, max], temps forts gardés au moins,
 * moments au plus, secondes d'un temps fort [min, max], durée totale [min, max], plancher du dernier temps fort gardé. */
export const VIDEO = frozen({ request: 4000, minRequest: 10, beats: [3, 12], keep: 2, moments: 3, seconds: [1.5, 10], total: [15, 60], last: 2.5 });

/** Valeurs prises quand Claude écrit autre chose que la liste (cleanScore). */
export const DEFAULTS = frozen({ layout: "stack", bridge: "morph", actor: "rest", camera: "drift", shape: "orb", pace: "normal", source: "idea", zone: "above", ctaPill: "Abonne-toi" });

/** Id d'un temps fort : stable d'une version à l'autre. Un doublon devient id-2. */
export const BEAT_ID = /^[a-z][a-z0-9-]{0,23}$/;
/** Id d'un moment : sert aussi de préfixe aux ids de son html (m<id>-…) et de conteneur (#m-<id>). */
export const MOMENT_ID = /^[a-z][a-z0-9]{0,11}$/;

/** Longueurs maximales (caractères) des champs écrits par Claude ou la page. items : nombre et longueur d'un item. */
export const FIELDS = frozen({
  title: 80, beatTitle: 40, text: 110, sub: 160, items: 4, item: 40, emphasis: 60,
  caption: 2200, notes: 400, request: 4000, direction: 1000, brief: 200, tools: 40, versionNotes: 2000,
});

/** Budget de caractères par mise en page (VIDEO_BUDGETS côté site ; au-delà : constat texte_trop_long, le moteur
 * réduit la taille). item : chaque item d'une liste. */
export const BUDGETS = frozen({
  hero: { text: 60 },
  stack: { text: 90, sub: 160 },
  number: { text: 40, sub: 120 },
  list: { text: 50, item: 40 },
  cta: { text: 50, sub: 60 },
});
/** Nombre d'items d'une liste [min, max]. */
export const LIST_ITEMS = frozen([2, 4]);

// ─── Temps ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Durée de lecture minimale d'un temps fort :
 * (base + parMot × mots(text + sub + items) + compteur × count + parItem × nb items) × READ_PACE[pace].
 */
export const READ = frozen({ base: 0.9, perWord: 0.28, count: 0.6, perItem: 0.3 });

/** Règles de temps de cleanScore et timeScore. */
export const TIMING = frozen({
  /** Le dernier temps fort gardé dure au moins 2,5 s (appel à l'action et signature). */
  lastMin: VIDEO.last,
  /** Mise à l'échelle uniforme vers la cible : facteur borné, jamais sous la durée de lecture. */
  scale: [0.85, 1.35],
  /** La cible est tenue à ±15 %. */
  tolerance: 0.15,
  /** Auto : ce que le prompt demande (jusqu'à 60 s pour un script long). */
  auto: [15, 35], autoScript: 60,
  /** settle_i = start_i + min(max, frac × durée_i) : l'instant où le temps fort est posé (planche, couverture). */
  settle: { max: 1.2, frac: 0.6 },
});

/** Règles de la partition (cleanScore les corrige, lintScore les signale). */
export const RULES = frozen({
  /** Au-delà, les cut deviennent des morph. */
  cutsMax: 2,
  /** Pas trois fois de suite la même liaison. */
  bridgeRun: 2,
  /** monotone : même mise en page 4 fois, ou même liaison 3 fois de suite. */
  monotoneLayout: 4, monotoneBridge: 3,
  /** Au plus la moitié des temps forts avec la forme cachée : les surplus passent à rest. */
  hiddenMax: 0.5,
  /** carry : un mot commun normalisé (minuscules, sans accents ni ponctuation) d'au moins 3 lettres. */
  carryMinLetters: 3,
  /** Accroche : 6 mots au plus, 2,5 s au plus, lisible avant 0,8 s. */
  hookWords: 6, hookSeconds: 2.5, hookReadable: 0.8,
  /** La forme reste visible pendant au moins 3 temps forts. */
  shapeMinBeats: 3,
  /** shape none n'est gardée que si un moment couvre au moins 2 temps forts (sinon orb : pas_de_continuite). */
  noneNeedsMomentBeats: 2,
});

/** Préréglages de rythme : décalage entre les mots qui entrent, durée B d'une liaison, facteur de lecture. */
export const RHYTHM = frozen({
  calm: { stagger: 0.07, bridge: 0.9, read: READ_PACE.calm },
  normal: { stagger: 0.05, bridge: 0.7, read: READ_PACE.normal },
  fast: { stagger: 0.035, bridge: 0.5, read: READ_PACE.fast },
});

// ─── Cadres (px dans la scène 1080×1920) ────────────────────────────────────────────────────────────────────────────

/** Zone sûre : le texte n'en sort jamais. */
export const SAFE = frozen({ x: 90, y: 280, w: 900, h: 1170 }); // x 90–990, y 280–1450
/** Bande réservée aux sous-titres (METRI-18, #caps) : rien d'important n'y est posé. */
export const CAPS_BAND = frozen({ y0: 1450, y1: 1700 });

/**
 * Cadres par zone : `text` = boîte du texte du temps fort, `moment` = conteneur du moment (overflow caché, sauf behind).
 * `none` = temps fort sans moment. behind : moment plein cadre derrière le texte, discret (opacité ≤ maxOpacity sous le
 * texte). full : le texte devient un surtitre de maxChars caractères au plus (au-delà, cleanScore passe la zone en above).
 */
export const ZONE_FRAMES = frozen({
  none: { text: { x: 90, y: 300, w: 900, h: 1140 } },
  above: { moment: { x: 90, y: 280, w: 900, h: 620 }, text: { x: 90, y: 940, w: 900, h: 500 } },
  below: { text: { x: 90, y: 300, w: 900, h: 560 }, moment: { x: 90, y: 900, w: 900, h: 540 } },
  behind: { moment: { x: 0, y: 0, w: W, h: H }, text: { x: 90, y: 300, w: 900, h: 1140 }, maxOpacity: 0.35 },
  full: { moment: { x: 90, y: 420, w: 900, h: 1020 }, text: { x: 90, y: 290, w: 900, h: 110 }, maxChars: 40 },
});

// ─── Typographie (propriété du moteur) ──────────────────────────────────────────────────────────────────────────────

/**
 * Tailles de départ et planchers en px (police display). La taille est réduite par pas de ×fitStep jusqu'à ce que le
 * bloc tienne en hauteur et qu'aucun mot ne dépasse en largeur ; au plancher : console.warn("texte trop long <id>").
 */
export const TYPE = frozen({
  fitStep: 0.94,
  sizes: {
    hero: [220, 84],
    stack: [132, 64],
    number: [300, 150], // le nombre
    numberText: [84, 52], // le texte sous le nombre
    sub: [56, 40],
    list: [64, 46], // chaque élément d'une liste
    listTitle: [96, 56], // le texte au-dessus des éléments
    cta: [140, 80],
    pill: [60, 40], // la pastille du cta (sub ou « Abonne-toi »)
    over: [84, 44], // zone full : le texte devient un surtitre d'une ou deux lignes
    handle: [42, 32], // @handle de la signature
  },
  /** stack : le bloc commence à +8 % de la hauteur de sa boîte. */
  stackTop: 0.08,
});

// ─── Mouvement ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Courbes du moteur (et conseillées aux moments dans le savoir-faire). */
export const EASE = frozen({
  enter: "expo.out", exit: "power3.in", travel: "expo.inOut", breathe: "sine.inOut",
  drift: "sine.inOut", count: "power2.out", zoomIn: "expo.in", zoomOut: "expo.out",
});

/** Entrées et sorties des mots (transform et opacité seulement). */
export const ENTER = frozen({
  /** Les mots montent de yPercent 110 à 0 dans leur masque .wm. */
  fromYPercent: 110,
  /** Les sorties masquées voyagent au moins jusqu'à yPercent -150 (piège des jambages, mesuré). */
  exitYPercent: -150,
  /** L'accroche entre à 0,15 s ; son dernier mot est posé à 0,7 s. */
  hookAt: 0.15, hookSettled: 0.7,
  /** cut : les mots entrants arrivent en 0,35 s. */
  cutIn: 0.35,
});

/**
 * Liaisons. B = RHYTHM[pace].bridge, T = la frontière. La sortie occupe [T + exit[0]·B, T + exit[1]·B] et l'entrée
 * [T + enter[0]·B, T + enter[1]·B] : le cadre n'est jamais vide.
 */
export const BRIDGE = frozen({
  exit: [-0.6, 0],
  enter: [-0.2, 0.6],
  rise: { distance: 220, parallax: 0.3 },
  /** carry : le porteur remplace le mot sortant à T − swap·B et cède la place au mot entrant à T + swap·B. */
  carry: { swap: 0.5 },
  /** zoom : #cam plonge à l'échelle `scale` (expo.in, inFrac·B, fini à T) ; l'entrant passe de enterFrom à 1 (expo.out, enterFrac·B). */
  zoom: { scale: 3.2, inFrac: 0.7, enterFrom: 0.7, enterFrac: 0.8 },
});

/** États de la forme (#actor). Mesures en px. */
export const ACTOR = frozen({
  rest: { size: 28, above: 60, breathe: 1.08, period: 1.6 },
  dot: { size: 120 },
  underline: { h: 14, radius: 7 },
  highlight: { padX: 16, padY: 6, radius: 18 },
  bar: { w: 10 },
  hidden: { scale: 0.4, opacity: 0 },
  /** shape line : rest et dot sont dessinés comme des traits. */
  line: { w: 64, h: 10 },
});

/** Caméra. Jamais de mouvement de caméra pendant un zoom. */
export const CAMERA = frozen({
  drift: { y: -18, scale: 1.012 },
  push: { scale: 1.06 },
});

/** Décor (#bg) : jamais figé, et le fond ne change jamais à la frontière d'un temps fort. */
export const DECOR = frozen({
  /** 2 halos d'accent (radial-gradient) qui dérivent sur toute la durée, courbe tirée avec la graine. */
  halos: 2, haloSize: 900, haloAlpha: 0.1,
  /** Quadrillage si look.grid : lignes de `step` px à `alpha` d'ink, en parallaxe. Les valeurs sont celles des visuels
   * du Studio (src/lib/visuals.ts : W/8 = 135 px, 9 %) plutôt que 64 px à 6 % : le reel garde la maison du projet. */
  grid: { step: 135, alpha: 0.09, parallax: 0.3 },
  /** Lueurs d'accent (même règle que les visuels : coin en haut à droite) : alpha du halo principal et du second. */
  glow: { night: [0.22, 0.1], paper: [0.14, 0.07], other: [0.1, 0.06] },
  /** Grain si look.grain : tuile SVG de bruit en data URI, déplacée avec l'ease steps(n). */
  grain: { tile: 256, steps: 12, alpha: 0.07 },
  /** Couches lourdes au plus (bien sous le seuil de 25 de HyperFrames). */
  heavyMax: 4,
});

/** count : un proxy {v} passe de 0 à la valeur ; le onUpdate du moteur écrit le nombre au format français. */
export const COUNT = frozen({ max: 1.2, frac: 0.5, locale: "fr-FR", suffixes: ["%", "×"] });

/** Signature (#chrome : logo et @handle), posée par le cta ou en bas de la boîte du dernier temps fort. */
export const CHROME = frozen({ delay: 0.4 });

/** index.motion.json : assertions de HyperFrames (attraper une page figée ou plantée). */
export const ASSERTIONS = frozen({ appearsBySec: 1.0, maxStaticSec: 1.5 });

// ─── Moments (visuels sur mesure, enfermés) ─────────────────────────────────────────────────────────────────────────

export const MOMENT = frozen({
  max: 3,
  /** Temps forts couverts au plus (sans limite pour behind). */
  span: 3,
  /** Début = start du temps fort `from` − preroll ; fin = end du temps fort `to`. */
  preroll: 0.2,
  /** Apparition et disparition (autoAlpha) ; pas de disparition sur le dernier temps fort. */
  fade: 0.3,
  /** Éléments au plus dans le conteneur à l'exécution. */
  elements: 300,
  /** Paramètres reçus par le corps de fonction écrit par Claude (dans cet ordre). */
  params: ["mt", "gsap", "root", "D", "zone", "pal", "beats", "anchors"],
  /** Globaux ombrés par des paramètres de l'enveloppe (ni eval ni arguments : SyntaxError en mode strict). */
  shadowed: ["window", "document", "self", "globalThis", "top", "parent", "frames", "opener", "location", "fetch", "Function", "XMLHttpRequest", "WebSocket", "navigator", "localStorage", "sessionStorage", "indexedDB", "requestAnimationFrame", "setTimeout", "setInterval"],
  /** Garde-fou posé par le moteur dans chaque corps de boucle et de fonction : au-delà, RangeError attribuée au moment. */
  iterations: 20000,
  /** Appels de tween (mt.to, mt.set, gsap.set…) au plus par moment. */
  tweens: 4000,
  /** Tweens d'élément au plus par moment : chaque appel compte ses cibles (× ses keyframes). Au-delà, RangeError
   * attribuée au moment, que check retire tout de suite (revue 2 : 4000 appels × 200 cibles figeaient chaque image). */
  targetTweens: 6000,
});

/** Tailles du code d'un moment (caractères), balises et nœuds texte. */
export const CODE = frozen({ html: 12000, css: 8000, js: 12000, total: 60000, tags: 200, textNodes: 6, textNode: 24 });

/** Les bornes du serveur (VIDEO_LIMITS côté site), dans la forme du site. */
export const VIDEO_LIMITS = frozen({
  title: FIELDS.title,
  caption: FIELDS.caption,
  tools: FIELDS.tools,
  beat: { title: FIELDS.beatTitle, text: FIELDS.text, sub: FIELDS.sub, items: FIELDS.items, item: FIELDS.item, emphasis: FIELDS.emphasis },
  moment: { brief: FIELDS.brief, html: CODE.html, css: CODE.css, js: CODE.js },
  code: CODE.total,
});

/** Nom côté TypeScript (src/lib/montage.ts) → valeur ici. test/reel-vocab.test.mjs compare les deux (expressions
 * régulières comparées par leur source). */
export const TS_MIRROR = frozen({
  VIDEO_WORKER, VIDEO_ENGINE: ENGINE,
  REEL_LAYOUTS: LAYOUTS, REEL_BRIDGES: BRIDGES, REEL_ACTORS: ACTORS, REEL_CAMERAS: CAMERAS, REEL_ZONES: ZONES,
  REEL_SHAPES: SHAPES, REEL_SOURCES: SOURCES, REEL_TARGETS: TARGETS, REEL_VIDEO: VIDEO, READ_PACE,
  VIDEO_LIMITS, VIDEO_BUDGETS: BUDGETS, VIDEO_BEAT_ID: BEAT_ID, VIDEO_MOMENT_ID: MOMENT_ID,
});

/** Balises permises dans le html d'un moment (comparées sans casse). */
export const MOMENT_TAGS = frozen(["div", "span", "i", "b", "em", "strong", "small", "br", "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "text", "tspan", "defs", "clipPath", "mask", "linearGradient", "radialGradient", "stop"]);
/** Attributs permis (comparés sans casse), plus data-* (DATA_ATTR). fill et stroke : none ou currentColor seulement. */
export const MOMENT_ATTRS = frozen(["class", "id", "aria-hidden", "role", "viewBox", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "width", "height", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "fill-rule", "clip-rule", "opacity", "fill-opacity", "stroke-opacity", "points", "transform", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "clip-path", "mask", "preserveAspectRatio", "text-anchor", "dominant-baseline", "font-size", "font-weight", "letter-spacing"]);
export const DATA_ATTR = /^data-[a-z][a-z0-9-]{0,30}$/;
/** Classes du html d'un moment (leur portée vient de l'imbrication CSS dans #m-<id>). */
export const MOMENT_CLASS = /^[a-z][a-z0-9-]{0,40}$/;
/** font-family permis dans le css d'un moment. */
export const MOMENT_FONT_FAMILIES = frozen(["var(--font-display)", "var(--font-body)", "inherit"]);
/** Couleurs qu'un moment utilise en CSS (plus rgba(var(--accent-rgb),a)) ; une autre couleur littérale = conseil de relecture. */
export const MOMENT_COLORS = frozen(["--bg", "--ink", "--sub", "--accent", "--on-accent", "--accent-rgb"]);
/** Tous les tokens posés sur :root par le moteur. */
export const CSS_TOKENS = frozen(["--bg", "--bg-image", "--ink", "--sub", "--accent", "--on-accent", "--accent-rgb", "--ink-rgb", "--bg-rgb", "--font-display", "--font-body"]);
/** Clés de `pal` passé aux moments (chaînes de couleur CSS ; bg est une couleur unie, même pour le thème dégradé). */
export const PAL_KEYS = frozen(["bg", "ink", "sub", "accent", "onAccent"]);

/** Identifiants interdits (mot entier) dans le js d'un moment. */
export const BANNED_IDENTIFIERS = frozen([
  "window", "document", "globalThis", "self", "top", "parent", "frames", "opener", "constructor", "prototype", "__proto__",
  "Reflect", "Proxy", "Function", "eval", "arguments", "import", "require", "fetch", "XMLHttpRequest", "WebSocket",
  "EventSource", "Worker", "SharedWorker", "importScripts", "postMessage", "navigator", "location", "cookie",
  "localStorage", "sessionStorage", "indexedDB", "caches", "Date", "performance", "crypto", "setTimeout", "setInterval",
  "setImmediate", "queueMicrotask", "requestAnimationFrame", "requestIdleCallback", "innerHTML", "outerHTML",
  "insertAdjacentHTML", "createElement", "createElementNS", "appendChild", "append", "prepend", "insertBefore",
  "replaceWith", "replaceChildren", "cloneNode", "setAttribute", "setAttributeNS", "removeAttribute", "ownerDocument",
  "getRootNode", "parentNode", "parentElement", "closest", "offsetParent", "defaultView", "contentWindow",
  "contentDocument", "getComputedStyle", "getBoundingClientRect", "offsetWidth", "offsetHeight", "offsetLeft",
  "offsetTop", "scrollWidth", "scrollHeight", "clientWidth", "clientHeight", "__timelines", "__hf", "__hyperframes",
  "__SCORE", "__MOMENTS", "__TEXTS", "tl", "ticker", "delayedCall", "globalTimeline", "exportRoot", "registerPlugin",
  "config", "defaults", "quickTo", "quickSetter", "Infinity", "while", "with", "new", "eventCallback", "onStart",
  "onUpdate", "onComplete", "onRepeat", "onReverseComplete", "onInterrupt",
  // En plus de la liste du design (trouvés en écrivant le filtre) : rien qui s'exécute plus tard (promesses, classes,
  // écouteurs, fonctions d'ease ou modifiers appelées à chaque image), rien qui touche aux prototypes, rien qui écrit
  // du texte (le texte appartient au moteur), rien qui écrit un style brut ou une animation CSS.
  "this", "super", "class", "extends", "async", "await", "yield", "debugger", "Promise", "Object", "Array", "Symbol",
  "getPrototypeOf", "setPrototypeOf", "defineProperty", "defineProperties", "customElements", "attachShadow", "shadowRoot",
  "addEventListener", "removeEventListener", "dispatchEvent", "then", "modifiers", "addPause", "textContent", "innerText",
  "outerText", "nodeValue", "srcdoc", "cssText", "setProperty", "style", "previousSibling", "nextSibling",
  "previousElementSibling", "nextElementSibling", "assignedSlot", "open", "alert", "confirm", "prompt", "print",
  "navigation", "scheduler", "WebAssembly", "Atomics", "SharedArrayBuffer", "fetchLater", "CSS", "history",
  "sendBeacon", "importNode", "adoptNode",
  // Revue 1 : écrire du balisage ou exécuter un gestionnaire sans les mots ci-dessus, fabriquer des chaînes ou des
  // clés à l'exécution, animer hors de la timeline, remonter aux timelines du moteur par les internes de GSAP.
  // (La vraie frontière est la liste fermée des membres, MOMENT_METHODS et MOMENT_PROPS ; ces noms donnent un
  // message clair.)
  // Des noms d'API qu'aucun moment n'a de raison d'écrire. Les noms courts qui peuvent être des variables (click,
  // focus, blur, animate, before, after, targets, recent) ne sont pas interdits ici : après un point, la liste
  // fermée les refuse déjà.
  "setHTMLUnsafe", "setHTML", "parseHTMLUnsafe", "getHTML", "getAnimations", "startViewTransition",
  "requestFullscreen", "showPopover", "togglePopover", "insertAdjacentElement", "insertAdjacentText", "moveBefore",
  "fromCharCode", "fromCodePoint", "JSON", "getChildren", "getTweensOf", "getById", "killTweensOf", "scrollIntoView",
  "attachInternals", "elementFromPoint", "execCommand",
]);
/** Identifiants libres (ni déclarés dans le code, ni noms de propriété) qu'un moment peut lire : ses paramètres et
 * quelques objets purs. Tout autre identifiant libre est refusé (un global du navigateur ne passe pas). Les plugins
 * DrawSVG et MorphSVG sont enregistrés par le moteur : un moment s'en sert par les clés drawSVG et morphSVG de mt.to.
 * CustomEase seulement par CustomEase.create("m<id>-nom", "<courbe>"). JSON n'y est plus (revue 1 : JSON.parse
 * fabriquait des clés « onclick » ou « innerHTML » que le filtre ne voit pas). */
export const MOMENT_FREE = frozen(["mt", "gsap", "root", "D", "zone", "pal", "beats", "anchors", "Math", "Number", "String", "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite", "NaN", "undefined", "CustomEase"]);
/** Identifiants libres toujours appelés (jamais passés comme valeur : gsap appellerait une fonction pendant la lecture). */
export const MOMENT_FREE_CALLS = frozen(["String", "Number", "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite"]);
/** Identifiants libres toujours suivis d'un point (Math.min, gsap.set, mt.to, CustomEase.create). */
export const MOMENT_FREE_OWNERS = frozen(["Math", "gsap", "mt", "CustomEase"]);
/** Méthodes de gsap qu'un moment peut appeler (gsap.set pour les états de départ ; gsap.utils dont toArray, limité à
 * son conteneur). Les tweens passent par mt. Ni getProperty ni parseEase (revue 2 : gsap.getProperty lisait n'importe
 * quelle propriété de n'importe quel objet, ownerDocument compris ; un moment ne mesure pas le DOM, il reçoit anchors). */
export const MOMENT_GSAP = frozen(["set", "utils"]);
/** Fonctions de gsap.utils (la façade du moteur n'expose qu'elles : ni random, ni shuffle, ni distribute, ni pipe). */
export const MOMENT_UTILS = frozen(["toArray", "clamp", "mapRange", "interpolate", "normalize", "snap", "wrap", "wrapYoyo", "splitColor", "getUnit"]);
/** Méthodes qu'un moment peut appeler après un point, toujours suivies de « ( » (jamais lues comme valeur). Liste
 * fermée (revue 1) : tout autre nom après un point est refusé. Timeline mt et façade gsap, gsap.utils,
 * CustomEase.create, Math, Number, tableaux, sélection dans son conteneur, longueur d'un tracé SVG. */
export const MOMENT_METHODS = frozen([
  "to", "from", "fromTo", "set", "addLabel", ...MOMENT_UTILS, "create",
  "abs", "acos", "asin", "atan", "atan2", "cbrt", "ceil", "cos", "exp", "floor", "hypot", "log", "log10", "log2", "max", "min", "pow", "round", "sign", "sin", "sqrt", "tan", "trunc",
  "isFinite", "isInteger", "isNaN", "parseFloat", "parseInt", "toFixed",
  "forEach", "map", "filter", "some", "every", "find", "findIndex", "reduce", "indexOf", "includes", "slice", "push", "join",
  "querySelector", "querySelectorAll", "getTotalLength", "getPointAtLength",
]);
/** Propriétés qu'un moment peut lire après un point : longueurs, enfants dans son conteneur, constantes de Math,
 * champs de zone, pal, beats et anchors, et les champs de ses propres objets (x, y, w, h, t, d, v). */
export const MOMENT_PROPS = frozen(["length", "utils", "children", "firstElementChild", "lastElementChild", "childElementCount", "PI", "E", "SQRT2", "x", "y", "w", "h", "t", "d", "v", "id", "title", "emphasis", "bg", "ink", "sub", "accent", "onAccent"]);
/** Les seules propriétés qu'un moment peut écrire (o.x = …) : les champs de ses propres objets. */
export const MOMENT_ASSIGNABLE = frozen(["x", "y", "w", "h", "t", "d", "v"]);
/** Méthodes de tableau dont une fonction peut être le rappel (appelé tout de suite, jamais pendant la lecture). */
export const MOMENT_ITERATORS = frozen(["forEach", "map", "filter", "some", "every", "find", "findIndex", "reduce"]);
/** Clés d'objet interdites : gsap les écrirait telles quelles sur l'élément (el.id = …, el.className = …). */
export const MOMENT_BANNED_KEYS = frozen(["id", "className", "slot", "part", "popover", "contentEditable", "dataset", "attributes", "hidden", "inert", "tabIndex", "accessKey", "autofocus", "nonce", "is", "dir", "lang"]);
/** Clés permises dans attr:{…} d'un tween (géométrie et peinture SVG, sans id, class ni rôle). */
export const MOMENT_TWEEN_ATTRS = frozen(MOMENT_ATTRS.filter((a) => !["class", "id", "role", "aria-hidden"].includes(a)));
/**
 * Liste FERMÉE des clés d'un tween ou d'un gsap.set (revue 2 : une liste de refus laissait passer after, before,
 * toggleAttribute, animate… que le CSSPlugin de GSAP appelle sur l'élément avec la valeur du moment). Appliquée par le
 * filtre statique (toute clé d'objet littéral) et par la façade du moteur (chaque tween, à l'exécution).
 */
export const MOMENT_TWEEN_KEYS = frozen([
  // transformations
  "x", "y", "z", "xPercent", "yPercent", "scale", "scaleX", "scaleY", "rotation", "rotationX", "rotationY", "rotationZ",
  "skewX", "skewY", "transformOrigin", "transformPerspective", "svgOrigin",
  // opacité et taille
  "opacity", "autoAlpha", "width", "height",
  // peinture
  "color", "backgroundColor", "borderColor", "fill", "stroke", "strokeWidth", "strokeDasharray", "strokeDashoffset", "fillOpacity",
  "strokeOpacity", "borderRadius", "boxShadow", "filter", "clipPath",
  // attributs SVG et plugins
  "attr", "drawSVG", "morphSVG",
  // temps
  "duration", "delay", "ease", "stagger", "repeat", "repeatDelay", "yoyo", "yoyoEase", "immediateRender", "keyframes",
]);
/** Clés d'un stagger écrit en objet (stagger: { each: 0.08, from: "center" }). */
export const MOMENT_STAGGER_KEYS = frozen(["each", "amount", "from", "grid", "axis", "ease"]);
/** Clés de morphSVG écrit en objet (morphSVG: { shape: ".b", type: "rotational" }). */
export const MOMENT_MORPH_KEYS = frozen(["shape", "type", "origin", "shapeIndex", "map", "precision"]);
/** Clés en plus dans keyframes écrit en objet (keyframes: { "50%": { y: -20 }, easeEach: "sine.inOut" }) ; les
 * pourcentages "0%"…"100%" sont aussi permis. */
export const MOMENT_KEYFRAME_KEYS = frozen(["easeEach"]);
/** Les seules clés permises dans un objet littéral d'un moment : celles d'un tween, d'un stagger, de morphSVG, de
 * keyframes, et les champs de ses propres objets (x, y, w, h, t, d, v). */
export const MOMENT_OBJECT_KEYS = frozen([...new Set([...MOMENT_TWEEN_KEYS, ...MOMENT_STAGGER_KEYS, ...MOMENT_MORPH_KEYS, ...MOMENT_KEYFRAME_KEYS, ...MOMENT_ASSIGNABLE])]);
/** Ce que la façade du moteur relit à chaque tween (posé dans __SCORE.K.KEYS par stage.mjs). */
export const MOMENT_KEYS = frozen({ tween: MOMENT_TWEEN_KEYS, stagger: MOMENT_STAGGER_KEYS, morph: MOMENT_MORPH_KEYS, keyframe: MOMENT_KEYFRAME_KEYS, attr: MOMENT_TWEEN_ATTRS, fields: MOMENT_ASSIGNABLE });
/** Noms du DOM, du CSSOM et de GSAP qu'aucune chaîne d'un moment ne porte (défense en profondeur : une chaîne ne
 * devient jamais un nom de propriété, mais ces noms n'ont rien à faire dans un moment). */
export const MOMENT_DOM_NAMES = frozen([
  "styleSheets", "cssRules", "rules", "selectorText", "sheet", "adoptedStyleSheets", "insertRule", "deleteRule", "replaceSync",
  "disabled", "media", "mediaText", "timeline", "currentTime", "documentElement", "body", "head", "ownerSVGElement",
  "viewportElement", "after", "before", "toggleAttribute", "animate", "remove", "click", "focus", "blur", "showPicker",
  "gsap", "_gsap", "core", "getProperty", "parseEase", "globals", "context", "vars", "parent", "target", "targets",
]);
/** La règle des membres en clair, pour le prompt (section J) et les refus. */
export const MOMENT_API_RULE = `Après un point, seulement : ${MOMENT_METHODS.join(" ")} (toujours appelées), et ${MOMENT_PROPS.join(" ")} (lues ; tes propres objets n'ont que les champs ${MOMENT_ASSIGNABLE.join(", ")}, sinon des tableaux). Une fonction ne sert que nommée et appelée, ou en rappel de ${MOMENT_ITERATORS.join(", ")}.`;
/** Méthodes de timeline interdites (le moment ne pilote pas le temps : il pose des tweens sur mt, c'est tout). */
export const BANNED_METHODS = frozen(["add", "call", "seek", "kill", "clear", "timeScale", "progress", "pause", "play", "restart", "reverse", "invalidate", "totalTime", "time", "repeat", "totalProgress", "duration", "resume", "revert", "tweenTo", "tweenFromTo", "remove", "removeLabel", "shiftChildren", "delay", "repeatDelay", "yoyo", "startTime", "iteration", "paused", "reversed", "padStart", "padEnd"]);
/** Propriétés qu'un moment n'anime jamais (règle gsap_non_transform_motion de lint, portée ici) ; margin* et padding* aussi. */
export const BANNED_PROPS = frozen(["left", "top", "right", "bottom", "fontSize", "letterSpacing", "lineHeight"]);
export const BANNED_PROP_PREFIXES = frozen(["margin", "padding"]);

// ─── Constats ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** block : empêche le rendu de ce qu'il vise ; review : envoyé à la relecture de Claude ; note : seulement noté. */
export const SEVERITIES = frozen(["block", "review", "note"]);
/** Codes des constats de lintScore et sévérité par défaut (render.mjs et hf-cli.mjs peuvent en ajouter d'autres). */
export const FINDING_CODES = frozen({
  texte_trop_long: "review",
  accroche_trop_longue: "review",
  monotone: "review",
  appel_absent: "review",
  trop_long: "review",
  pas_de_continuite: "note",
});

// ─── Polices (COPIE de motion.mjs FONTS et FALLBACK : motion.mjs ne change pas) ─────────────────────────────────────

/** Polices du style : titres et textes. `spec` = police Google à télécharger (googleFaces de fonts.mjs). */
export const FONTS = frozen({
  grotesque: {
    display: { family: "Bricolage Grotesque", spec: "Bricolage Grotesque:opsz,wdth,wght@12..96,75..100,200..800", css: "font-weight:700;font-stretch:90%;letter-spacing:-0.035em;line-height:0.98" },
    body: { family: "Manrope", spec: "Manrope:wght@200..800", css: "font-weight:500" },
  },
  serif: {
    display: { family: "Instrument Serif", spec: "Instrument Serif", css: "font-weight:400;letter-spacing:-0.01em;line-height:1.02" },
    body: { family: "Geist", spec: "Geist:wght@100..900", css: "font-weight:400" },
  },
  sans: {
    display: { family: "Geist", spec: "Geist:wght@100..900", css: "font-weight:700;letter-spacing:-0.03em;line-height:1.02" },
    body: { family: "Geist", spec: "Geist:wght@100..900", css: "font-weight:400" },
  },
});
/** Piles de repli (la police du texte d'un style serif prend la pile sans empattement, comme motion.mjs). */
export const FALLBACK = frozen({ grotesque: "'Helvetica Neue', Arial, sans-serif", serif: "Georgia, 'Times New Roman', serif", sans: "-apple-system, 'Helvetica Neue', Arial, sans-serif" });

// ─── Libellés et grammaire (prompt.mjs, notes, journal) ─────────────────────────────────────────────────────────────

/** Libellé français (le même que l'écran de montage) et « quand l'utiliser » de chaque entrée. */
export const INFO = frozen({
  layouts: {
    hero: { label: "Héros", use: "une phrase-choc seule, très grande, pour l'accroche ou une affirmation forte" },
    stack: { label: "Pile", use: "une phrase et sa précision dessous (sub), le cas général" },
    number: { label: "Chiffre", use: "un nombre énorme et sa légende ; count le fait défiler de 0 à sa valeur" },
    list: { label: "Liste", use: "2 à 4 éléments courts qui arrivent un par un (items)" },
    cta: { label: "Appel", use: "le dernier temps fort, avec l'appel à l'action, la pastille (sub = son texte) et la signature" },
  },
  bridges: {
    rise: { label: "Montée", use: "le temps fort sortant monte, le suivant arrive d'en bas et le décor glisse en parallaxe, pour une suite naturelle" },
    morph: { label: "Métamorphose", use: "les mots s'effacent dans leurs masques pendant que la forme voyage vers sa nouvelle place, l'enchaînement fluide par défaut" },
    carry: { label: "Mot porté", use: "un mot commun aux deux temps forts voyage d'une phrase à l'autre ; il faut un mot commun avec le précédent" },
    zoom: { label: "Plongée", use: "la caméra plonge dans le mot d'emphase du précédent et ressort sur le suivant, pour une révélation ; il faut une emphase sur le précédent" },
    cut: { label: "Coupe sèche", use: "changement instantané, pour un choc ou une rupture ; 2 au plus par vidéo" },
  },
  actors: {
    rest: { label: "Repos", use: "petit rond qui respire au-dessus du texte, une présence discrète" },
    dot: { label: "Point", use: "gros point d'accent au bout de la première ligne, pour ponctuer une affirmation" },
    underline: { label: "Soulignement", use: "trait sous le mot d'emphase (ou la première ligne), pour insister" },
    highlight: { label: "Surligné", use: "pastille d'accent derrière le mot d'emphase, le mot clé du temps fort" },
    bar: { label: "Barre", use: "barre le long du bloc, pour structurer ou citer" },
    hidden: { label: "Cachée", use: "la forme s'efface pour laisser respirer ou laisser la place à un moment ; jamais plus d'un temps fort sur deux" },
  },
  cameras: {
    drift: { label: "Dérive", use: "glissement lent et continu, par défaut" },
    push: { label: "Approche", use: "la caméra s'approche doucement pendant le temps fort puis revient, pour monter la tension" },
    still: { label: "Fixe", use: "aucun mouvement en plus, pour un texte dense ou un moment détaillé" },
  },
  shapes: {
    orb: { label: "Rond", use: "un disque d'accent qui relie tous les temps forts" },
    line: { label: "Trait", use: "un trait d'accent, plus éditorial" },
    none: { label: "Aucune", use: "pas de forme de marque, seulement si un moment couvre au moins 2 temps forts et porte la continuité" },
  },
  zones: {
    above: { label: "Au-dessus", use: "un objet, un schéma ou une donnée au-dessus du texte" },
    below: { label: "Dessous", use: "une illustration ou une jauge sous le texte" },
    behind: { label: "Derrière", use: "un monde ou une texture qui peut traverser plusieurs temps forts, à garder discret" },
    full: { label: "Plein cadre", use: "le visuel est le sujet, le texte n'est qu'un surtitre" },
  },
  paces: { calm: { label: "Calme" }, normal: { label: "Normal" }, fast: { label: "Vif" } },
  sources: { idea: { label: "Une idée" }, script: { label: "Un script" }, post: { label: "Un post" } },
});

const budgetText = (layout) => {
  const b = BUDGETS[layout];
  const parts = [`text ≤ ${b.text}`];
  if (layout === "number") parts[0] += " (contient le nombre)";
  if (b.sub) parts.push(layout === "cta" ? `sub ≤ ${b.sub} (texte de la pastille, « ${DEFAULTS.ctaPill} » par défaut)` : `sub ≤ ${b.sub}`);
  if (b.item) parts.push(`items ${LIST_ITEMS[0]} à ${LIST_ITEMS[1]} de ≤ ${b.item}`);
  return parts.join(", ");
};

const px = (b) => `x${b.x} y${b.y} ${b.w}×${b.h}`;
const zoneText = (zone) => {
  const z = ZONE_FRAMES[zone];
  if (zone === "behind") return `Moment plein cadre derrière le texte (opacité ≤ ${String(z.maxOpacity).replace(".", ",")} sous le texte), texte ${px(z.text)}`;
  if (zone === "full") return `Moment ${px(z.moment)}, le texte devient un surtitre y${z.text.y}–${z.text.y + z.text.h} de ${z.maxChars} caractères au plus`;
  return `Moment ${px(z.moment)}, texte y${z.text.y}–${z.text.y + z.text.h}`;
};

/**
 * La grammaire du plateau pour le prompt (section H) : une ligne par entrée avec « quand l'utiliser », les budgets de
 * caractères venant de BUDGETS. Renvoie des lignes de texte (prompt.mjs les assemble).
 */
export function grammarLines() {
  const lines = ["Mises en page (layout) :"];
  for (const k of LAYOUTS) lines.push(`- ${k} (${INFO.layouts[k].label}) : ${INFO.layouts[k].use}. ${budgetText(k)}.`);
  lines.push("Liaisons (bridge : comment le temps fort naît du précédent ; ignorée sur le premier) :");
  for (const k of BRIDGES) lines.push(`- ${k} (${INFO.bridges[k].label}) : ${INFO.bridges[k].use}.`);
  lines.push("Forme (actor : l'état de la forme de marque pendant le temps fort) :");
  for (const k of ACTORS) lines.push(`- ${k} (${INFO.actors[k].label}) : ${INFO.actors[k].use}.`);
  lines.push("Caméra (camera) :");
  for (const k of CAMERAS) lines.push(`- ${k} (${INFO.cameras[k].label}) : ${INFO.cameras[k].use}.`);
  lines.push("Forme de marque (shape, une pour toute la vidéo) :");
  for (const k of SHAPES) lines.push(`- ${k} (${INFO.shapes[k].label}) : ${INFO.shapes[k].use}.`);
  lines.push(`Zones des moments (zone, px dans la scène ${W}×${H}) :`);
  for (const k of ZONES) lines.push(`- ${k} (${INFO.zones[k].label}) : ${INFO.zones[k].use}. ${zoneText(k)}.`);
  return lines;
}

// ─── Fonctions pures partagées (la même formule est dans src/lib/montage.ts reelBeatSeconds) ───────────────────────

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Arrondi à l'image (1/30 s). */
export const quantize = (t) => Math.round((Number(t) || 0) * FPS) / FPS;

/** Mots d'un texte : les morceaux séparés par des espaces (insécables comprises) qui contiennent une lettre ou un chiffre. */
export const countWords = (s) => String(s ?? "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Durée de lecture minimale d'un temps fort (s, non quantifiée) au rythme `pace`. */
export function minSeconds(beat, pace = "normal") {
  const items = Array.isArray(beat?.items) ? beat.items : [];
  const words = countWords([beat?.text, beat?.sub, ...items].filter(Boolean).join(" "));
  return (READ.base + READ.perWord * words + (beat?.count ? READ.count : 0) + READ.perItem * items.length) * (READ_PACE[pace] ?? 1);
}

/**
 * Durée d'un temps fort gardé, quantifiée : clamp(fixed ? seconds : max(seconds, lecture), 1,5, 10) ; le dernier temps
 * fort gardé fait au moins 2,5 s (même fixé). Exactement reelBeatSeconds de src/lib/montage.ts. Après cleanScore (qui
 * écrit les seconds mis à l'échelle), timeScore et la timeline de la page calculent la même chose : un recalcul sans
 * cible donne les mêmes temps.
 */
export function beatSeconds(beat, last, pace = "normal") {
  const [lo, hi] = VIDEO.seconds;
  const want = Number.isFinite(beat?.seconds) ? beat.seconds : 0;
  const d = clamp(beat?.fixed ? want : Math.max(want, minSeconds(beat, pace)), lo, hi);
  return quantize(last ? Math.max(VIDEO.last, d) : d);
}

/** settle = start + min(1,2 ; 0,6 × durée) : l'instant où le temps fort est posé (reelSettle côté site), quantifié. */
export const settleAt = (start, seconds) => quantize(start + Math.min(TIMING.settle.max, TIMING.settle.frac * seconds));

/**
 * Graine de la vidéo (uint32, FNV-1a 32 bits) : seedOf(job.id) à la création, seedOf(job.id, n) à une régénération
 * (n = numéro de la version qu'elle va créer). Ensuite la graine ne change plus (retouches et éditions la gardent).
 */
export function seedOf(jobId, n = 0) {
  const s = n ? `${jobId}#${n}` : String(jobId ?? "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ─── Formes des données (JSDoc, miroir de src/lib/montage.ts) ───────────────────────────────────────────────────────

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Box
 * @typedef {"hero"|"stack"|"number"|"list"|"cta"} Layout
 * @typedef {"rise"|"morph"|"carry"|"zoom"|"cut"} Bridge
 * @typedef {"rest"|"dot"|"underline"|"highlight"|"bar"|"hidden"} Actor
 * @typedef {"drift"|"push"|"still"} Camera
 * @typedef {"above"|"below"|"behind"|"full"} Zone
 * @typedef {"calm"|"normal"|"fast"} Pace
 *
 * Un temps fort (un repère de la vidéo). Les champs optionnels absents ne sont pas écrits (count seulement s'il vaut
 * true, fixed et cut aussi). start et end (secondes de la vidéo) sont écrits par timeScore sur les temps forts gardés.
 * @typedef {{ id: string, title: string, text: string, sub?: string, items?: string[], emphasis?: string,
 *   count?: boolean, layout: Layout, bridge: Bridge, actor: Actor, camera: Camera, seconds: number,
 *   fixed?: boolean, cut?: boolean, say?: string, start?: number, end?: number }} ReelBeat
 *
 * Un moment : visuel HyperFrames sur mesure sur 1 à 3 temps forts consécutifs (sans limite pour behind).
 * code : seulement sur le serveur et le Mac ; la page reçoit custom.
 * @typedef {{ id: string, brief: string, from: string, to: string, zone: Zone,
 *   code?: { html: string, css: string, js: string }, custom?: boolean }} ReelMoment
 *
 * @typedef {{ engine: 1, request: string, source: "idea"|"script"|"post", target?: number, direction?: string,
 *   title: string, shape: "orb"|"line"|"none", beats: ReelBeat[], moments: ReelMoment[], caption?: string,
 *   seed: number, tools?: { worker?: string, hyperframes?: string } }} ReelVideo
 *
 * Constat : block (empêche le rendu de sa cible), review (pour la relecture), note.
 * @typedef {{ code: string, severity: "block"|"review"|"note", target: string, message: string, fixHint?: string }} Finding
 *
 * Un plan vidéo est un ReelPlan dont scenes vaut [] et qui porte video (look sans logo : logo "").
 * @typedef {{ scenes: [], look: object, logo: boolean, music: boolean, volume: number, track: string,
 *   cue?: { start?: number, fadeIn?: number, fadeOut?: number }, texts: object[], pace: Pace, duration: number,
 *   video: ReelVideo }} ReelPlan
 */
