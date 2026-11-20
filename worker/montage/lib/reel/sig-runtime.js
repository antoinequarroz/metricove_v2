// Moteur « Signature » (engine 2), côté Chrome : copié tel quel dans assets/sig.js par sig-stage.mjs. Code de confiance,
// relu dans git. Il lit window.__SCORE (écrit par Node : textes, couleurs et TOUS les instants, posés sur la grille du
// tempo de la musique), pose les textes en textContent, ajuste les tailles, mesure une fois, puis construit UNE timeline
// GSAP en pause (window.__timelines.main). Aucun hasard (les tirages viennent de la graine), aucune minuterie, aucun
// onUpdate (HyperFrames cherche les images avec suppressEvents) : seules des propriétés CSS, des variables CSS, des
// attributs et les plugins sont animés. Chaque image ne dépend que du temps demandé.
//
// Une scène = une « plaque » plein écran (#p-<id>) : fond (.pbg), décor (.deco), contenu (.pin#t-<id>, qui dérive) et
// une couche volante (.fly). Les scènes téléphone qui se suivent partagent un téléphone (.pstage), posé au-dessus de
// leurs plaques. Les transitions jouent sur les plaques (rideau, remplissage, panoramique, poussée, retournement,
// plongée) ou sur les mots (montée, métamorphose de la marque, mot porté).
(function () {
  "use strict";
  var S = window.__SCORE;
  window.__timelines = window.__timelines || {};
  var built = false;
  var W = S.W, H = S.H;
  var PAL = S.pal, SURF = PAL.surfaces, ACC = PAL.accent;
  var TONES = PAL.tones && PAL.tones.length ? PAL.tones.slice() : [ACC];
  var SAFE = !!S.safe;
  var LEFT = S.align === "left";
  /** Les axes variables de la police des titres : lo (mot qui naît, maigre et serré), w (posé), dip (respiration). */
  var VF = null;
  if (S.fonts && S.fonts.vf && S.fonts.vf.wght) {
    var v0 = S.fonts.vf;
    VF = { w: v0.w, lo: Math.min(v0.w - 100, v0.wght[0] + 40), dip: Math.round(Math.max(v0.wght[0] + 120, v0.w * 0.84)), wd: v0.wd || 0, wdLo: v0.wdth ? v0.wdth[0] : 0, wdHi: v0.wdth ? v0.wdth[1] : 0 };
  }
  var WHIP = "expo.inOut";
  /** Le « non » des cartes (rouge universel, indépendant de la marque). */
  var NO = "#ff5b5b";
  /** Tailles [max, min] en px des textes de chaque scène (réduites par ×0,94 jusqu'à tenir). */
  var SZ = {
    hero: [210, 84], stack: [150, 72], sub: [52, 38], number: [330, 150], numText: [92, 56], list: [110, 64], item: [58, 40],
    slot: [160, 80], phone: [104, 58], psub: [44, 34], cards: [108, 60], payoff: [128, 70], bubbles: [128, 70], wall: [92, 52],
    cta: [176, 90], ctaHead: [150, 80], ctaLine: [104, 60], button: [46, 34],
  };
  var CIRCLE = "M0,-50 C27.6,-50 50,-27.6 50,0 C50,27.6 27.6,50 0,50 C-27.6,50 -50,27.6 -50,0 C-50,-27.6 -27.6,-50 0,-50 Z";
  var HEART_BIG = "M0,46 C-30,22 -58,0 -58,-24 C-58,-44 -42,-56 -26,-56 C-12,-56 -4,-48 0,-38 C4,-48 12,-56 26,-56 C42,-56 58,-44 58,-24 C58,0 30,22 0,46 Z";
  var HEART_BTN = "M0,23 C-15,11 -29,0 -29,-12 C-29,-22 -21,-28 -13,-28 C-6,-28 -2,-24 0,-19 C2,-24 6,-28 13,-28 C21,-28 29,-22 29,-12 C29,0 15,11 0,23 Z";

  // ─── Petits outils ─────────────────────────────────────────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function last(a) { return a && a.length ? a[a.length - 1] : undefined; }
  function f1(n) { return Math.round(n * 10) / 10; }
  function px(n) { return f1(n) + "px"; }
  function num(v, d) { return Number.isFinite(v) ? v : d; }
  function place(el, x, y) { el.style.left = Math.round(x) + "px"; el.style.top = Math.round(y) + "px"; }
  function center(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
  function tone(i) { var n = TONES.length; return TONES[((i % n) + n) % n]; }
  /** Les classes dont le contenu déborde exprès (masques, fenêtres, cartes) : le contrôle de mise en page les ignore. */
  var OVER = { wm: 1, eg: 1, ln: 1, slot: 1, sreel: 1, vp: 1, feed: 1, scr: 1, screen: 1, rows: 1, row: 1, track: 1, cards: 1, card: 1, num: 1, dg: 1, reel: 1, msgs: 1, wbox: 1, cbut: 1, wmk: 1, ctt: 1, op: 1, ot: 1, bub: 1, li: 1, nt: 1, stamp: 1, pm: 1 };
  function make(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) {
      e.className = cls;
      var cs = cls.split(" ");
      for (var i = 0; i < cs.length; i++) if (OVER[cs[i]]) { e.setAttribute("data-layout-allow-overflow", ""); break; }
    }
    if (text !== undefined && text !== null) e.textContent = spaces(text);
    if (parent) parent.appendChild(e);
    return e;
  }
  var NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
    if (parent) parent.appendChild(e);
    return e;
  }
  /** Rectangle d'un élément HTML dans la scène (ou dans `stop`), par la chaîne offsetParent, sans transformation. */
  function off(e, stop) {
    var x = 0, y = 0, n = e;
    while (n && n !== stop && n.id !== "stage") { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x: x, y: y, w: e.offsetWidth, h: e.offsetHeight };
  }
  /**
   * Mesure dans l'état de repos des mots (police variable grasse et large) : fn() est appelée pendant que les mots
   * .vf ont leurs axes de repos, puis leurs valeurs du moment reviennent (une entrée déjà posée les tient maigres).
   */
  function settled(ws, fn) {
    if (!VF) return fn();
    var saved = ws.map(function (w) { return [w.style.getPropertyValue("--wg"), w.style.getPropertyValue("--wd")]; });
    ws.forEach(function (w) { w.style.setProperty("--wg", String(VF.w)); if (VF.wd) w.style.setProperty("--wd", String(VF.wd)); });
    try { return fn(); } finally {
      ws.forEach(function (w, i) {
        if (saved[i][0]) w.style.setProperty("--wg", saved[i][0]); else w.style.removeProperty("--wg");
        if (saved[i][1]) w.style.setProperty("--wd", saved[i][1]); else w.style.removeProperty("--wd");
      });
    }
  }
  /** Ligne de base d'un mot (relative à `stop`) : un repère vide aligné sur la ligne de base. */
  function baselineOf(w, stop) {
    var p = document.createElement("span");
    p.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    w.appendChild(p);
    var y = off(p, stop).y;
    w.removeChild(p);
    return y;
  }
  /**
   * La largeur de la ponctuation qui ferme le mot w (« » », « , », « . », « … »), à mesurer avant toute transformation
   * du mot (sa largeur de mise en page × la part de la ponctuation dans sa boîte). 0 sans ponctuation finale.
   */
  function tailWidth(w) { return tailOf(w).w; }
  /**
   * La ponctuation qui ferme le mot w : { w : sa largeur, espaces d'avant compris ; x : le bord gauche de son premier
   * signe, depuis le bord gauche du mot }, en unités de mise en page. { w: 0 } sans ponctuation finale.
   */
  function tailOf(w) {
    var tn = w && w.lastChild;
    if (!tn || tn.nodeType !== 3) return { w: 0, x: 0 };
    var m = /([\s  ]*)([»"”’')\].,;:…]+)$/.exec(tn.nodeValue);
    if (!m || m[0].length >= tn.nodeValue.length) return { w: 0, x: 0 };
    var len = tn.nodeValue.length, wr = w.getBoundingClientRect();
    if (!(wr.width > 0)) return { w: 0, x: 0 };
    var k = w.offsetWidth / wr.width;
    var r = document.createRange();
    r.setStart(tn, len - m[0].length);
    r.setEnd(tn, len);
    var g = document.createRange();
    g.setStart(tn, len - m[2].length);
    g.setEnd(tn, len);
    return { w: r.getBoundingClientRect().width * k, x: (g.getBoundingClientRect().left - wr.left) * k };
  }
  /** Le hasard de la scène k, tiré de la graine (mulberry32). */
  function prng(k) {
    var a = (S.seed ^ Math.imul(k + 1, 2654435761)) >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ─── Couleurs ──────────────────────────────────────────────────────────────────────────────────────────────────────

  function rgbOf(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function hexOf(c) { return "#" + c.map(function (x) { var v = clamp(Math.round(x), 0, 255); return (v < 16 ? "0" : "") + v.toString(16); }).join(""); }
  function mix(a, b, t) { var A = rgbOf(a), Bc = rgbOf(b); return hexOf([0, 1, 2].map(function (i) { return A[i] + (Bc[i] - A[i]) * t; })); }
  function lum(h) {
    var c = rgbOf(h).map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function chroma(h) { var c = rgbOf(h); return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]); }
  /** La teinte d'une couleur (degrés, 0 à 360). */
  function hueOf(h) {
    var c = rgbOf(h), mx = Math.max(c[0], c[1], c[2]), d = mx - Math.min(c[0], c[1], c[2]);
    if (!d) return 0;
    var x = mx === c[0] ? ((c[1] - c[2]) / d) % 6 : mx === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
    return (x * 60 + 360) % 360;
  }
  /** L'écart de teinte de deux couleurs (0 à 180°), 0 si l'une est presque grise. */
  function hueDist(a, b) {
    if (chroma(a) < 24 || chroma(b) < 24) return 0;
    var x = Math.abs(hueOf(a) - hueOf(b));
    return Math.min(x, 360 - x);
  }
  function onColor(bg) { return contrast(bg, "#ffffff") >= contrast(bg, "#15161f") ? "#ffffff" : "#15161f"; }
  function rgba(h, a) { var c = rgbOf(h); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  /** L'accent posé sur un écran clair d'application (assombri s'il s'y perd). */
  var APP_ACC = contrast(ACC, "#f7f5ed") >= 1.6 ? ACC : mix(ACC, "#000000", 0.45);

  // ─── Icônes (constantes du moteur, jamais un texte du plan) ───────────────────────────────────────────────────────

  function SW(w, extra) {
    var o = { fill: "none", stroke: "currentColor", "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round" };
    Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  var ICONS = {
    check: [["path", SW(3.2, { d: "M5 12.5l4.5 4.5L19 7.5" })]],
    cross: [["path", SW(3.2, { d: "M6 6l12 12M18 6L6 18" })]],
    heart: [["path", SW(2, { d: "M12 21s-7.5-4.6-10-9.3C.4 8.6 2.1 4.8 5.8 4.3c2.2-.3 3.9.8 6.2 3.2 2.3-2.4 4-3.5 6.2-3.2 3.7.5 5.4 4.3 3.8 7.4C19.5 16.4 12 21 12 21z" })]],
    chat: [["path", SW(2, { d: "M4 5.5h16v10.5H10l-5 4v-4H4z" })]],
    share: [["path", SW(2, { d: "M21 3 3 10.5l7 2.5 2.5 7z" })]],
    save: [["path", SW(2, { d: "M6 3h12v18l-6-4.5L6 21z" })]],
    arrow: [["path", SW(2.6, { d: "M5 12h13M13 6l6 6-6 6" })]],
    star: [["path", { d: "M12 2.5L14.47 9.1L21.51 9.41L15.99 13.8L17.88 20.59L12 16.7L6.12 20.59L8.01 13.8L2.49 9.41L9.53 9.1Z", fill: "currentColor", stroke: "currentColor", "stroke-width": 1.6, "stroke-linejoin": "round" }]],
    bell: [["path", SW(2, { d: "M6 16v-5a6 6 0 0 1 12 0v5l1.8 2.2H4.2zM10 20.5a2.2 2.2 0 0 0 4 0" })]],
    fire: [["path", { d: "M12 22c-4.4 0-7.5-3-7.5-7.2 0-3.6 2.3-5.9 4.2-8.1.3 1.9 1.3 3.2 2.6 3.7C11 7 12.4 4.4 15 2c.4 3.6 4.5 6.4 4.5 11.4C19.5 18.6 16.4 22 12 22z", fill: "currentColor" }]],
    lock: [["path", SW(2.2, { d: "M7 11V8a5 5 0 0 1 10 0v3" })], ["rect", { x: 5, y: 11, width: 14, height: 10, rx: 2.5, fill: "currentColor" }]],
  };
  var BUBICONS = ["fire", "chat", "heart", "star", "bell", "save"];
  function icon(parent, name, cls) {
    var s = svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, parent);
    if (cls) s.setAttribute("class", cls);
    (ICONS[name] || []).forEach(function (p) { svgEl(p[0], p[1], s); });
    return s;
  }
  /** Un flou directionnel (feGaussianBlur « x y ») : { id, blur }. */
  var nFilter = 0;
  function blurFilter(vertical) {
    var defs = $("defs").querySelector("defs");
    var id = "fx" + (++nFilter);
    var f = svgEl("filter", { id: id, x: vertical ? "0" : "-10%", y: vertical ? "-10%" : "0", width: vertical ? "100%" : "120%", height: vertical ? "120%" : "100%", "color-interpolation-filters": "sRGB" }, defs);
    return { id: id, url: "url(#" + id + ")", blur: svgEl("feGaussianBlur", { stdDeviation: "0 0" }, f) };
  }

  // ─── Feuille de style de la bibliothèque ──────────────────────────────────────────────────────────────────────────

  var CSS = [
    // Masques : coupés en hauteur seulement (la police variable gonfle sans être rognée), largeur figée, texte centré.
    ".wm{overflow-x:visible;overflow-y:clip;text-align:center}",
    ".wm.open{overflow-y:visible}",
    ".tx{z-index:0}",
    ".tx.body{font-family:var(--font-body);font-weight:700;line-height:1.24;color:color-mix(in srgb,var(--fg) 88%,transparent)}",
    ".tx.rel{position:relative;left:auto;top:auto}",
    ".ln{white-space:nowrap}",
    ".eg{display:inline-block;vertical-align:top;white-space:nowrap}",
    ".hl{z-index:-1}",
    ".noem .em,.wbox .em{color:inherit}",
    ".fly,.dust{position:absolute;left:0;top:0;width:1080px;height:1920px;pointer-events:none}",
    ".q{display:inline-block;transform-origin:40% 85%}",
    ".hlc{position:absolute;left:0;top:0;pointer-events:none}",
    ".mkline{pointer-events:none}",
    // Décors.
    ".gridbg{position:absolute;left:0;top:0;width:1080px;height:2136px;background-image:linear-gradient(color-mix(in srgb,var(--fg) 7%,transparent) 3px,transparent 3px),linear-gradient(90deg,color-mix(in srgb,var(--fg) 7%,transparent) 3px,transparent 3px);background-size:108px 108px}",
    ".floor{position:absolute;left:0;width:1080px;perspective:900px;perspective-origin:50% 0;overflow:hidden;-webkit-mask-image:linear-gradient(to bottom,transparent 0%,#000 42%);mask-image:linear-gradient(to bottom,transparent 0%,#000 42%)}",
    ".plane{position:absolute;left:-440px;width:1960px;top:0;transform-origin:50% 0;transform:rotateX(75deg);background-image:linear-gradient(color-mix(in srgb,var(--mk) 50%,transparent) 3px,transparent 3px),linear-gradient(90deg,color-mix(in srgb,var(--mk) 50%,transparent) 3px,transparent 3px);background-size:140px 140px}",
    ".horizon{position:absolute;left:-200px;width:1480px;height:340px;background:radial-gradient(50% 50% at 50% 50%,color-mix(in srgb,var(--hz) 46%,transparent),color-mix(in srgb,var(--hz) 12%,transparent) 55%,transparent 72%)}",
    ".dust i{position:absolute;border-radius:50%;background:var(--fg)}",
    ".raysw{position:absolute;width:0;height:0}",
    ".rays{position:absolute;left:-1400px;top:-1400px;width:2800px;height:2800px;border-radius:50%;opacity:0;background:repeating-conic-gradient(from 0deg,color-mix(in srgb,var(--mk) 20%,transparent) 0deg 6deg,transparent 6deg 18deg);-webkit-mask-image:radial-gradient(closest-side,#000 12%,transparent 92%);mask-image:radial-gradient(closest-side,#000 12%,transparent 92%)}",
    ".glow{position:absolute;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--hz) 34%,transparent),transparent)}",
    ".orb{position:absolute;border-radius:50%}",
    // Chiffre.
    ".num{position:absolute;left:0;top:0;white-space:nowrap;color:var(--mk);line-height:1.04;font-variant-numeric:tabular-nums}",
    ".dg{display:inline-block;vertical-align:top;height:1.04em;overflow:hidden}",
    ".reel{display:block}",
    ".reel b{display:block;height:1.04em;font-weight:inherit}",
    ".ch{display:inline-block;vertical-align:top;white-space:pre}",
    ".ringb{position:absolute;border-radius:50%;border:6px solid var(--mk);opacity:0}",
    // Liste.
    ".li{position:absolute;left:0;top:0;display:flex;align-items:center;gap:.5em;white-space:normal;text-wrap:pretty;font-family:var(--font-body);font-weight:800;color:var(--fg);line-height:1.1}",
    ".bd{flex:none;width:1.2em;height:1.2em;border-radius:50%;background:var(--mk);color:var(--onmk);display:grid;place-items:center}",
    ".bd svg{width:.74em;height:.74em}",
    // Machine à sous.
    ".slot{position:absolute;left:0;top:0;overflow:hidden}",
    ".sreel{position:absolute;left:0;top:0;width:100%}",
    ".sreel div{white-space:nowrap}",
    // Bulles.
    ".bub{position:absolute;left:0;top:0;display:flex;align-items:center;gap:14px;padding:14px 28px 14px 14px;border-radius:30px;background:#fff;color:#15161f;font-family:var(--font-body);font-weight:700;font-size:36px;line-height:1.1;white-space:nowrap;box-shadow:0 26px 50px -22px rgba(0,0,0,.55),0 2px 0 rgba(0,0,0,.05)}",
    ".bub .ic{flex:none;width:64px;height:64px;border-radius:20px;display:grid;place-items:center}",
    ".bub .ic svg{width:36px;height:36px}",
    ".bub.big{font-size:46px;padding:18px 36px 18px 18px;border-radius:38px;gap:18px}",
    ".bub.big .ic{width:84px;height:84px;border-radius:26px}",
    ".bub.big .ic svg{width:46px;height:46px}",
    ".tap{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:30}",
    ".tap .d{position:absolute;left:-46px;top:-46px;width:92px;height:92px;border-radius:50%;background:rgba(21,22,31,.3);border:4px solid rgba(255,255,255,.95);box-shadow:0 10px 26px rgba(21,22,31,.35);opacity:0}",
    ".tap .r{position:absolute;left:-46px;top:-46px;width:92px;height:92px;border-radius:50%;border:5px solid rgba(21,22,31,.4);opacity:0}",
    // Téléphone.
    ".pstage{position:absolute;left:0;top:0;width:1080px;height:1920px;visibility:hidden;pointer-events:none}",
    ".phone{position:absolute;left:290px;top:640px;width:500px;height:1020px}",
    ".pfl,.pbody,.pface{position:absolute;left:0;top:0;width:500px;height:1020px}",
    ".pface{border-radius:82px;padding:14px;background:linear-gradient(145deg,#34364a,#0c0d12 38%,#1b1c27);box-shadow:0 80px 140px -50px rgba(0,0,0,.8),inset 0 0 0 2px rgba(255,255,255,.1)}",
    ".scr{position:relative;width:472px;height:992px;border-radius:68px;overflow:hidden;background:#0b0b10}",
    ".screen{position:absolute;left:0;top:0;width:472px;height:992px;overflow:hidden;visibility:hidden}",
    ".screen.dk{background:#0b0b10;color:#fff}",
    ".screen.lt{background:#f7f5ed;color:#15161f}",
    ".sbar{position:absolute;left:0;top:0;width:472px;height:62px;display:flex;align-items:center;justify-content:space-between;padding:6px 44px 0 52px;font-family:var(--font-body);font-weight:800;font-size:23px;z-index:5}",
    ".sbar i{display:block;width:26px;height:13px;border-radius:4px;border:2.5px solid currentColor;position:relative}",
    ".sbar i::after{content:\"\";position:absolute;left:2px;top:2px;bottom:2px;width:13px;border-radius:1px;background:currentColor}",
    ".island{position:absolute;left:171px;top:14px;width:130px;height:38px;border-radius:20px;background:#000;z-index:6}",
    ".sheenw{position:absolute;left:0;top:0;width:500px;height:1020px;border-radius:82px;overflow:hidden;pointer-events:none}",
    ".sheen{position:absolute;left:0;top:0;width:500px;height:1020px;border-radius:82px;pointer-events:none;opacity:0;background:linear-gradient(105deg,transparent 28%,rgba(255,255,255,.75) 47%,transparent 64%);mix-blend-mode:soft-light}",
    ".pover{position:absolute;left:0;top:0;width:1080px;height:1920px}",
    // Fil d'actualité.
    ".vp{position:absolute;left:0;top:0;width:472px;height:992px;overflow:hidden}",
    ".feed{position:absolute;left:0;top:62px;width:472px;font-family:var(--font-body)}",
    ".fhead{height:66px;display:flex;align-items:center;gap:26px;padding:0 26px;font-weight:800;font-size:24px}",
    ".fhead span{opacity:.45}",
    ".post{padding-bottom:22px}",
    ".ph{display:flex;align-items:center;gap:14px;height:72px;padding:0 22px}",
    ".ph .av{display:block;width:42px;height:42px;border-radius:50%;flex:none}",
    ".ph .nm{display:block;height:16px;border-radius:8px;background:rgba(255,255,255,.55)}",
    ".ph .dots{margin-left:auto;font-weight:800;letter-spacing:2px;opacity:.6;font-size:20px}",
    ".pm{position:relative;height:540px;overflow:hidden;padding:38px 32px}",
    ".pm .big{font-size:62px;line-height:.92;position:relative;z-index:2;text-transform:uppercase;overflow-wrap:break-word}",
    ".pm .cv{position:absolute;display:block;width:104px;height:156px;border-radius:6px 12px 12px 6px;box-shadow:inset 8px 0 0 rgba(0,0,0,.2),0 16px 30px -12px rgba(0,0,0,.55)}",
    ".pa{display:flex;gap:24px;align-items:center;height:62px;padding:0 22px;font-size:21px;font-weight:700}",
    ".pa span{display:flex;gap:8px;align-items:center}",
    ".pa svg{width:30px;height:30px}",
    ".pa .sv{margin-left:auto}",
    ".pc{padding:0 22px}",
    ".pc i{display:block;height:14px;border-radius:7px;background:rgba(255,255,255,.28);margin-top:10px}",
    // Application.
    ".abar{position:absolute;left:0;top:84px;width:472px;text-align:center;font-size:40px;line-height:1;white-space:nowrap}",
    ".abd{display:inline-block;width:12px;height:12px;border-radius:50%;margin-left:4px}",
    ".abl{display:inline-block;width:150px;height:18px;border-radius:9px;background:rgba(21,22,31,.16)}",
    ".asub{position:absolute;left:0;top:134px;width:472px;text-align:center;font-family:var(--font-body);font-weight:700;font-size:21px;color:rgba(21,22,31,.55);white-space:nowrap}",
    ".fan{position:absolute;left:0;top:190px;width:472px;height:310px}",
    ".aprog{position:absolute;left:66px;top:150px;width:340px;height:12px;border-radius:6px;background:rgba(21,22,31,.1);overflow:hidden}",
    ".aprog i{display:block;width:100%;height:100%;border-radius:6px;transform-origin:0 50%}",
    ".fan i{position:absolute;display:block;width:170px;height:252px;border-radius:8px 16px 16px 8px;transform-origin:50% 100%;box-shadow:inset 10px 0 0 rgba(0,0,0,.16),0 30px 50px -20px rgba(21,22,31,.5)}",
    ".op{position:absolute;left:24px;width:424px;height:104px;border-radius:30px;background:#ebe7da;display:flex;align-items:center;gap:16px;padding:0 70px 0 18px;color:#15161f}",
    ".op .oi{flex:none;width:58px;height:58px;border-radius:50%;background:#fff;color:#15161f;display:grid;place-items:center;font-family:var(--font-body);font-weight:800;font-size:26px}",
    ".op .ot{display:block;flex:1;min-width:0;line-height:1;font-size:30px}",
    ".op .ck{position:absolute;right:18px;top:50%;width:48px;height:48px;margin-top:-24px;border-radius:50%;display:grid;place-items:center}",
    ".op .ck svg{width:28px;height:28px}",
    ".abtn{position:absolute;left:24px;top:860px;width:424px;height:92px;border-radius:46px;display:flex;align-items:center;justify-content:center;gap:12px;font-family:var(--font-body);font-size:28px;font-weight:800;white-space:nowrap}",
    ".abtn svg{width:30px;height:30px;flex:none}",
    // Messages.
    ".chead{position:absolute;left:0;top:62px;width:472px;height:96px;display:flex;align-items:center;gap:16px;padding:0 26px;border-bottom:2px solid rgba(21,22,31,.08);font-family:var(--font-body)}",
    ".cav{flex:none;width:58px;height:58px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:26px}",
    ".cnm{font-weight:800;font-size:25px;line-height:1.15;white-space:nowrap}",
    ".cnm span{display:block;font-weight:600;font-size:18px;opacity:.55}",
    ".msgs{position:absolute;left:0;top:168px;width:472px;height:716px;overflow:hidden}",
    ".msg{position:absolute;top:0;max-width:360px;padding:18px 24px;border-radius:32px;font-family:var(--font-body);font-weight:600;font-size:32px;line-height:1.22}",
    ".msg.in{left:22px;background:#e9e6dc;color:#15161f;border-bottom-left-radius:10px}",
    ".msg.out{right:22px;border-bottom-right-radius:10px}",
    ".cin{position:absolute;left:22px;top:902px;width:428px;height:64px;border-radius:32px;background:#fff;box-shadow:inset 0 0 0 2px rgba(21,22,31,.08)}",
    // Notifications.
    ".lk{position:absolute;left:218px;top:92px;width:36px;height:36px;color:rgba(255,255,255,.9)}",
    ".clock{position:absolute;left:0;top:140px;width:472px;text-align:center;font-size:150px;line-height:1;color:#fff}",
    ".nt{position:absolute;left:18px;top:0;width:436px;display:flex;gap:16px;padding:18px 20px;border-radius:30px;background:rgba(255,255,255,.94);color:#15161f;box-shadow:0 18px 40px -20px rgba(0,0,0,.5);font-family:var(--font-body)}",
    ".ni{flex:none;width:56px;height:56px;border-radius:15px;display:grid;place-items:center}",
    ".ni svg{width:30px;height:30px}",
    ".nb{flex:1;min-width:0}",
    ".nh{display:flex;justify-content:space-between;gap:10px;font-size:20px;font-weight:800;opacity:.6;white-space:nowrap}",
    ".nx{font-size:28px;font-weight:700;line-height:1.2;margin-top:4px}",
    // Cartes.
    ".cards{position:absolute;left:0;top:0;width:1080px;height:1920px}",
    ".card{position:absolute;left:260px;top:610px;width:560px;height:790px;border-radius:46px;overflow:hidden;transform-origin:50% 100%;box-shadow:0 60px 110px -40px rgba(0,0,0,.85)}",
    ".card .art{position:absolute;left:0;top:0;width:560px;height:790px}",
    ".ctt{position:absolute;left:44px;top:92px;width:472px;line-height:.95;text-shadow:0 4px 30px rgba(0,0,0,.18)}",
    ".nope{position:absolute;right:36px;top:48px;width:118px;height:118px;border:8px solid " + NO + ";border-radius:24px;color:" + NO + ";display:grid;place-items:center;opacity:0;background:rgba(0,0,0,.18)}",
    ".nope svg{width:64px;height:64px}",
    ".stamp{position:absolute;left:48px;top:440px;padding:4px 28px 12px;border:11px solid currentColor;border-radius:28px;font-size:120px;line-height:1;white-space:nowrap;opacity:0;background:rgba(0,0,0,.22)}",
    ".stamp svg{display:block;width:150px;height:150px}",
    ".cbtn{position:absolute;top:1440px;width:140px;height:140px;border-radius:50%;display:grid;place-items:center;box-shadow:0 24px 50px -20px rgba(0,0,0,.75)}",
    ".cbtn svg{width:64px;height:64px;overflow:visible}",
    ".burst{position:absolute;left:240px;top:705px;width:600px;height:600px;overflow:visible;opacity:0}",
    ".cf{position:absolute;width:0;height:0}",
    ".cf i{position:absolute;display:block;opacity:0}",
    // Mur de mots.
    ".rows{position:absolute;left:-210px;top:-190px;width:1500px;height:2300px;transform:rotate(-9deg)}",
    ".row{position:relative;height:232px}",
    ".track{position:absolute;left:0;top:0;height:232px;display:flex;align-items:center;gap:54px;white-space:nowrap;font-size:196px;line-height:1}",
    ".it{color:var(--fg)}",
    ".it.o{color:var(--bg);-webkit-text-stroke:8px var(--fg);paint-order:stroke fill}",
    ".it.a{color:var(--mk)}",
    ".it.c{color:var(--t2)}",
    ".it.d{color:var(--t3)}",
    ".sstar{width:128px;height:128px;flex:none;overflow:visible;color:var(--mk)}",
    ".mcv{display:block;width:112px;height:164px;flex:none;border-radius:8px 16px 16px 8px;box-shadow:inset 10px 0 0 rgba(0,0,0,.2);transform:rotate(-6deg)}",
    ".wbox{position:absolute;left:0;top:0;padding:48px 62px 56px;border-radius:40px;background:var(--mk);color:var(--onmk);box-shadow:16px 16px 0 var(--t2)}",
    // Appel à l'action.
    ".wmk{position:absolute;left:0;top:0;white-space:nowrap;line-height:1.1}",
    ".chr{display:inline-block}",
    ".wdot{display:inline-block;width:.24em;height:.24em;margin-left:.05em;border-radius:50%;background:var(--mk);vertical-align:baseline}",
    ".clogo{position:absolute;left:0;top:0;width:1080px;height:120px;text-align:center}",
    ".clogo img{height:120px;width:auto;display:inline-block}",
    ".cbut{position:absolute;left:0;top:0;height:128px;padding:0 50px 0 64px;border-radius:64px;background:var(--mk);color:var(--onmk);display:flex;align-items:center;justify-content:center;gap:20px;font-family:var(--font-body);font-weight:800;font-size:46px;white-space:nowrap;overflow:hidden;box-shadow:0 30px 60px -24px color-mix(in srgb,var(--mk) 70%,transparent)}",
    ".cbi{flex:none;width:52px;height:52px}",
    ".cbut.two{width:860px;height:auto;min-height:128px;white-space:normal;padding:20px 40px 20px 56px;line-height:1.12;text-align:center}",
    ".cbut.two>span{flex:1;min-width:0;overflow-wrap:anywhere}",
    ".cring{position:absolute;left:0;top:0;border-radius:64px;border:4px solid var(--mk);opacity:0}",
    ".cshine{position:absolute;top:-30px;left:0;width:120px;height:188px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.85),transparent);transform:skewX(-20deg);opacity:0}",
    // Rideau.
    ".band{position:absolute;left:0;top:-140px;width:140px;height:2200px;visibility:hidden}",
  ].join("\n");

  // ─── Texte ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Un bloc de mots masqués : { el, ws: [{ wm, w, em, t }], groups }. Les mots de l'emphase restent ensemble (.eg).
   * o : left (aligné à gauche), body (police du corps), rel (positionné dans son parent), q (la ponctuation finale ?/!
   * dans son propre span, pour trembler), carry (index du mot porté : il n'entre pas, il arrive du temps fort d'avant).
   */
  /** La scène en construction (block() y lit la marque : un surligneur au milieu d'une ligne veut de la place). */
  var CUR = null;
  /** Lettres qui descendent sous la ligne de base (le surligneur les couvre, la ligne suivante s'écarte d'autant). */
  var DESC = /[gjpqyçµQ,;]/;
  /** La profondeur (en em) de t sous la ligne de base, à l'encre, dans la police des titres : 0,15 pour « chaque ». */
  var INK = null;
  function inkBelow(t) {
    if (!INK) {
      var p = make("span", "tx disp", $("stage"));
      var cs = getComputedStyle(p);
      INK = { c: document.createElement("canvas").getContext("2d"), up: cs.textTransform === "uppercase" };
      INK.c.font = cs.fontStyle + " " + cs.fontWeight + " 100px " + cs.fontFamily;
      p.parentNode.removeChild(p);
    }
    t = String(t);
    var m = INK.c.measureText(INK.up ? t.toUpperCase() : t);
    return Math.max(0, (m.actualBoundingBoxDescent || 0) / 100);
  }
  /**
   * Où passe le soulignement sous la ligne de base (en em) : à 0,13, ou plus bas quand les mots soulignés ont des
   * jambages (« chaque », « argent »), pour que la vague (amplitude et demi-trait : 0,07) les laisse libres. La
   * ponctuation finale ne compte pas : le trait s'arrête avant elle.
   */
  function ulDrop(t) {
    return Math.max(0.13, inkBelow(String(t).replace(/[\s\u00A0\u202F]*[»"”’')\].,;:…!?]+$/, "")) + 0.12);
  }
  /**
   * La place (en em) que la marque de la scène demande autour du premier groupe d'emphase : sur les côtés (le
   * surligneur et la boucle débordent du mot), au-dessus et en dessous (la ligne du groupe s'écarte de ses voisines :
   * la barre, la vague, la boucle ne touchent jamais les lettres des autres lignes). null : rien à réserver (plain : un
   * bloc qui ne porte pas la marque de la scène).
   */
  function roomOf(o, toks) {
    if (o.plain || !CUR || !CUR.B.markOn) return null;
    var em = (toks || []).filter(function (x) { return x.em; }).map(function (x) { return String(x.t); }).join(" ");
    if (!em) return null;
    var k = CUR.B.mark;
    if (k === "highlight") return { side: 0.13, top: 0.1, bot: DESC.test(em) ? 0.14 : 0.04 };
    if (k === "underline") return { side: 0, top: 0, bot: ulDrop(em) + 0.03 };
    if (k === "bar") return { side: 0.2, top: 0.26, bot: 0.26 };
    return null;
  }
  /**
   * L'espace fine insécable (« 37 % », « 10 jours ? ») manque aux polices fournies (sous-ensembles Google) :
   * Chrome en dessine une demi-espace que l'interlettrage des titres mange (« jours? »). Elle devient partout une
   * espace insécable ordinaire, que toutes ces polices portent (make() passe tous les textes par ici).
   */
  function spaces(t) {
    t = String(t);
    return t.indexOf("\u202F") < 0 ? t : t.replace(/\u202F/g, "\u00A0");
  }
  function block(parent, toks, o) {
    o = o || {};
    var room = roomOf(o, toks);
    var el = make("div", "tx " + (o.body ? "body" : "disp") + (o.left ? "" : " c") + (o.rel ? " rel" : ""), parent);
    var blk = { el: el, ws: [], groups: [], o: o, q: null, room: room };
    var group = null;
    (toks || []).forEach(function (tok, i) {
      if (!tok.em) group = null;
      else if (!group) {
        if (i) el.appendChild(document.createTextNode(" "));
        group = make("span", "eg", el);
        // Le surligneur (la boucle) déborde du mot de chaque côté : le groupe s'écarte de ses voisins d'autant.
        if (room && room.side && !blk.groups.length) group.style.margin = "0 " + room.side + "em";
        blk.groups.push(group);
      }
      var host = tok.em ? group : el;
      if (i && (!tok.em || host.childNodes.length)) host.appendChild(document.createTextNode(" "));
      var wm = make("span", "wm", host);
      var w = make("span", "w" + (tok.em ? " em" : "") + (VF && !o.body ? " vf" : ""), wm);
      var t = spaces(tok.t);
      var m = o.q && i === toks.length - 1 ? /^(.*?)([?!]+)$/.exec(t) : null;
      if (m && m[1]) { w.appendChild(document.createTextNode(m[1])); blk.q = make("span", "q", w, m[2]); }
      else { w.textContent = t; if (m) blk.q = w; }
      blk.ws.push({ wm: wm, w: w, em: !!tok.em, t: t, carry: o.carry === i });
    });
    // Pendant l'ajustement des tailles, la place réservée compte dans la hauteur du bloc (freeze la pose ensuite sur
    // la ligne du groupe : même hauteur totale).
    if (room && blk.groups.length) el.style.paddingBottom = (room.top + room.bot) + "em";
    else blk.room = null;
    return blk;
  }
  /** Aucun mot (ni groupe d'emphase) plus large que w. */
  function within(blk, w) {
    for (var i = 0; i < blk.ws.length; i++) if (blk.ws[i].wm.offsetWidth > w + 0.5) return false;
    for (var j = 0; j < blk.groups.length; j++) if (blk.groups[j].offsetWidth > w + 0.5) return false;
    return true;
  }
  /** Réduit les tailles (×0,94) jusqu'à fits() ; au plancher, avertit (« texte trop long <id> », un conseil de check). */
  function fitAll(parts, fits, id) {
    var f = 1;
    var apply = function () { parts.forEach(function (p) { p.el.style.fontSize = Math.max(p.min, Math.round(p.max * f)) + "px"; }); };
    var floor = function () { return parts.every(function (p) { return p.max * f <= p.min; }); };
    apply();
    for (var guard = 0; guard < 60 && !fits(); guard++) {
      if (floor()) { console.warn("texte trop long " + id); return false; }
      f *= 0.94;
      apply();
    }
    return true;
  }
  /**
   * Fige le bloc : ses lignes deviennent des .ln sans retour, chaque masque prend sa largeur finale (texte centré
   * dedans). La police variable peut ensuite gonfler ou respirer sans jamais refaire les lignes.
   */
  function freeze(blk) {
    var el = blk.el;
    var size = parseFloat(el.style.fontSize) || 100;
    var lines = [], cur = null, top = 0;
    Array.prototype.slice.call(el.childNodes).forEach(function (n) {
      if (n.nodeType === 1) {
        var t = n.offsetTop;
        if (!cur || t > top + size * 0.4) { cur = []; lines.push(cur); top = t; }
        cur.push(n);
      } else if (cur) cur.push(n);
    });
    blk.ws.forEach(function (x) { x.wm.style.width = Math.ceil(x.wm.getBoundingClientRect().width) + "px"; });
    while (el.firstChild) el.removeChild(el.firstChild);
    blk.lines = lines.map(function (ns) {
      while (ns.length && ns[ns.length - 1].nodeType !== 1) ns.pop();
      var ln = make("div", "ln", el);
      ns.forEach(function (n) { ln.appendChild(n); });
      return ln;
    });
    // La place réservée pour la marque passe du bas du bloc à la ligne du groupe d'emphase (au-dessus et dessous).
    var R0 = blk.room, g0 = blk.groups[0];
    if (R0 && g0) {
      el.style.paddingBottom = "";
      blk.lines.forEach(function (ln) {
        if (!ln.contains(g0)) return;
        if (R0.top) ln.style.paddingTop = R0.top + "em";
        if (R0.bot) ln.style.paddingBottom = R0.bot + "em";
      });
    }
  }
  /** Une ligne faite d'un seul petit mot (« en », « de », « à ») : la phrase a l'air cassée. */
  function lonely(blk) {
    var size = parseFloat(blk.el.style.fontSize) || 100, top = null, line = [], bad = false;
    var check = function () { if (line.length === 1 && line[0].classList.contains("wm") && line[0].textContent.replace(/[^\p{L}\p{N}]/gu, "").length <= 3) bad = true; };
    Array.prototype.forEach.call(blk.el.children, function (n) {
      var t = n.offsetTop;
      if (top === null || t > top + size * 0.4) { if (top !== null) check(); line = []; top = t; }
      line.push(n);
    });
    if (top !== null && blk.el.children.length > 1) check();
    return bad;
  }
  function fitBlock(blk, box, sizes, id, steps) {
    blk.el.style.width = Math.floor(box.w) + "px";
    fitAll([{ el: blk.el, max: sizes[0], min: sizes[1] }], function () { return blk.el.offsetHeight <= box.h && within(blk, box.w); }, id);
    // Un petit mot seul sur sa ligne : jusqu'à 4 crans plus petit (`steps`) pour le recoller à ses voisins (sinon, la
    // taille d'avant). L'accroche n'en perd que 2 : un titre d'ouverture grand compte plus qu'un mot seul.
    var s0 = parseFloat(blk.el.style.fontSize), s = s0;
    for (var k = 0; k < (steps || 4) && lonely(blk) && s > sizes[1]; k++) { s = Math.max(sizes[1], Math.round(s * 0.94)); blk.el.style.fontSize = s + "px"; }
    if (s !== s0 && lonely(blk)) blk.el.style.fontSize = s0 + "px";
    freeze(blk);
  }
  /** La largeur réelle des lignes d'un bloc figé (pour une boîte qui l'enveloppe). */
  function linesWidth(blk) {
    var w = 0;
    (blk.lines || []).forEach(function (ln) {
      var ms = ln.querySelectorAll(".wm");
      if (!ms.length) return;
      var a = off(ms[0], blk.el), b = off(ms[ms.length - 1], blk.el);
      w = Math.max(w, b.x + b.w - a.x);
    });
    return Math.ceil(w);
  }
  /** Les mots montent de leur masque (police variable : de maigre et serrée à grasse). */
  function wordsIn(tl, blk, times, o) {
    o = o || {};
    var rot = o.rot || 0;
    blk.ws.forEach(function (x, i) {
      var t = times && times.length ? times[Math.min(i, times.length - 1)] : num(o.t, NaN) + i * (o.step || 0.05);
      x.at = t;
      if (x.carry || !Number.isFinite(t)) return;
      // Le mot qui entre à 0 (le premier de l'accroche) est déjà là sur la première image : c'est elle que la grille
      // Instagram montre quand la vidéo n'a pas de couverture.
      if (t < 0.01) return;
      var from = { yPercent: rot ? 135 : 125 }, to = { yPercent: 0, duration: o.d || 0.6, ease: o.ease || "expo.out" };
      if (rot) { from.rotation = (i % 2 ? 1 : -1) * rot; to.rotation = 0; }
      if (o.scale) { from.scale = o.scale; to.scale = 1; }
      if (VF && x.w.classList.contains("vf")) {
        from["--wg"] = VF.lo; to["--wg"] = VF.w;
        if (VF.wd) { from["--wd"] = VF.wdLo; to["--wd"] = VF.wd; }
      }
      tl.fromTo(x.w, from, to, t);
    });
  }
  /**
   * La précision sous le titre. Un mot à trait d'union (« va-t-on », « peut-être ») ne se coupe jamais à la ligne :
   * la typographie française l'interdit (pas de U+2011 : les polices fournies ne l'ont pas).
   */
  function subEl(parent, text) {
    var s = make("div", "sub", parent);
    spaces(text).split(/ +/).forEach(function (t, i) {
      if (i) s.appendChild(document.createTextNode(" "));
      if (t.indexOf("-") > 0) make("span", "", s, t).style.whiteSpace = "nowrap";
      else s.appendChild(document.createTextNode(t));
    });
    return s;
  }
  function fadeUp(tl, el, t, d) {
    if (!Number.isFinite(t)) return;
    tl.fromTo(el, { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: d || 0.5, ease: "expo.out" }, t);
  }
  /**
   * Le texte respire sur un temps : plus léger, puis il revient. Seule la graisse bouge : les masques ont la largeur
   * figée du repos (freeze), un mot plus serré y flotterait et les espaces entre les mots battraient avec lui.
   */
  function breathe(tl, blk, t) {
    var ws = blk.ws.filter(function (x) { return x.w.classList.contains("vf"); }).map(function (x) { return x.w; });
    if (!ws.length || !VF) return;
    tl.to(ws, { "--wg": VF.dip, duration: 0.14, ease: "power2.out", stagger: 0.015 }, t);
    tl.to(ws, { "--wg": VF.w, duration: 0.32, ease: "power2.inOut", stagger: 0.015 }, t + 0.15);
  }
  function wiggle(tl, el, t) {
    tl.to(el, { rotation: 14, duration: 0.09, ease: "power1.out" }, t);
    tl.to(el, { rotation: -10, duration: 0.12, ease: "sine.inOut" }, t + 0.09);
    tl.to(el, { rotation: 6, duration: 0.12, ease: "sine.inOut" }, t + 0.21);
    tl.to(el, { rotation: 0, duration: 0.2, ease: "sine.out" }, t + 0.33);
  }
  function flash(tl, t, a) {
    if (!Number.isFinite(t)) return;
    tl.fromTo($("flash"), { opacity: a }, { opacity: 0, duration: 0.5, ease: "power2.out", immediateRender: false }, t);
  }
  /** Un fond sombre (le blanc d'un éclair le délave en gris). */
  function darkBg(c) { return lum(c) < 0.2; }
  /** L'éclair, teinté de `color` le temps de son fondu (puis blanc à nouveau). */
  function flashTint(tl, t, a, color) {
    if (!Number.isFinite(t)) return;
    var fl = $("flash");
    if (color) { tl.set(fl, { backgroundColor: color }, t - 0.002); tl.set(fl, { backgroundColor: "#ffffff" }, t + 0.52); }
    flash(tl, t, a);
  }
  /** Le doigt qui touche : approche, pression, onde. */
  function tap(tl, parent, x, y, t) {
    var e = make("div", "tap", parent);
    var d = make("i", "d", e), r = make("i", "r", e);
    gsap.set(e, { x: x, y: y });
    tl.fromTo(d, { scale: 1.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.12, ease: "power2.out", immediateRender: false }, t - 0.14);
    tl.to(d, { scale: 0.76, duration: 0.07, ease: "power2.in" }, t - 0.04);
    tl.to(d, { scale: 1.1, opacity: 0, duration: 0.3, ease: "power2.out" }, t + 0.04);
    tl.fromTo(r, { scale: 0.6, opacity: 0.9 }, { scale: 2.3, opacity: 0, duration: 0.5, ease: "expo.out", immediateRender: false }, t);
  }

  // ─── Marques : surligné, souligné, entouré, point ─────────────────────────────────────────────────────────────────

  function wave(x0, x1, y, a, lambda) {
    var n = Math.max(2, Math.round((x1 - x0) / (lambda / 2)));
    var step = (x1 - x0) / n;
    var d = "M" + f1(x0) + "," + f1(y);
    for (var i = 0; i < n; i++) d += " Q" + f1(x0 + step * (i + 0.5)) + "," + f1(y + (i % 2 ? a : -a) * 2) + " " + f1(x0 + step * (i + 1)) + "," + f1(y);
    return d;
  }
  /**
   * La boucle qui passe autour d'un groupe de lettres (demi-largeur a, demi-hauteur b, centre à l'abscisse ax de
   * l'image) sans en couper aucune, de demi-hauteur ry : la plus ronde qui les contient, ellipse pour un mot court,
   * rectangle aux coins ronds tracé à la main (superellipse) pour un long. Le tracé flotte autour de rx de −0,03 ry à
   * +0,1 ry (loopPath) : il reste dans l'image (x 40 à 1040) et, quand `room` est donné (distance du centre aux lettres
   * d'un mot voisin sur la même ligne, épaisseur du trait déduite), ne touche jamais ce voisin. null quand aucune
   * boucle ne passe entre les lettres du groupe et ces limites.
   */
  function fitLoop(a, b, ry, ax, size, room) {
    var out = ry * 0.1, inn = ry * 0.03;
    var lim = Math.min(ax - 40, 1040 - ax) - out;
    var rx = Math.min(a + size * 0.4, room > 0 ? room - out : Infinity, Math.max(a + size * 0.02, lim));
    var fit = function (e) { var x = a / (rx - inn); return x > 0 && x < 1 && Math.pow(x, 2 / e) + Math.pow(b / (ry * 0.97), 2 / e) <= 1; };
    if (!fit(0.3)) return null;
    var lo = 0.3, hi = 1;
    if (fit(1)) lo = 1;
    else for (var it = 0; it < 12; it++) { var mid = (lo + hi) / 2; if (fit(mid)) lo = mid; else hi = mid; }
    return { rx: rx, ry: ry, e: lo };
  }
  /**
   * Une boucle dessinée à la main (1,1 tour, rayon qui flotte) en courbes de Bézier. Le rayon flotte du même nombre de
   * pixels en largeur et en hauteur (une part de ry) : une longue boucle reste près des lettres à ses deux bouts.
   */
  function loopPath(cx, cy, rx, ry, rnd, e) {
    var pts = [], n = 24, a0 = -2.6, sq = function (v) { return (v < 0 ? -1 : 1) * Math.pow(Math.abs(v), e || 1); };
    for (var i = 0; i <= n; i++) {
      var p = i / n, a = a0 + p * Math.PI * 2 * 1.1;
      var k = (rnd() - 0.5) * 0.06 + p * 0.07;
      pts.push([cx + sq(Math.cos(a)) * (rx + ry * k), cy + sq(Math.sin(a)) * ry * (1 + k)]);
    }
    var d = "M" + f1(pts[0][0]) + "," + f1(pts[0][1]);
    for (var j = 0; j < pts.length - 1; j++) {
      var p0 = pts[Math.max(0, j - 1)], p1 = pts[j], p2 = pts[j + 1], p3 = pts[Math.min(pts.length - 1, j + 2)];
      d += " C" + f1(p1[0] + (p2[0] - p0[0]) / 6) + "," + f1(p1[1] + (p2[1] - p0[1]) / 6) + " " + f1(p2[0] - (p3[0] - p1[0]) / 6) + "," + f1(p2[1] - (p3[1] - p1[1]) / 6) + " " + f1(p2[0]) + "," + f1(p2[1]);
    }
    return d;
  }
  /** Un trait SVG à dessiner (pointillé d'une seule longueur) : { svg, path, len }. */
  function stroke(parent, d, width, w, h) {
    var s = svgEl("svg", { class: "mkline" }, parent);
    s.style.width = (w || 1080) + "px";
    s.style.height = (h || 1920) + "px";
    var path = svgEl("path", { d: d, "stroke-width": width }, s);
    var len = Math.ceil(path.getTotalLength()) + 2;
    path.setAttribute("stroke-dasharray", len + " " + len);
    return { svg: s, path: path, len: len };
  }
  function draw(tl, st, t, d) {
    if (!Number.isFinite(t)) return;
    tl.fromTo(st.path, { attr: { "stroke-dashoffset": st.len } }, { attr: { "stroke-dashoffset": 0 }, duration: d || 0.42, ease: "power2.inOut" }, t);
  }
  /**
   * La marque d'un bloc (construite, pas encore animée) : { kind, els, rect (scène), center, local, base, ems }. null si
   * la scène n'en a pas (repos = la couleur seule ; caché = pas d'emphase du tout).
   */
  function makeMark(R, blk) {
    var B = R.B, kind = B.mark;
    if (!blk) return null;
    if (kind === "hidden") { blk.el.classList.add("noem"); return null; }
    if (!B.markOn || kind === "rest") return null;
    var size = parseFloat(blk.el.style.fontSize) || 100;
    var M = { kind: kind, els: [], base: off(blk.el), size: size, blkEl: blk.el, ems: blk.ws.filter(function (x) { return x.em; }).map(function (x) { return x.w; }) };
    if (kind === "dot") {
      var lw = last(blk.ws);
      if (!lw || /[.!?…:;,»"')\]]$/.test(lw.t)) return null;
      // Le mot mesuré au repos (police variable grasse et large) : il peut être encore dans son état de départ quand la
      // scène se construit, et son masque a une marge à droite. Le point se pose juste après lui, comme un point final.
      var r = settled([lw.w], function () { return off(lw.w, blk.el); });
      var d = Math.max(14, Math.round(size * 0.2));
      var x = r.x + r.w + size * 0.03, y = baselineOf(lw.w, blk.el) - d;
      var dot = make("i", "dotm", blk.el);
      dot.style.cssText = "left:" + px(x) + ";top:" + px(y) + ";width:" + d + "px;height:" + d + "px";
      M.els = [dot];
      M.local = { x: x, y: y, w: d, h: d };
      M.radius = d / 2;
    } else {
      if (!blk.groups.length) return null;
      var g = off(blk.groups[0], blk.el);
      if (kind === "highlight") {
        // La barre couvre les lettres du groupe (jambages compris : un « q » ne sort pas de la barre) et s'arrête avant
        // la ponctuation qui ferme le dernier mot (« lire » », « dimanche, ») : elle reste dehors, dans sa couleur.
        var inG = M.ems.filter(function (w) { return blk.groups[0].contains(w); });
        var tb = inG.length ? tailOf(last(inG)) : { w: 0, x: 0 }, tail = tb.w;
        var bx = g.x - size * 0.16, by = g.y + size * 0.02, bw = g.w + size * 0.32 - tail, bh = size * 0.86;
        // Son bout arrondi s'arrête avant le premier signe de la ponctuation (« lire » » : le chevron reste entier).
        if (tail > 0) bw = Math.max(size * 0.5, Math.min(bw, off(last(inG), blk.el).x + tb.x - size * 0.02 - bx));
        if (DESC.test(inG.map(function (w) { return w.textContent; }).join(" "))) bh = Math.max(bh, Math.round(baselineOf(inG[0], blk.el) + size * 0.26 - by));
        M.radius = Math.round(size * 0.155);
        var bar = make("i", "hl", blk.el);
        bar.style.cssText = "left:" + px(bx) + ";top:" + px(by) + ";width:" + px(bw) + ";height:" + px(bh) + ";border-radius:" + M.radius + "px";
        M.els = [bar];
        M.local = { x: bx, y: by, w: bw, h: bh };
        M.emBoxes = settled(blk.ws.map(function (x) { return x.w; }), function () { return M.ems.map(function (w) { return off(w, blk.el); }); });
      } else {
        var path, loop = null;
        if (kind === "bar") {
          // La boucle passe autour des lettres (capitales et bas de casse du groupe, avec une marge, fitLoop). Un
          // groupe trop large pour l'image n'a pas de boucle qui l'entoure sans couper ses lettres : souligné.
          var bl = baselineOf(M.ems[0] || blk.ws[0].w, blk.el);
          var lcx = g.x + g.w / 2, mid = g.y + g.h / 2, room = Infinity;
          // Un mot voisin sur la même ligne (« les lecteurs ») borne la boucle : elle passe dans l'espace entre eux.
          settled(blk.ws.map(function (x) { return x.w; }), function () {
            blk.ws.forEach(function (x) {
              if (M.ems.indexOf(x.w) >= 0 || blk.groups[0].contains(x.w)) return;
              var r = off(x.w, blk.el);
              if (r.y > mid || r.y + r.h < mid) return;
              if (r.x + r.w <= lcx) room = Math.min(room, lcx - r.x - r.w);
              else if (r.x >= lcx) room = Math.min(room, r.x - lcx);
            });
          });
          loop = fitLoop(g.w / 2 + size * 0.04, size * 0.47, size * 0.62, M.base.x + lcx, size, room - Math.max(8, Math.round(size * 0.06)) / 2 - 3);
          if (loop) { loop.cx = lcx; loop.cy = bl - size * 0.33; } else { kind = "underline"; M.kind = kind; }
        }
        var sw = Math.max(8, Math.round(size * (kind === "bar" ? 0.06 : 0.07)));
        if (kind === "underline") {
          // Sous les jambages des mots soulignés (ulDrop) : la vague ne traverse jamais un q ou un g.
          var inU = M.ems.filter(function (w) { return blk.groups[0].contains(w); });
          var y0 = baselineOf(M.ems[0] || blk.ws[0].w, blk.el) + size * ulDrop(inU.map(function (w) { return w.textContent; }).join(" "));
          var x0 = g.x - size * 0.03, x1 = g.x + g.w + size * 0.03;
          // Comme la barre : le trait s'arrête avant la ponctuation qui ferme le dernier mot (« 14 h 30, »).
          var tu = inU.length ? tailOf(last(inU)) : { w: 0, x: 0 };
          if (tu.w > 0) x1 = Math.max(x0 + size * 0.5, Math.min(x1, off(last(inU), blk.el).x + tu.x - size * 0.02));
          path = wave(x0, x1, y0, size * 0.035, size * 0.5);
          M.local = { x: x0, y: y0 - sw * 2, w: x1 - x0, h: sw * 4 };
        } else {
          path = loopPath(loop.cx, loop.cy, loop.rx, loop.ry, R.rnd, loop.e);
          M.local = { x: loop.cx - loop.rx, y: loop.cy - loop.ry, w: loop.rx * 2, h: loop.ry * 2 };
        }
        var st = stroke(blk.el, path, sw, blk.el.offsetWidth, blk.el.offsetHeight);
        M.els = [st.svg];
        M.stroke = st;
      }
    }
    M.rect = { x: M.base.x + M.local.x, y: M.base.y + M.local.y, w: M.local.w, h: M.local.h };
    M.center = center(M.rect);
    return M;
  }
  function growMark(tl, R, t) {
    var M = R.mark;
    if (!M || !Number.isFinite(t)) return;
    if (M.kind === "highlight") {
      tl.fromTo(M.els[0], { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "expo.out" }, t - 0.04);
      // La couleur posée sur la barre suit son bord, lettre à lettre : chaque mot de l'emphase porte un double de la
      // couleur onMk, découpé à gauche du bord de la barre (même départ, même durée, même courbe). Un mot à moitié
      // couvert n'est jamais de la couleur de la barre dessus, ni de celle du fond à côté. Le double est un enfant
      // du mot : il entre, respire et sort avec lui (axes de la police variable hérités).
      M.ems.forEach(function (w, i) {
        var r = M.emBoxes ? M.emBoxes[i] : off(w, M.blkEl);
        var a = M.local.x - r.x, b = a + M.local.w, top = -Math.round(r.h), bot = Math.round(r.h * 2);
        var twin = w.cloneNode(true);
        twin.removeAttribute("style");
        twin.className = "w hlc" + (w.classList.contains("vf") ? " vf" : "");
        twin.style.color = R.surf.onMk;
        w.style.position = "relative";
        w.appendChild(twin);
        var poly = function (x) { return "polygon(-200px " + top + "px, " + f1(x) + "px " + top + "px, " + f1(x) + "px " + bot + "px, -200px " + bot + "px)"; };
        tl.fromTo(twin, { clipPath: poly(a) }, { clipPath: poly(b), duration: 0.5, ease: "expo.out", immediateRender: true }, t - 0.04);
        // La ponctuation qui tremble (« ? » de l'accroche) a aussi son double, qui tremble avec elle.
        var q = R.blk && R.blk.q;
        if (q && q !== w && w.contains(q)) R.qTwin = twin.querySelector(".q");
      });
    } else if (M.kind === "dot") {
      tl.fromTo(M.els[0], { scale: 0 }, { scale: 1, duration: 0.45, ease: "back.out(3)" }, t);
    } else draw(tl, M.stroke, t, M.kind === "bar" ? 0.48 : 0.4);
  }
  /**
   * La marque entre : elle pousse, sauf en métamorphose depuis une marque de même nature (barre ou point), où elle
   * voyage depuis la scène d'avant (qui cache la sienne).
   */
  function markIn(tl, R, t) {
    var M = R.mark, A = R.prev;
    if (!M || !Number.isFinite(t)) return;
    if (A && A.mark && R.B.bin.kind === "morph" && A.mark.kind === M.kind && (M.kind === "highlight" || M.kind === "dot")) {
      var T = R.B.S, t0 = T - 0.3;
      var a = scaleRect(A.mark.rect, driftScale(A, t0)), r = M.rect, b = M.base;
      var from = { left: a.x - b.x, top: a.y - b.y, width: a.w, height: a.h };
      var to = { left: r.x - b.x, top: r.y - b.y, width: r.w, height: r.h, duration: 0.6, ease: "expo.inOut", immediateRender: false };
      tl.fromTo(M.els[0], from, to, t0);
      tl.set(A.mark.els, { autoAlpha: 0 }, t0);
      if (M.kind === "highlight" && M.ems.length) gsap.set(M.ems, { color: R.surf.onMk });
      A.mark.travelled = true;
      R.travelled = true;
      return;
    }
    growMark(tl, R, t);
  }
  function markOut(tl, M, t, o) {
    if (!M || M.travelled || !Number.isFinite(t)) return;
    o = o || {};
    if (M.kind === "highlight") {
      // La barre se replie du côté où partent ses mots (en haut, ou en bas sous un mot porté), à leur vitesse :
      // jamais une barre vide qui reste, ni une barre qui remonte quand ses mots descendent.
      tl.set(M.els[0], { transformOrigin: o.down ? "50% 100%" : "50% 0%" }, t);
      tl.to(M.els[0], { scaleY: 0, duration: o.d || 0.24, ease: "power3.in" }, t);
    } else if (M.kind === "dot") tl.to(M.els[0], { scale: 0, duration: 0.22, ease: "power2.in" }, t);
    else tl.to(M.els[0], { opacity: 0, duration: 0.2, ease: "power1.in" }, t);
  }
  function markBump(tl, M, t) {
    if (!M || !Number.isFinite(t)) return;
    if (M.kind === "highlight") tl.fromTo(M.els[0], { scaleY: 1.12 }, { scaleY: 1, duration: 0.5, ease: "elastic.out(1, 0.4)", immediateRender: false }, t);
    else if (M.kind === "dot") tl.fromTo(M.els[0], { scale: 1.35 }, { scale: 1, duration: 0.4, ease: "expo.out", immediateRender: false }, t);
  }

  // ─── Plaques, dérive, décors ──────────────────────────────────────────────────────────────────────────────────────

  function driftOf(B) {
    if (SAFE || B.camera === "still" || B.layout === "cards") return null;
    return { t0: B.S, t1: B.E, s1: B.camera === "push" ? 1.06 : 1.03, push: B.camera === "push" };
  }
  /** L'échelle de la dérive d'une scène à l'instant t (même courbe que son tween). */
  function driftScale(R, t) {
    var d = R && R.drift;
    if (!d) return 1;
    var p = clamp((t - d.t0) / Math.max(0.01, d.t1 - d.t0), 0, 1);
    if (d.push) p = p * p;
    return 1 + (d.s1 - 1) * p;
  }
  function scaleRect(r, s) { return { x: 540 + (r.x - 540) * s, y: 960 + (r.y - 960) * s, w: r.w * s, h: r.h * s }; }
  function scalePoint(p, s) { return { x: 540 + (p.x - 540) * s, y: 960 + (p.y - 960) * s }; }
  /** La boîte d'un texte, resserrée pour que la dérive ne le fasse pas sortir de x 90–990. */
  function zone(R, b) {
    var s = R.drift ? R.drift.s1 : 1;
    var half = Math.floor(452 / s);
    var x0 = Math.max(b.x, 540 - half), x1 = Math.min(b.x + b.w, 540 + half);
    return { x: x0, y: b.y, w: x1 - x0, h: b.h };
  }
  function plateOf(B, k) {
    var name = SURF[B.surface] ? B.surface : "base";
    var p = make("div", "plate s-" + name + (PAL.gradient && name === "base" ? " grad" : ""), $("cam"));
    p.id = "p-" + B.id;
    p.style.setProperty("--t1", tone(k));
    p.style.setProperty("--t2", tone(k + 1));
    p.style.setProperty("--t3", tone(k + 2));
    var R = { B: B, k: k, surf: SURF[name], plate: p, rnd: prng(k), exitWords: [], rest: [], mark: null, focus: { x: 540, y: 960 } };
    R.pbg = make("div", "pbg", p);
    R.deco = make("div", "deco", p);
    R.pin = make("div", "pin", p);
    R.pin.id = "t-" + B.id;
    R.fly = make("div", "fly", p);
    gsap.set(R.deco, { visibility: "hidden" });
    R.drift = driftOf(B);
    gsap.set(R.pin, { transformOrigin: "540px 960px" });
    return R;
  }
  function spanOf(R) { return Math.max(0.6, R.B.E - R.B.S + 0.6); }
  function decoStart(R) { return Math.max(0, R.B.S - 0.3); }
  /** o (facultatif) : { rnd, t0, span } d'une série de scènes qui partagent le même décor (téléphone). */
  function decoGrid(tl, R, o) {
    var g = make("div", "gridbg", R.deco);
    tl.fromTo(g, { y: 0 }, { y: -216, duration: o ? o.span : spanOf(R), ease: "none" }, o ? o.t0 : decoStart(R));
    return g;
  }
  /**
   * Le sol quadrillé en perspective qui avance, son horizon lumineux. Après une scène qui avait déjà un sol, par une
   * transition douce (même fond), c'est le même sol qui continue : il part de la hauteur et de la phase du sol d'avant
   * et glisse jusqu'aux siennes (jamais un sol qui s'éteint puis revient plus bas).
   */
  function decoFloor(tl, R, top, h) {
    var hz = make("div", "horizon", R.deco);
    hz.style.top = (top - 160) + "px";
    var fl = make("div", "floor", R.deco);
    fl.style.top = top + "px";
    fl.style.height = h + "px";
    var pl = make("div", "plane", fl);
    // Penché de 75° sous une perspective de 900 px, un plan de longueur s n'occupe que s·cos75·900/(900 − s·sin75) :
    // sa longueur vient de la hauteur à couvrir (moins de 900/sin75 ≈ 931 px), le sol (.floor) coupe le reste.
    var ang = (75 * Math.PI) / 180;
    var plH = function (hh) { return Math.min(900, Math.ceil((900 * hh) / (900 * Math.cos(ang) + hh * Math.sin(ang))) + 24); };
    pl.style.height = plH(h) + "px";
    var span = spanOf(R), t0 = decoStart(R);
    var kind = R.B.bin && R.B.bin.kind, pf = R.prev && R.prev.floor;
    var cont = !!(pf && (kind === "rise" || kind === "morph" || kind === "carry"));
    // La phase du quadrillage continue celle du sol d'avant (116 px/s, motif de 140 px).
    var o0 = cont ? Math.round(pf.o0 + 116 * (t0 - pf.t0)) % 140 : 0;
    R.floor = { hz: hz, fl: fl, t0: t0, o0: o0, top: top, h: h, cont: cont };
    tl.fromTo(pl, { backgroundPosition: "0px " + o0 + "px" }, { backgroundPosition: "0px " + (o0 + Math.round(116 * span)) + "px", duration: span, ease: "none" }, t0);
    if (cont) {
      var tm = R.B.S - 0.2;
      tl.fromTo(hz, { top: pf.top - 160 }, { top: top - 160, duration: 0.9, ease: "power2.inOut", immediateRender: false }, tm);
      tl.fromTo(fl, { top: pf.top, height: pf.h }, { top: top, height: h, duration: 0.9, ease: "power2.inOut", immediateRender: false }, tm);
      tl.fromTo(pl, { height: plH(pf.h) }, { height: plH(h), duration: 0.9, ease: "power2.inOut", immediateRender: false }, tm);
      return;
    }
    // La toute première image n'est jamais vide : le sol de l'ouverture est déjà là, à moitié.
    var a0 = R.B.S <= 0.01 ? 0.55 : 0;
    tl.fromTo(hz, { opacity: a0, scaleX: a0 ? 0.85 : 0.6 }, { opacity: 1, scaleX: 1, duration: 1.2, ease: "power2.out" }, R.B.S);
    tl.fromTo(fl, { opacity: a0 }, { opacity: 1, duration: 0.8, ease: "power1.out" }, R.B.S);
  }
  function decoDust(tl, R) {
    var d = make("div", "dust", R.deco);
    var span = spanOf(R), t0 = decoStart(R);
    (S.dust || []).forEach(function (p) {
      var e = make("i", "", d);
      e.style.cssText = "left:" + p.x + "px;top:" + p.y + "px;width:" + p.s + "px;height:" + p.s + "px;opacity:" + p.o;
      tl.fromTo(e, { x: 0, y: 0 }, { x: p.dx * span / 4, y: -p.dy * span / 4, duration: span, ease: "none" }, t0);
    });
  }
  function decoRays(tl, R, x, y, op) {
    var w = make("div", "raysw", R.deco);
    place(w, x, y);
    var r = make("div", "rays", w);
    var span = spanOf(R);
    tl.fromTo(r, { rotation: 0 }, { rotation: 11 * span, duration: span, ease: "none" }, decoStart(R));
    tl.to(r, { opacity: op, duration: 0.8, ease: "power1.out" }, R.B.S);
    return { w: w, r: r };
  }
  function decoGlow(R, x, y, size) {
    var g = make("i", "glow", R.deco);
    g.style.cssText = "left:" + Math.round(x - size / 2) + "px;top:" + Math.round(y - size / 2) + "px;width:" + size + "px;height:" + size + "px";
    return g;
  }
  function decoOrbs(tl, R, o) {
    var rnd = o ? o.rnd : R.rnd, span = o ? o.span : spanOf(R), t0 = o ? o.t0 : decoStart(R);
    for (var i = 0; i < 9; i++) {
      var o = make("i", "orb", R.deco), s = Math.round(40 + rnd() * 220);
      o.style.cssText = "left:" + Math.round(rnd() * 1000) + "px;top:" + Math.round(rnd() * 1800) + "px;width:" + s + "px;height:" + s + "px;background:" + (i % 3 ? "color-mix(in srgb,var(--fg) 7%,transparent)" : "color-mix(in srgb,var(--mk) 16%,transparent)");
      tl.fromTo(o, { x: 0, y: 80 }, { x: (rnd() - 0.5) * 120, y: -140 - rnd() * 160, duration: span, ease: "none" }, t0);
    }
  }
  function bubble(parent, txt, i, big) {
    var b = make("div", "bub" + (big ? " big" : ""), parent);
    var ic = make("span", "ic", b);
    var t = tone(i + 1);
    ic.style.background = mix(t, "#ffffff", 0.72);
    ic.style.color = mix(t, "#000000", 0.3);
    icon(ic, BUBICONS[i % BUBICONS.length]);
    make("span", "", b, txt);
    var f = big ? 46 : 36, maxW = big ? 860 : 600, min = big ? 30 : 24;
    for (var g = 0; g < 14 && b.offsetWidth > maxW && f > min; g++) { f = Math.max(min, Math.round(f * 0.92)); b.style.fontSize = f + "px"; }
    return b;
  }
  /** Des bulles qui jaillissent à gauche et à droite, puis (away) s'envolent. */
  function bubbles(tl, R, list, times, away, y0, y1, xs) {
    var n = list.length, rnd = R.rnd;
    list.forEach(function (b, i) {
      var left = i % 2 === 0;
      var w = b.offsetWidth, h = b.offsetHeight;
      var x = left ? xs[0] + rnd() * 40 : xs[1] - w - rnd() * 40;
      var yc = n > 1 ? y0 + (y1 - y0) * i / (n - 1) : (y0 + y1) / 2;
      place(b, clamp(x, 40, 1040 - w), yc - h / 2);
      var rot = (left ? -1 : 1) * (2 + rnd() * 2.5);
      var t = times[Math.min(i, times.length - 1)];
      if (Number.isFinite(t)) tl.fromTo(b, { scale: 0.2, autoAlpha: 0, y: 60, rotation: left ? -14 : 14 }, { scale: 1, autoAlpha: 1, y: 0, rotation: rot, duration: 0.5, ease: "back.out(2.4)" }, t);
      if (Number.isFinite(away)) {
        var dir = left ? -1 : 1;
        tl.to(b, { x: dir * (760 + rnd() * 300), y: -260 + rnd() * 380, rotation: dir * (25 + rnd() * 45), autoAlpha: 0, duration: 0.42, ease: "power3.in" }, away + i * 0.018);
      }
    });
  }

  // ─── Scènes ────────────────────────────────────────────────────────────────────────────────────────────────────────

  var SC = {};

  /** Héros : une phrase énorme, ses mots tombent en gonflant, le texte respire sur chaque temps. */
  SC.hero = function (tl, R) {
    var B = R.B, c = B.cue;
    decoFloor(tl, R, 1250, 670);
    decoDust(tl, R);
    var box = zone(R, { x: 90, y: 300, w: 900, h: 940 });
    var blk = block(R.pin, B.words, { left: LEFT, q: true, carry: R.carryTo });
    fitBlock(blk, box, SZ.hero, B.id, 2);
    place(blk.el, box.x, box.y + Math.max(0, (box.h - blk.el.offsetHeight) * 0.45));
    R.blk = blk;
    R.mark = makeMark(R, blk);
    wordsIn(tl, blk, c.words, { rot: 5, d: 0.75 });
    markIn(tl, R, c.mark);
    var beats = c.beats || [];
    beats.forEach(function (t, i) {
      breathe(tl, blk, t);
      if (i % 2 === 0) markBump(tl, R.mark, t + 0.02);
    });
    if (blk.q && beats.length) wiggle(tl, R.qTwin ? [blk.q, R.qTwin] : blk.q, beats[0] + B.h);
    R.exitWords = blk.ws.map(function (x) { return x.w; });
    R.focus = R.mark ? R.mark.center : center(off(blk.el));
  };

  /** Pile : la phrase et sa précision dessous, sur un quadrillage qui monte. */
  SC.stack = function (tl, R) {
    var B = R.B, c = B.cue;
    decoGrid(tl, R);
    var box = zone(R, { x: 90, y: 300, w: 900, h: 1120 });
    var blk = block(R.pin, B.words, { left: LEFT, carry: R.carryTo });
    var sub = B.sub ? subEl(R.pin, B.sub) : null;
    blk.el.style.width = box.w + "px";
    if (sub) { sub.style.width = box.w + "px"; sub.style.textAlign = LEFT ? "left" : "center"; }
    var gap = 44;
    var total = function () { return blk.el.offsetHeight + (sub ? gap + sub.offsetHeight : 0); };
    fitAll([{ el: blk.el, max: SZ.stack[0], min: SZ.stack[1] }].concat(sub ? [{ el: sub, max: SZ.sub[0], min: SZ.sub[1] }] : []), function () { return total() <= box.h && within(blk, box.w); }, B.id);
    freeze(blk);
    var top = box.y + Math.max(0, (box.h - total()) * 0.4);
    place(blk.el, box.x, top);
    if (sub) place(sub, box.x, top + blk.el.offsetHeight + gap);
    R.blk = blk;
    R.mark = makeMark(R, blk);
    wordsIn(tl, blk, c.words, {});
    if (sub) { fadeUp(tl, sub, c.sub); R.rest.push(sub); }
    markIn(tl, R, c.mark);
    R.exitWords = blk.ws.map(function (x) { return x.w; });
    R.focus = R.mark ? R.mark.center : center(off(blk.el));
  };

  /** Chiffre : des rouleaux de machine à sous qui s'arrêtent un à un sur la grille, puis l'impact. */
  SC.number = function (tl, R) {
    var B = R.B, c = B.cue, N = B.number;
    var box = zone(R, { x: 90, y: 290, w: 900, h: 1180 });
    var numEl = make("div", "num disp", R.pin);
    var text = spaces(N.text), pre = spaces(N.prefix || ""), suf = spaces(N.suffix || "");
    var core = text.slice(pre.length, Math.max(pre.length, text.length - suf.length));
    var preEl = pre ? make("span", "ch", numEl, pre) : null;
    var cols = [];
    for (var i = 0; i < core.length; i++) {
      var ch = core.charAt(i);
      if (/\d/.test(ch)) { var dg = make("span", "dg", numEl); cols.push({ dg: dg, reel: make("span", "reel", dg), d: Number(ch) }); }
      else make("span", "ch", numEl, ch);
    }
    var sufEl = suf ? make("span", "ch", numEl, suf) : null;
    cols.forEach(function (col, j) {
      col.L = 10 * (1 + Math.min(3, j)) + col.d + 1;
      for (var q = 0; q < col.L; q++) make("b", "", col.reel, String(q % 10));
    });
    // Les mots d'avant le chiffre au-dessus (« Plus de »), ceux d'après dessous (« livres »). La marque va au bloc qui
    // porte l'emphase (le point, au bloc du bas) : l'autre ne lui réserve pas de place.
    var lead = Math.min(N.lead || 0, B.words.length);
    var hasEm = function (ws) { return ws.some(function (x) { return x.em; }); };
    var markLow = B.words.length > lead && (hasEm(B.words.slice(lead)) || !hasEm(B.words.slice(0, lead)));
    var leadBlk = lead ? block(R.pin, B.words.slice(0, lead), { plain: markLow }) : null;
    var blk = B.words.length > lead ? block(R.pin, B.words.slice(lead), { carry: R.carryTo, plain: !markLow }) : null;
    var sub = B.sub ? subEl(R.pin, B.sub) : null;
    if (leadBlk) leadBlk.el.style.width = box.w + "px";
    if (blk) blk.el.style.width = box.w + "px";
    if (sub) { sub.style.width = box.w + "px"; sub.style.textAlign = "center"; }
    var g0 = 22, g1 = 34, g2 = 30;
    var total = function () { return (leadBlk ? leadBlk.el.offsetHeight + g0 : 0) + numEl.offsetHeight + (blk ? g1 + blk.el.offsetHeight : 0) + (sub ? g2 + sub.offsetHeight : 0); };
    // Un chiffre court est plus grand (« 3 » ne fait pas la taille de « 2000 ») : sa taille propre d'abord (largeur et
    // hauteur), puis le tout ensemble.
    var nmax = Math.round(SZ.number[0] * Math.min(1.7, Math.max(1, 3.5 / Math.max(1, cols.length))));
    numEl.style.fontSize = nmax + "px";
    for (var gN = 0; gN < 30 && (numEl.offsetWidth > box.w || numEl.offsetHeight > 640) && nmax > SZ.number[0]; gN++) { nmax = Math.max(SZ.number[0], Math.round(nmax * 0.94)); numEl.style.fontSize = nmax + "px"; }
    var parts = [{ el: numEl, max: nmax, min: SZ.number[1] }];
    if (leadBlk) parts.push({ el: leadBlk.el, max: SZ.numText[0], min: SZ.numText[1] });
    if (blk) parts.push({ el: blk.el, max: SZ.numText[0], min: SZ.numText[1] });
    if (sub) parts.push({ el: sub, max: SZ.sub[0], min: SZ.sub[1] });
    fitAll(parts, function () { return numEl.offsetWidth <= box.w && numEl.offsetHeight <= 640 && total() <= box.h && (!blk || within(blk, box.w)) && (!leadBlk || within(leadBlk, box.w)); }, B.id);
    if (leadBlk) freeze(leadBlk);
    if (blk) freeze(blk);
    var top = box.y + Math.max(0, (box.h - total()) * 0.46);
    if (leadBlk) { place(leadBlk.el, box.x, top); top += leadBlk.el.offsetHeight + g0; }
    var nw = numEl.offsetWidth, nh = numEl.offsetHeight;
    place(numEl, 540 - nw / 2, top);
    // Tant que le préfixe et le suffixe (« % », « € », « /5 ») sont cachés, les chiffres restent au centre ; le nombre
    // glisse à sa place finale quand ils arrivent.
    var shift = ((sufEl ? sufEl.offsetWidth : 0) - (preEl ? preEl.offsetWidth : 0)) / 2;
    var y = top + nh;
    if (blk) { place(blk.el, box.x, y + g1); y += g1 + blk.el.offsetHeight; }
    if (sub) place(sub, box.x, y + g2);
    var cx = 540, cy = top + nh / 2;
    decoGlow(R, cx, cy, 1100);
    var rays = decoRays(tl, R, cx, cy, 0.3);
    var ring = make("i", "ringb", R.pin);
    var rs = Math.round(Math.max(nw, nh) * 0.9);
    ring.style.cssText = "left:" + Math.round(cx - rs / 2) + "px;top:" + Math.round(cy - rs / 2) + "px;width:" + rs + "px;height:" + rs + "px";
    // Les rouleaux.
    var size = parseFloat(numEl.style.fontSize), lh = 1.04 * size;
    tl.fromTo(numEl, { autoAlpha: 0, scale: 0.86 }, { autoAlpha: 1, scale: 1, duration: 0.5, ease: "expo.out" }, c.spin);
    if (Math.abs(shift) >= 1) tl.fromTo(numEl, { x: Math.round(shift) }, { x: 0, duration: 0.45, ease: "expo.out", immediateRender: true }, c.final - 0.05);
    cols.forEach(function (col, j) {
      var land = c.land && c.land.length ? c.land[Math.min(j, c.land.length - 1)] : c.final;
      var t0 = c.spin + 0.04, t1 = Math.max(t0 + 0.12, land - 0.1);
      var f = blurFilter(true);
      col.dg.style.filter = f.url;
      tl.fromTo(col.reel, { y: 0 }, { y: -(col.L - 2) * lh, duration: t1 - t0, ease: "power1.in" }, t0);
      // Un rebond court : plus fort, le chiffre passerait au-dessus de sa fenêtre et y serait coupé.
      tl.to(col.reel, { y: -(col.L - 1) * lh, duration: 0.42, ease: "back.out(1.4)" }, t1);
      tl.fromTo(f.blur, { attr: { stdDeviation: "0 0" } }, { attr: { stdDeviation: "0 " + Math.max(4, Math.round(size * 0.05)) }, duration: t1 - t0, ease: "power2.in" }, t0);
      tl.to(f.blur, { attr: { stdDeviation: "0 0" }, duration: 0.12, ease: "power2.out" }, t1);
      tl.set(col.dg, { filter: "none" }, t1 + 0.14);
    });
    var tf = c.final;
    if (preEl) tl.fromTo(preEl, { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.4, ease: "back.out(3)" }, tf - 0.05);
    if (sufEl) tl.fromTo(sufEl, { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.4, ease: "back.out(3)" }, tf);
    tl.fromTo(numEl, { scale: 1.12 }, { scale: 1, duration: 0.7, ease: "elastic.out(1, 0.45)", immediateRender: false }, tf);
    // Sur un fond sombre, l'éclair prend la couleur du chiffre (blanc, il délaverait la scène en gris).
    if (darkBg(R.surf.bg)) flashTint(tl, c.flash, 0.4, R.surf.mk);
    else flash(tl, c.flash, 0.55);
    tl.to(rays.r, { opacity: 0.9, duration: 0.08 }, tf);
    tl.to(rays.r, { opacity: 0.32, duration: 1.2, ease: "power2.out" }, tf + 0.08);
    tl.fromTo(rays.w, { rotation: 0 }, { rotation: 30, duration: 1.4, ease: "expo.out", immediateRender: false }, tf);
    tl.fromTo(ring, { scale: 0.8, opacity: 0.8 }, { scale: 2.2, opacity: 0, duration: 0.9, ease: "expo.out", immediateRender: false }, tf);
    // Un chiffre qui reste : il repulse sur les temps (c.pulses), l'anneau repart et les rayons se ravivent.
    (c.pulses || []).forEach(function (t) {
      tl.fromTo(numEl, { scale: 1.05 }, { scale: 1, duration: 0.6, ease: "expo.out", immediateRender: false }, t);
      tl.fromTo(ring, { scale: 0.85, opacity: 0.55 }, { scale: 2, opacity: 0, duration: 0.9, ease: "expo.out", immediateRender: false }, t);
      tl.to(rays.r, { opacity: 0.6, duration: 0.08 }, t);
      tl.to(rays.r, { opacity: 0.32, duration: 0.8, ease: "power2.out" }, t + 0.08);
    });
    // La marque, mesurée avant l'entrée des mots : leur état de départ (police variable maigre et serrée) fausserait
    // sa place.
    var mb = markLow ? blk : leadBlk;
    if (mb) {
      R.blk = mb;
      R.mark = makeMark(R, mb);
    }
    if (leadBlk) wordsIn(tl, leadBlk, c.lead, {});
    if (blk) wordsIn(tl, blk, c.words, {});
    if (mb) markIn(tl, R, c.mark);
    R.exitWords = (leadBlk ? leadBlk.ws : []).concat(blk ? blk.ws : []).map(function (x) { return x.w; });
    if (sub) { fadeUp(tl, sub, c.sub); R.rest.push(sub); }
    R.rest.push(numEl);
    R.focus = { x: cx, y: cy };
  };

  /** Liste : le titre puis chaque élément sur un temps, sa pastille cochée. */
  SC.list = function (tl, R) {
    var B = R.B, c = B.cue;
    decoGrid(tl, R);
    var box = zone(R, { x: 90, y: 300, w: 900, h: 1150 });
    var blk = block(R.pin, B.words, { left: LEFT, carry: R.carryTo });
    blk.el.style.width = box.w + "px";
    var rows = B.items.map(function (txt) {
      var li = make("div", "li", R.pin);
      li.style.maxWidth = box.w + "px";
      var bd = make("span", "bd", li);
      var ic = icon(bd, "check");
      var lt = make("span", "lt", li, txt);
      return { li: li, bd: bd, lt: lt, path: ic.firstChild };
    });
    var gT = 60, gR = 30;
    var rowsH = function () { return rows.reduce(function (s, r) { return s + r.li.offsetHeight; }, 0) + gR * Math.max(0, rows.length - 1); };
    var total = function () { return blk.el.offsetHeight + gT + rowsH(); };
    // Le titre d'abord, seul (un long élément ne le rapetisse plus), puis les éléments dans la place qui reste : un
    // élément long passe sur deux lignes plutôt que de rapetisser toute la liste.
    var twoLines = function (r) { var fs = parseFloat(r.li.style.fontSize) || 40; return r.lt.offsetHeight <= fs * 1.1 * 2 + 2; };
    fitAll([{ el: blk.el, max: SZ.list[0], min: SZ.list[1] }], function () {
      return blk.el.offsetHeight <= box.h * 0.45 && within(blk, box.w);
    }, B.id);
    fitAll(rows.map(function (r) { return { el: r.li, max: SZ.item[0], min: SZ.item[1] }; }), function () {
      return total() <= box.h && rows.every(function (r) { return r.li.offsetWidth <= box.w && twoLines(r); });
    }, B.id);
    freeze(blk);
    // La place qui reste aère la liste (jusqu'à 56 px entre les éléments).
    if (rows.length > 1) gR = Math.round(clamp(30 + (box.h - total()) / (2 * (rows.length - 1)), 30, 56));
    var top = box.y + Math.max(0, (box.h - total()) * 0.42);
    place(blk.el, box.x, top);
    var colW = rows.reduce(function (m, r) { return Math.max(m, r.li.offsetWidth); }, 0);
    var x = LEFT ? box.x : 540 - colW / 2, y = top + blk.el.offsetHeight + gT;
    rows.forEach(function (r) { place(r.li, x, y); y += r.li.offsetHeight + gR; });
    R.blk = blk;
    R.mark = makeMark(R, blk);
    wordsIn(tl, blk, c.words, {});
    markIn(tl, R, c.mark);
    rows.forEach(function (r, i) {
      var t = (c.items || [])[i];
      if (!Number.isFinite(t)) return;
      r.path.setAttribute("stroke-dasharray", "22 22");
      tl.fromTo(r.li, { x: -50, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.5, ease: "expo.out" }, t);
      tl.fromTo(r.bd, { scale: 0 }, { scale: 1, duration: 0.45, ease: "back.out(3)" }, t + 0.02);
      tl.fromTo(r.path, { attr: { "stroke-dashoffset": 22 } }, { attr: { "stroke-dashoffset": 0 }, duration: 0.3, ease: "power2.out" }, t + 0.12);
      R.rest.push(r.li);
    });
    R.exitWords = blk.ws.map(function (x) { return x.w; });
    R.focus = R.mark ? R.mark.center : center(off(blk.el));
  };

  /** Machine à sous : la tête, puis les items qui défilent dans une fenêtre, le dernier entouré. */
  SC.slot = function (tl, R) {
    var B = R.B, c = B.cue, n = B.items.length;
    decoGrid(tl, R);
    var box = zone(R, { x: 90, y: 260, w: 900, h: 1050 });
    var blk = block(R.pin, B.words, { left: LEFT, carry: R.carryTo });
    blk.el.style.width = box.w + "px";
    var win = make("div", "slot disp", R.pin);
    win.style.width = box.w + "px";
    var reel = make("div", "sreel", win);
    var spans = B.items.map(function (t) {
      var d = make("div", "", reel);
      d.style.textAlign = LEFT ? "left" : "center";
      return make("span", "", d, t);
    });
    // La boucle autour du dernier item déborde de la fenêtre : un écart entre la tête et la fenêtre lui fait place
    // (elle ne raye jamais la tête). La fenêtre d'abord (l'item le plus long fixe sa taille), puis la tête, qui peut
    // rester plus grande que les items.
    var gapK = B.mark !== "hidden" && n ? 0.3 : 0;
    var p0 = function () { return parseFloat(win.style.fontSize); };
    fitAll([{ el: win, max: SZ.slot[0], min: SZ.slot[1] }], function () {
      return spans.every(function (s) { return s.offsetWidth <= box.w; }) && p0() * (1.02 + gapK) <= box.h * 0.5;
    }, B.id);
    fitAll([{ el: blk.el, max: SZ.slot[0], min: Math.min(SZ.slot[1], p0()) }], function () {
      return blk.el.offsetHeight + p0() * (1.02 + gapK) <= box.h && within(blk, box.w);
    }, B.id);
    freeze(blk);
    var size = p0(), lh = Math.round(size * 1.02), G = Math.round(size * gapK);
    win.style.height = lh + "px";
    spans.forEach(function (s) { s.parentNode.style.height = lh + "px"; s.parentNode.style.lineHeight = lh + "px"; });
    var hT = blk.el.offsetHeight + G + lh;
    var top = box.y + Math.max(0, (box.h - hT) * 0.42);
    place(blk.el, box.x, top);
    var wy = top + blk.el.offsetHeight + G - Math.round(size * 0.02);
    place(win, box.x, wy);
    var f = blurFilter(true);
    win.style.filter = f.url;
    R.blk = blk;
    R.mark = makeMark(R, blk);
    wordsIn(tl, blk, c.words, {});
    var items = c.items || [];
    if (Number.isFinite(items[0])) tl.fromTo(reel, { y: lh }, { y: 0, duration: 0.5, ease: "expo.out" }, items[0]);
    for (var i = 1; i < n; i++) {
      var t = items[i];
      if (!Number.isFinite(t)) continue;
      tl.to(reel, { y: -lh * i, duration: 0.34, ease: "back.out(2.2)" }, t - 0.05);
      tl.fromTo(f.blur, { attr: { stdDeviation: "0 0" } }, { attr: { stdDeviation: "0 16" }, duration: 0.07, ease: "none", immediateRender: false }, t - 0.05);
      tl.to(f.blur, { attr: { stdDeviation: "0 0" }, duration: 0.16, ease: "power2.out" }, t + 0.02);
    }
    R.focus = center(off(win));
    if (B.mark !== "hidden" && n) {
      var ls = spans[n - 1];
      var rx = box.x + ls.offsetLeft, rw = ls.offsetWidth;
      var cx = rx + rw / 2, cy = wy + lh * 0.5;
      // Même boucle que les marques (fitLoop) ; un item trop large pour être entouré est souligné.
      var lp = fitLoop(rw / 2 + size * 0.04, size * 0.47, lh * 0.6, cx, size);
      var st = stroke(R.pin, lp ? loopPath(cx, cy, lp.rx, lp.ry, R.rnd, lp.e) : wave(rx - size * 0.03, rx + rw + size * 0.03, cy + size * 0.46, size * 0.035, size * 0.5), Math.max(9, Math.round(size * 0.07)));
      draw(tl, st, c.mark, 0.45);
      R.rest.push(st.svg);
      R.focus = { x: cx, y: cy };
    }
    if (R.mark) markIn(tl, R, (last(c.words) || c.t0) + B.h);
    R.rest.push(win);
    R.exitWords = blk.ws.map(function (x) { return x.w; });
  };

  /** Téléphone : un titre au-dessus du téléphone partagé de la série ; l'écran dépend de B.screen. */
  SC.phone = function (tl, R) {
    var B = R.B, c = B.cue;
    // Les scènes d'une même série de téléphone partagent le même décor, au même instant (le fond ne saute pas quand
    // l'écran se retourne) : même tirage, même départ, même durée.
    var L = R.runObj.list, shared = { rnd: prng(1000 + Math.max(0, B.run)), t0: decoStart(L[0]), span: Math.max(0.6, last(L).B.E - L[0].B.S + 0.6) };
    decoOrbs(tl, R, shared);
    decoGrid(tl, R, shared);
    var box = zone(R, { x: 90, y: 196, w: 900, h: 410 });
    var blk = block(R.pin, B.words, { carry: R.carryTo });
    var sub = B.sub ? subEl(R.pin, B.sub) : null;
    blk.el.style.width = box.w + "px";
    if (sub) { sub.style.width = box.w + "px"; sub.style.textAlign = "center"; }
    var total = function () { return blk.el.offsetHeight + (sub ? 22 + sub.offsetHeight : 0); };
    fitAll([{ el: blk.el, max: SZ.phone[0], min: SZ.phone[1] }].concat(sub ? [{ el: sub, max: SZ.psub[0], min: SZ.psub[1] }] : []), function () { return total() <= box.h && within(blk, box.w); }, B.id);
    freeze(blk);
    var top = box.y + Math.max(0, (box.h - total()) * 0.62);
    place(blk.el, box.x, top);
    if (sub) place(sub, box.x, top + blk.el.offsetHeight + 22);
    R.blk = blk;
    R.mark = makeMark(R, blk);
    wordsIn(tl, blk, c.words, {});
    var tw = num(last(c.words), c.t0);
    markIn(tl, R, num(c.mark, tw + B.h));
    if (sub) { fadeUp(tl, sub, tw + 0.15); R.rest.push(sub); }
    var run = R.runObj;
    var dark = B.screen === "feed" || B.screen === "notifs";
    var sc = make("div", "screen " + (dark ? "dk" : "lt"), run.scr);
    R.screenEl = sc;
    (SCREENS[B.screen] || SCREENS.app)(tl, R, sc);
    var sb = make("div", "sbar", sc);
    make("span", "", sb, "9:41");
    make("i", "", make("span", "", sb));
    R.exitWords = blk.ws.map(function (x) { return x.w; });
    R.focus = { x: 540, y: 1150 };
  };

  var SCREENS = {};
  var FEED_POSTS = ["Top 5 à sauvegarder", "Tu dois voir ça.", "POV : tu scrolles encore", "Partie 4 sur 12", "Personne ne te dit ça", "Arrête de faire ça", "Le secret des pros", "Attends la fin…"];
  /** Le fil qui défile de plus en plus vite (flou de bougé), les bulles qui s'empilent autour du téléphone. */
  SCREENS.feed = function (tl, R, sc) {
    var B = R.B, c = B.cue, rnd = R.rnd;
    var vp = make("div", "vp", sc);
    var f = blurFilter(true);
    vp.style.filter = f.url;
    // Le fil défile sous la barre d'état, jamais dessous : la fenêtre commence à 62 px (l'heure et l'îlot restent nets).
    vp.style.top = "62px";
    vp.style.height = "930px";
    var feed = make("div", "feed", vp);
    feed.style.top = "0px";
    var head = make("div", "fhead", feed, "Pour toi");
    make("span", "", head, "Abonnements");
    // Des publications génériques (constantes du moteur) : le titre est déjà au-dessus du téléphone, les items sont
    // les bulles qui jaillissent autour.
    var texts = FEED_POSTS;
    for (var i = 0; i < 8; i++) {
      var p = make("div", "post", feed);
      var ph = make("div", "ph", p);
      var av = make("i", "av", ph);
      av.style.background = tone(i);
      av.style.boxShadow = "0 0 0 3px #0b0b10,0 0 0 5.5px " + tone(i + 2);
      make("i", "nm", ph).style.width = Math.round(90 + rnd() * 110) + "px";
      make("span", "dots", ph, "•••");
      var pm = make("div", "pm", p);
      var t1 = tone(i + 1), t2 = mix(t1, "#000000", 0.4);
      pm.style.background = i % 3 === 2 ? "#f7f5ed" : "linear-gradient(165deg," + t1 + "," + t2 + ")";
      pm.style.color = i % 3 === 2 ? "#15161f" : onColor(t1);
      make("div", "big disp", pm, texts[i % texts.length]);
      var ncv = 1 + Math.floor(rnd() * 3);
      for (var k = 0; k < ncv; k++) {
        var cv = make("i", "cv", pm);
        cv.style.background = tone(i + k + 2);
        cv.style.right = (30 + k * 42) + "px";
        cv.style.bottom = (32 + (k % 2) * 14) + "px";
        cv.style.transform = "rotate(" + (-8 + k * 5) + "deg)";
      }
      var pa = make("div", "pa", p);
      var likes = make("span", "", pa);
      icon(likes, "heart");
      make("b", "", likes, (Math.round(10 + rnd() * 190) + "," + Math.floor(rnd() * 10) + " k"));
      var coms = make("span", "", pa);
      icon(coms, "chat");
      make("b", "", coms, String(Math.round(200 + rnd() * 9000)).replace(/\B(?=(\d{3})+(?!\d))/g, " "));
      icon(make("span", "", pa), "share");
      icon(make("span", "sv", pa), "save");
      var pc = make("div", "pc", p);
      make("i", "", pc).style.width = Math.round(260 + rnd() * 160) + "px";
      make("i", "", pc).style.width = Math.round(140 + rnd() * 160) + "px";
    }
    var dist = Math.max(0, feed.offsetHeight - 930);
    var s0 = c.scroll ? c.scroll[0] : c.t0, s1 = c.scroll ? c.scroll[1] : B.exit;
    tl.fromTo(feed, { y: 0 }, { y: -dist, duration: Math.max(0.3, s1 - s0), ease: "power2.in" }, s0);
    tl.fromTo(f.blur, { attr: { stdDeviation: "0 0" } }, { attr: { stdDeviation: "0 26" }, duration: Math.max(0.3, s1 - s0), ease: "power3.in" }, s0);
    var bubs = B.items.map(function (txt, i) { return bubble(R.runObj.over, txt, i, false); });
    bubbles(tl, R, bubs, c.items || [], c.away, 720, 1560, [40, 1040]);
  };
  /** L'écran de l'application : sa marque, ses choix (items), son bouton (label) ; le doigt touche le choix ou le bouton. */
  SCREENS.app = function (tl, R, sc) {
    var B = R.B, c = B.cue, n = B.items.length;
    var bar = make("div", "abar disp", sc);
    var brand = String(S.brand.name || "");
    if (brand) {
      var bt = make("span", "", bar, brand);
      make("i", "abd", bar).style.background = APP_ACC;
      // On mesure le texte (la boîte, elle, fait toute la largeur de l'écran).
      for (var g = 0; g < 12 && bt.offsetWidth > 380; g++) bar.style.fontSize = Math.round(parseFloat(getComputedStyle(bar).fontSize) * 0.92) + "px";
    } else make("i", "abl", bar);
    // La progression du questionnaire (un décor) : elle avance quand on touche un choix.
    var prog = make("div", "aprog", sc);
    var pf = make("i", "", prog);
    pf.style.background = APP_ACC;
    gsap.set(pf, { scaleX: 0.34 });
    var fan = null;
    if (n <= 2) {
      fan = make("div", "fan", sc);
      for (var i = 0; i < 3; i++) {
        var fc = make("i", "", fan);
        fc.style.background = "linear-gradient(160deg," + tone(i) + "," + mix(tone(i), "#000000", 0.4) + ")";
        fc.style.left = (151 + (i - 1) * 118) + "px";
        fc.style.top = (i === 1 ? 6 : 24) + "px";
        fc.style.zIndex = i === 1 ? "3" : "1";
        gsap.set(fc, { rotation: (i - 1) * 13 });
      }
    }
    // Les choix au milieu de l'espace libre (entre la progression et le bouton).
    var top0 = n <= 2 ? 520 : Math.round(200 + (830 - 200 - (n * 122 - 18)) / 2);
    var ops = B.items.map(function (txt, i) {
      var op = make("div", "op disp", sc);
      op.style.top = (top0 + i * 122) + "px";
      make("span", "oi", op, "ABCD".charAt(i));
      var ot = make("span", "ot", op, txt);
      var ck = make("span", "ck", op);
      ck.style.background = APP_ACC;
      ck.style.color = onColor(APP_ACC);
      icon(ck, "check");
      var fs = 30;
      for (var q = 0; q < 10 && (ot.offsetHeight > fs * 2.05 || ot.scrollWidth > ot.clientWidth + 0.5) && fs > 20; q++) { fs = Math.max(20, Math.round(fs * 0.92)); ot.style.fontSize = fs + "px"; }
      gsap.set(ck, { scale: 0 });
      return { op: op, ck: ck, y: top0 + i * 122 + 52 };
    });
    var btn = null;
    if (B.label) {
      btn = make("div", "abtn", sc);
      btn.style.background = APP_ACC;
      btn.style.color = onColor(APP_ACC);
      var bl = make("span", "", btn, B.label);
      icon(btn, "arrow");
      for (var b = 0; b < 10 && bl.offsetWidth > 330; b++) btn.style.fontSize = Math.round(parseFloat(getComputedStyle(btn).fontSize) * 0.92) + "px";
    }
    // La barre et la progression sont là dès que l'écran s'affiche (jamais d'écran vide pendant un retournement).
    if (Number.isFinite(c.ui)) {
      if (fan) tl.fromTo(fan.children, { y: 80, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, ease: "back.out(1.8)", stagger: 0.05 }, c.ui + 0.04);
      if (btn) tl.fromTo(btn, { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45, ease: "expo.out" }, c.ui + 0.1);
    }
    ops.forEach(function (o, i) {
      var t = (c.items || [])[i];
      if (Number.isFinite(t)) tl.fromTo(o.op, { x: 60, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.45, ease: "expo.out" }, t);
    });
    var T = c.tap;
    if (!Number.isFinite(T)) return;
    var pick = Number.isInteger(B.pick) && ops[B.pick] ? ops[B.pick] : !btn && ops.length ? ops[0] : null;
    if (pick) {
      tap(tl, sc, 330, pick.y, T);
      tl.to(pick.op, { backgroundColor: APP_ACC, color: onColor(APP_ACC), duration: 0.1, ease: "power1.out" }, T - 0.02);
      tl.fromTo(pick.op, { scale: 0.95 }, { scale: 1, duration: 0.36, ease: "back.out(3)", immediateRender: false }, T);
      tl.to(pick.ck, { scale: 1, duration: 0.3, ease: "back.out(3)" }, T + 0.03);
      tl.to(pf, { scaleX: 0.5, duration: 0.6, ease: "expo.out" }, T + 0.05);
      pick.ck.style.background = onColor(APP_ACC);
      pick.ck.style.color = APP_ACC;
      R.tapAt = { x: 304 + 330, y: 654 + pick.y };
    } else if (btn) {
      tap(tl, sc, 300, 906, T);
      tl.to(btn, { scale: 0.95, duration: 0.07, ease: "power2.in" }, T - 0.04);
      tl.to(btn, { scale: 1, duration: 0.3, ease: "back.out(3)" }, T + 0.04);
      tl.to(pf, { scaleX: 0.5, duration: 0.6, ease: "expo.out" }, T + 0.05);
      R.tapAt = { x: 304 + 300, y: 654 + 906 };
    }
  };
  /** Une conversation : les messages arrivent, les anciens montent. */
  SCREENS.chat = function (tl, R, sc) {
    var B = R.B, c = B.cue;
    var head = make("div", "chead", sc);
    var name = B.label || String(S.brand.name || "") || "Messages";
    var av = make("span", "cav", head, name.charAt(0).toUpperCase());
    av.style.background = APP_ACC;
    av.style.color = onColor(APP_ACC);
    var nm = make("div", "cnm", head, name);
    make("span", "", nm, "en ligne");
    make("i", "cin", sc);
    var box = make("div", "msgs", sc);
    var msgs = B.items.map(function (txt, i) {
      var m = make("div", "msg " + (i % 2 ? "out" : "in"), box, txt);
      if (i % 2) { m.style.background = APP_ACC; m.style.color = onColor(APP_ACC); }
      return m;
    });
    var gap = 14, H0 = 696;
    var hs = msgs.map(function (m) { return m.offsetHeight; });
    var topOf = function (i, j) { var y = H0; for (var k = j; k >= i; k--) y -= hs[k] + (k < j ? gap : 0); return y; };
    // L'en-tête est là dès que l'écran s'affiche (jamais un écran blanc pendant un retournement). Les anciens messages
    // montent un peu avant le nouveau : il prend une place déjà libre (jamais deux bulles l'une sur l'autre).
    msgs.forEach(function (m, i) {
      var t = (c.items || [])[i];
      gsap.set(m, { y: topOf(i, i), transformOrigin: i % 2 ? "100% 100%" : "0% 100%" });
      if (!Number.isFinite(t)) { gsap.set(m, { autoAlpha: 0 }); return; }
      tl.fromTo(m, { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.4, ease: "back.out(2)" }, t);
      for (var k = 0; k < i; k++) tl.to(msgs[k], { y: topOf(k, i), duration: 0.32, ease: "power3.out" }, t - 0.14);
    });
  };
  /** L'écran verrouillé : l'heure, puis les notifications qui s'empilent (la plus récente en haut). */
  SCREENS.notifs = function (tl, R, sc) {
    var B = R.B, c = B.cue;
    // Le fond d'écran vient de l'accent seul (deux teintes du nuancier assombries donnaient des couleurs boueuses).
    sc.style.background = "linear-gradient(170deg," + mix(ACC, "#000000", 0.2) + "," + mix(ACC, "#0b0b10", 0.7) + ")";
    icon(sc, "lock", "lk");
    make("div", "clock disp", sc, "9:41");
    var brand = String(S.brand.name || "") || "Notification";
    var cards = B.items.map(function (txt) {
      var nt = make("div", "nt", sc);
      var ni = make("span", "ni", nt);
      ni.style.background = APP_ACC;
      ni.style.color = onColor(APP_ACC);
      icon(ni, "bell");
      var nb = make("div", "nb", nt);
      var nh = make("div", "nh", nb);
      make("span", "", nh, brand);
      make("span", "", nh, "maintenant");
      // Un nombre reste avec son nom (« 8 fois », « 690 € »).
      make("div", "nx", nb, String(txt).replace(/(\d)[ \u202f](?=\S)/g, "$1\u00a0"));
      return nt;
    });
    var hs = cards.map(function (e) { return e.offsetHeight; });
    var topOf = function (i, j) { var y = 380; for (var k = j; k > i; k--) y += hs[k] + 14; return y; };
    // Le cadenas et l'heure sont là dès que l'écran s'affiche ; les notifications déjà là descendent un peu avant la
    // nouvelle (elle prend une place libre : jamais deux cartes translucides l'une sur l'autre).
    cards.forEach(function (e, j) {
      var t = (c.items || [])[j];
      if (!Number.isFinite(t)) { gsap.set(e, { autoAlpha: 0 }); return; }
      tl.fromTo(e, { y: topOf(j, j) - 40, scale: 0.9, autoAlpha: 0 }, { y: topOf(j, j), scale: 1, autoAlpha: 1, duration: 0.45, ease: "back.out(1.6)" }, t);
      for (var i = 0; i < j; i++) tl.to(cards[i], { y: topOf(i, j), duration: 0.36, ease: "power3.out" }, t - 0.16);
    });
  };

  /** Le téléphone partagé d'une série de scènes téléphone (posé juste après la dernière plaque de la série). */
  function makeRun(list) {
    var lastR = list[list.length - 1];
    var st = make("div", "pstage", null);
    lastR.plate.parentNode.insertBefore(st, lastR.plate.nextSibling);
    var ph = make("div", "phone", st);
    var fl = make("div", "pfl", ph);
    var body = make("div", "pbody", fl);
    var face = make("div", "pface", body);
    var scr = make("div", "scr", face);
    make("div", "island", scr);
    // Le reflet glisse sur le téléphone pendant un retournement, découpé à sa silhouette (jamais une plaque grise à côté).
    var sheen = make("div", "sheen", make("div", "sheenw", body));
    var over = make("div", "pover", st);
    var run = { list: list, st: st, ph: ph, fl: fl, body: body, scr: scr, sheen: sheen, over: over };
    list.forEach(function (R) { R.runObj = run; });
    gsap.set(ph, { transformOrigin: "250px 510px" });
    gsap.set(body, { transformPerspective: 1700 });
    return run;
  }
  function runAnim(tl, list) {
    var run = list[0].runObj, B = list[0].B;
    var tr = num(B.cue.rise, B.enter);
    tl.set(run.st, { visibility: "visible" }, tr);
    gsap.set(list[0].screenEl, { visibility: "inherit" });
    tl.fromTo(run.ph, { y: 1250, rotation: -9, scale: 0.92 }, { y: 0, rotation: 0, scale: 1, duration: 0.95, ease: "expo.out" }, tr);
    tl.fromTo(run.body, { rotationX: 30 }, { rotationX: 0, duration: 1.05, ease: "expo.out" }, tr);
    var end = list[list.length - 1].B.E;
    var fd = 0.8, reps = Math.floor((end - tr - 1.2) / fd);
    if (reps % 2 === 0) reps -= 1;
    if (reps >= 1) tl.to(run.fl, { y: -12, duration: fd, ease: "sine.inOut", yoyo: true, repeat: reps }, tr + 1);
    for (var i = 1; i < list.length; i++) phoneSwap(tl, list[i - 1], list[i]);
  }
  /** Entre deux scènes téléphone : l'écran glisse (push) ou le téléphone se retourne (flip). */
  function phoneSwap(tl, A, R) {
    var T = R.B.S, run = R.runObj, a = A.screenEl, b = R.screenEl;
    if (R.B.bin.phone === "push") {
      tl.set(b, { visibility: "inherit" }, T - 0.2);
      tl.fromTo(b, { x: 472 }, { x: 0, duration: 0.4, ease: "power3.inOut", immediateRender: false }, T - 0.2);
      tl.fromTo(a, { x: 0 }, { x: -472, duration: 0.4, ease: "power3.inOut", immediateRender: false }, T - 0.2);
      tl.set(a, { visibility: "hidden" }, T + 0.2);
      return;
    }
    var F = T - 0.24;
    tl.to(run.body, { rotationY: 90, duration: 0.24, ease: "power2.in" }, F);
    tl.set(a, { visibility: "hidden" }, T);
    tl.set(b, { visibility: "inherit" }, T);
    tl.fromTo(run.body, { rotationY: -90 }, { rotationY: 0, duration: 0.34, ease: "power2.out", immediateRender: false }, T);
    tl.fromTo(run.sheen, { opacity: 0, xPercent: -50 }, { opacity: 0.9, xPercent: 0, duration: 0.24, ease: "power2.in", immediateRender: false }, F);
    tl.to(run.sheen, { opacity: 0, xPercent: 50, duration: 0.34, ease: "power2.out" }, T);
    tl.to(run.ph, { scale: 0.9, duration: 0.24, ease: "power2.in" }, F);
    tl.to(run.ph, { scale: 1, duration: 0.5, ease: "back.out(2.2)" }, T);
  }

  /** Une couverture de carte (dégradé et motif dessinés, sans texte) : 3 motifs qui tournent. */
  function cardArt(card, id, i, c1, c2, c3, rnd) {
    var s = svgEl("svg", { class: "art", viewBox: "0 0 560 790", preserveAspectRatio: "none" }, card);
    var lg = svgEl("linearGradient", { id: id, x1: 0, y1: 0, x2: 0.4, y2: 1 }, svgEl("defs", null, s));
    svgEl("stop", { offset: 0, "stop-color": c1 }, lg);
    svgEl("stop", { offset: 1, "stop-color": c2 }, lg);
    svgEl("rect", { width: 560, height: 790, fill: "url(#" + id + ")" }, s);
    var k = i % 3;
    if (k === 0) {
      svgEl("circle", { cx: 410, cy: 500, r: 140, fill: c3, opacity: 0.95 }, s);
      [["rgba(255,255,255,.2)", 0], ["rgba(0,0,0,.2)", 60], ["rgba(0,0,0,.28)", 120]].forEach(function (w) {
        var y = 580 + w[1];
        svgEl("path", { d: "M0 " + y + " C93 " + (y - 30) + " 177 " + (y + 30) + " 270 " + y + " S447 " + (y - 30) + " 560 " + y + " V790 H0 Z", fill: w[0] }, s);
      });
    } else if (k === 1) {
      svgEl("path", { d: "M160 620 L160 470 L225 535 L280 430 L335 535 L400 470 L400 620 Z", fill: "none", stroke: "rgba(255,255,255,.9)", "stroke-width": 12, "stroke-linejoin": "round" }, s);
      svgEl("path", { d: "M140 662 H420", stroke: "rgba(255,255,255,.9)", "stroke-width": 12, "stroke-linecap": "round" }, s);
      for (var j = 0; j < 26; j++) svgEl("circle", { cx: Math.round(rnd() * 560), cy: Math.round(260 + rnd() * 520), r: f1(2 + rnd() * 5), fill: "rgba(255,255,255," + f1(0.3 + rnd() * 0.5) + ")" }, s);
    } else {
      svgEl("circle", { cx: 280, cy: 520, r: 170, fill: c3, opacity: 0.96 }, s);
      svgEl("path", { d: "M0 790 L0 640 L100 550 L180 615 L280 490 L380 605 L450 550 L560 630 L560 790 Z", fill: "rgba(0,0,0,.55)" }, s);
      for (var q = 0; q < 18; q++) svgEl("circle", { cx: Math.round(80 + rnd() * 400), cy: Math.round(320 + rnd() * 360), r: f1(2 + rnd() * 5), fill: q % 2 ? "rgba(255,255,255,.8)" : c3 }, s);
    }
  }

  /** Cartes à swiper : non, non… puis la tension et le tampon (le moment fort), le cœur, les confettis. */
  SC.cards = function (tl, R) {
    var B = R.B, c = B.cue, surf = R.surf, rnd = R.rnd, n = B.items.length;
    var CX = 540, CY = 1005;
    gsap.set(R.pin, { transformOrigin: CX + "px " + CY + "px" });
    decoGlow(R, CX, CY, 1100);
    var rays = decoRays(tl, R, CX, CY, 0.35);
    var burst = svgEl("svg", { class: "burst", viewBox: "-60 -60 120 120" }, R.deco);
    var bp = svgEl("path", { d: CIRCLE, fill: surf.mk }, burst);
    var box = zone(R, { x: 90, y: 226, w: 900, h: 350 });
    var blk = block(R.pin, B.words, {});
    fitBlock(blk, box, SZ.cards, B.id);
    place(blk.el, box.x, box.y + Math.max(0, (box.h - blk.el.offsetHeight) / 2));
    R.blk = blk;
    var pay = null;
    if (B.subWords && B.subWords.length) {
      var pw = B.subWords.map(function (x) { return { t: x.t, em: !!x.em }; });
      if (!pw.some(function (x) { return x.em; }) && pw.length > 1) pw[pw.length - 1].em = true;
      // La chute ne porte pas la marque de la scène (elle va à la question) : aucune place réservée autour d'elle.
      pay = block(R.pin, pw, { plain: true });
      fitBlock(pay, box, SZ.payoff, B.id);
      place(pay.el, box.x, box.y + Math.max(0, (box.h - pay.el.offsetHeight) / 2));
    }
    R.mark = makeMark(R, blk);
    // Les cartes : la dernière (le match) au fond de la pile, les autres dessus.
    var stampC = surf.mk;
    // La carte du match : la teinte la plus vive du nuancier qui laisse lire le tampon (jamais un gris).
    // Jamais une carte de la couleur de la plaque (elle s'y fondrait).
    var onPlate = TONES.filter(function (t) { return contrast(t, surf.bg) >= 1.3 || hueDist(t, surf.bg) >= 40; });
    var pool = onPlate.filter(function (t) { return contrast(t, stampC) >= 2.2; }).sort(function (a, b) { return chroma(b) - chroma(a); });
    var matchTone = pool.length ? pool[0] : lum(stampC) > 0.4 ? "#25264a" : "#f3efe2";
    var others = onPlate.filter(function (t) { return t !== matchTone; });
    if (!others.length) others = [mix(matchTone, "#ffffff", 0.3)];
    var wrap = make("div", "cards", R.pin);
    var cards = new Array(n);
    for (var i = n - 1; i >= 0; i--) {
      var isMatch = i === n - 1;
      var c1 = isMatch ? matchTone : others[i % others.length];
      var card = make("div", "card", wrap);
      // Une teinte claire descend peu (sinon elle tourne au gris sale), une teinte foncée descend franchement.
      cardArt(card, "cg-" + B.id + "-" + i, i, c1, mix(c1, "#000000", lum(c1) > 0.55 ? 0.16 : 0.42), tone(i + 2) === c1 ? tone(i + 3) : tone(i + 2), rnd);
      var tt = make("div", "ctt disp", card, B.items[i]);
      // Le « non » s'affiche en haut à droite des cartes rejetées : le titre lui laisse la place.
      if (!isMatch) tt.style.width = "330px";
      tt.style.color = contrast(c1, "#ffffff") >= 2.4 ? "#ffffff" : "#15161f";
      var fs = 74;
      tt.style.fontSize = fs + "px";
      for (var g = 0; g < 20 && (tt.offsetHeight > 330 || tt.scrollWidth > tt.clientWidth + 0.5) && fs > 40; g++) { fs = Math.max(40, Math.round(fs * 0.94)); tt.style.fontSize = fs + "px"; }
      var o = { el: card };
      if (isMatch) {
        var st = make("div", "stamp disp", card);
        st.style.color = stampC;
        // Le tampon a sa propre plaque (la couleur qui se lit sur mk) : la carte et la montagne sombre dessous ne le
        // noient jamais, quelle que soit la teinte du match.
        st.style.background = rgba(surf.onMk, 0.9);
        if (B.label) {
          st.textContent = B.label;
          var ss = 120;
          for (var h = 0; h < 20 && st.offsetWidth > 464 && ss > 48; h++) { ss = Math.max(48, Math.round(ss * 0.92)); st.style.fontSize = ss + "px"; }
        } else icon(st, "check");
        o.stamp = st;
      } else {
        o.nope = make("div", "nope", card);
        icon(o.nope, "cross");
      }
      cards[i] = o;
    }
    var bx = make("div", "cbtn", R.pin);
    bx.style.left = "320px";
    bx.style.background = "#f7f5ed";
    bx.style.color = NO;
    icon(bx, "cross");
    var bh = make("div", "cbtn", R.pin);
    bh.style.left = "620px";
    bh.style.background = surf.mk;
    var hp = svgEl("path", { d: HEART_BTN, fill: rgba(surf.onMk, 0), stroke: surf.onMk, "stroke-width": 6, "stroke-linejoin": "round" }, svgEl("svg", { viewBox: "-32 -32 64 64" }, bh));
    var cf = make("div", "cf", R.fly);
    place(cf, CX, 960);
    // Entrée.
    wordsIn(tl, blk, c.words, {});
    markIn(tl, R, num(last(c.words), c.t0) + B.h);
    var depth = function (d) { d = Math.min(d, 2); return { y: d * 40, scale: 1 - d * 0.06 }; };
    for (var k = n - 1; k >= 0; k--) {
      var d0 = depth(k);
      tl.fromTo(cards[k].el, { y: 1250, scale: d0.scale, rotation: (n - 1 - k - 1) * 14 }, { y: d0.y, rotation: 0, duration: 0.75, ease: "expo.out" }, c.cards + (n - 1 - k) * 0.07);
    }
    tl.fromTo([bx, bh], { scale: 0 }, { scale: 1, duration: 0.5, ease: "back.out(2.4)", stagger: 0.06 }, c.cards + 0.2);
    // Les « non ».
    (c.swipes || []).forEach(function (t, j) {
      var o = cards[j];
      if (!o || !o.nope) return;
      tl.to(o.el, { x: 46, rotation: 5, duration: 0.14, ease: "power2.out" }, t - 0.14);
      tl.to(o.el, { x: -1180, y: 140, rotation: -34, duration: 0.42, ease: "power3.in" }, t);
      tl.fromTo(o.nope, { scale: 2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.16, ease: "back.out(2)", immediateRender: false }, t - 0.1);
      tl.to(bx, { scale: 0.84, duration: 0.07, ease: "power2.out" }, t - 0.05);
      tl.to(bx, { scale: 1, duration: 0.45, ease: "elastic.out(1, 0.45)" }, t + 0.03);
      for (var m = j + 1; m < n; m++) { var dm = depth(m - j - 1); tl.to(cards[m].el, { y: dm.y, scale: dm.scale, duration: 0.45, ease: "back.out(1.7)" }, t + 0.1 + (m - j - 1) * 0.04); }
      tl.set(o.el, { visibility: "hidden" }, t + 0.45);
    });
    // La tension : on se rapproche, la carte tremble de plus en plus, le cœur bat.
    var mc = cards[n - 1], D = c.stamp, tt0 = num(c.tension, D - 0.5);
    if (D - tt0 > 0.2) {
      tl.to(R.pin, { scale: 1.07, duration: D - tt0, ease: "power2.in" }, tt0);
      tl.to(rays.r, { opacity: 0.55, duration: D - tt0, ease: "power2.in" }, tt0);
      var N = Math.max(4, Math.round((D - tt0) / 0.1)), stp = (D - tt0) / N;
      for (var q = 0; q < N; q++) { var a = 0.6 + 3.6 * Math.pow(q / (N - 1), 2); tl.to(mc.el, { rotation: q % 2 ? -a : a, duration: stp, ease: "sine.inOut" }, tt0 + q * stp); }
    }
    (c.heart || []).forEach(function (t) { tl.fromTo(bh, { scale: 1.14 }, { scale: 1, duration: 0.22, ease: "power2.out", immediateRender: false }, t); });
    if (pay && Number.isFinite(c.out)) {
      tl.to(blk.ws.map(function (x) { return x.w; }), { yPercent: -125, duration: 0.18, ease: "power3.in", stagger: 0.008 }, c.out);
      markOut(tl, R.mark, c.out, { d: 0.16 });
    }
    // LE moment fort.
    flash(tl, D, 0.72);
    tl.to(R.pin, { scale: 1, duration: 0.7, ease: "expo.out" }, D);
    tl.to(mc.el, { rotation: 0, scale: 1.05, duration: 0.12, ease: "power2.out" }, D);
    tl.to(mc.el, { scale: 1, duration: 0.7, ease: "elastic.out(1, 0.5)" }, D + 0.12);
    tl.fromTo(mc.stamp, { scale: 3.4, rotation: -30, opacity: 0 }, { scale: 1, rotation: -14, opacity: 1, duration: 0.22, ease: "power4.in", immediateRender: false }, D - 0.2);
    tl.to(mc.stamp, { scale: 1.08, duration: 0.08, ease: "power2.out" }, D + 0.02);
    tl.to(mc.stamp, { scale: 1, duration: 0.4, ease: "elastic.out(1, 0.4)" }, D + 0.1);
    tl.set(burst, { opacity: 0.9 }, D);
    if (window.MorphSVGPlugin) tl.fromTo(bp, { morphSVG: CIRCLE }, { morphSVG: HEART_BIG, duration: 0.35, ease: "power2.out", immediateRender: false }, D);
    tl.fromTo(burst, { scale: 0.5 }, { scale: 2.5, duration: 0.8, ease: "expo.out", immediateRender: false }, D);
    tl.to(burst, { opacity: 0, duration: 0.5, ease: "power2.out" }, D + 0.04);
    tl.to(hp, { attr: { fill: rgba(surf.onMk, 1) }, duration: 0.12 }, D);
    tl.fromTo(bh, { scale: 1.5 }, { scale: 1, duration: 0.7, ease: "elastic.out(1, 0.4)", immediateRender: false }, D);
    tl.to(rays.r, { opacity: 0.9, duration: 0.1 }, D);
    tl.to(rays.r, { opacity: 0.4, duration: 1.4, ease: "power2.out" }, D + 0.1);
    tl.fromTo(rays.w, { rotation: 0 }, { rotation: 40, duration: 1.5, ease: "expo.out", immediateRender: false }, D);
    (S.confetti || []).forEach(function (q) {
      var e = make("i", "", cf);
      var w = q.round ? 18 : q.w, h = q.round ? 18 : q.hh;
      e.style.cssText = "width:" + w + "px;height:" + h + "px;margin:" + Math.round(-h / 2) + "px 0 0 " + Math.round(-w / 2) + "px;background:" + tone(q.c) + ";border-radius:" + (q.round ? "50%" : "3px");
      tl.set(e, { opacity: 1 }, D);
      if (window.Physics2DPlugin) tl.to(e, { physics2D: { velocity: q.v, angle: q.a, gravity: 2300 }, rotation: q.r, rotationX: q.rx, duration: 2.4, ease: "none" }, D);
      else {
        var rad = q.a * Math.PI / 180, vx = q.v * Math.cos(rad), vy = q.v * Math.sin(rad), ta = Math.max(0.05, -vy / 2300);
        tl.to(e, { x: vx * 2.4, rotation: q.r, duration: 2.4, ease: "none" }, D);
        tl.to(e, { y: -vy * vy / 4600, duration: ta, ease: "power1.out" }, D);
        tl.to(e, { y: -vy * vy / 4600 + 1150 * (2.4 - ta) * (2.4 - ta), duration: 2.4 - ta, ease: "power1.in" }, D + ta);
      }
      tl.to(e, { opacity: 0, duration: 0.5, ease: "power1.in" }, D + q.o);
    });
    if (pay) {
      pay.ws.forEach(function (x, i) {
        var t = num(c.sub, D + 0.05) + i * 0.06;
        x.at = t;
        var from = { yPercent: x.em ? 165 : 135, rotation: 10, scale: x.em ? 1.4 : 1 }, to = { yPercent: 0, rotation: 0, scale: 1, duration: 0.6, ease: x.em ? "back.out(2)" : "expo.out" };
        if (VF && x.w.classList.contains("vf")) { from["--wg"] = VF.lo; to["--wg"] = VF.w; }
        tl.fromTo(x.w, from, to, t);
      });
    }
    if (Number.isFinite(c.float)) tl.to(mc.el, { y: "-=12", duration: 0.7, ease: "sine.inOut", yoyo: true, repeat: 1 }, c.float);
    R.exitWords = (pay || blk).ws.map(function (x) { return x.w; });
    R.rest.push(wrap, bx, bh);
    // Une plongée part dans le cœur (sa couleur remplit l'écran).
    R.focus = { x: 690, y: 1510 };
    R.focusColor = surf.mk;
  };

  /** Bulles : la phrase, puis les items en grosses bulles qui jaillissent de chaque côté. */
  SC.bubbles = function (tl, R) {
    var B = R.B, c = B.cue;
    decoGrid(tl, R);
    var box = zone(R, { x: 90, y: 270, w: 900, h: 480 });
    var blk = block(R.pin, B.words, { left: LEFT, carry: R.carryTo });
    fitBlock(blk, box, SZ.bubbles, B.id);
    var top = box.y + Math.max(0, (box.h - blk.el.offsetHeight) * 0.5);
    place(blk.el, box.x, top);
    R.blk = blk;
    R.mark = makeMark(R, blk);
    wordsIn(tl, blk, c.words, {});
    markIn(tl, R, c.mark);
    var bubs = B.items.map(function (txt, i) { return bubble(R.fly, txt, i, true); });
    bubbles(tl, R, bubs, c.items || [], c.away, top + blk.el.offsetHeight + 150, 1560, [90, 990]);
    if (!Number.isFinite(c.away)) R.rest = R.rest.concat(bubs);
    R.exitWords = blk.ws.map(function (x) { return x.w; });
    R.focus = R.mark ? R.mark.center : center(off(blk.el));
  };

  /** Mur de mots : des rangées inclinées qui défilent, une boîte qui claque au centre, les couleurs qui s'inversent. */
  SC.wall = function (tl, R) {
    var B = R.B, c = B.cue, rnd = R.rnd;
    R.plate.setAttribute("data-inv", "0");
    var rows = make("div", "rows", R.deco);
    var words = B.items.length ? B.items : B.words.map(function (x) { return x.t; });
    var STY = ["", "o", "a", "", "c", "o", "d"];
    // Les rangées en couleur (styles c et d) : deux teintes du nuancier lisibles sur les deux fonds du mur (il
    // s'inverse sur les temps), sinon la marque, sinon l'encre ; jamais une teinte du fond (des trous dans les rangées).
    var both = function (t) { return Math.min(contrast(t, R.surf.bg), contrast(t, R.surf.ink)) >= 2.2; };
    var rowT = [];
    for (var q = 1; q <= TONES.length && rowT.length < 2; q++) if (both(tone(R.k + q)) && rowT.indexOf(tone(R.k + q)) < 0) rowT.push(tone(R.k + q));
    while (rowT.length < 2) rowT.push(rowT[0] || (both(R.surf.mk) ? R.surf.mk : R.surf.ink));
    R.plate.style.setProperty("--t2", rowT[0]);
    R.plate.style.setProperty("--t3", rowT[1]);
    var span = spanOf(R), t0 = decoStart(R);
    for (var r = 0; r < 10; r++) {
      var tr = make("div", "track disp", make("div", "row", rows));
      for (var j = 0; j < 8; j++) {
        make("span", "it " + STY[(j + r) % STY.length], tr, words[(r * 3 + j * 5) % words.length]);
        if (j % 2) icon(tr, "star", "sstar");
        else make("i", "mcv", tr).style.background = "linear-gradient(160deg," + tone(r + j) + "," + tone(r + j + 2) + ")";
      }
      var dir = r % 2 ? 1 : -1, x0 = -150 - Math.round(rnd() * 500), dist = 260 * span;
      tl.fromTo(tr, { x: dir < 0 ? x0 : x0 - dist }, { x: dir < 0 ? x0 - dist : x0, duration: span, ease: "none" }, t0);
    }
    var wbox = make("div", "wbox", R.pin);
    var blk = block(wbox, B.words, { rel: true, carry: R.carryTo, plain: true });
    blk.el.style.width = "760px";
    fitAll([{ el: blk.el, max: SZ.wall[0], min: SZ.wall[1] }], function () { return blk.el.offsetHeight <= 560 && within(blk, 760); }, B.id);
    freeze(blk);
    blk.el.style.width = Math.max(120, linesWidth(blk)) + "px";
    var ww = wbox.offsetWidth, wh = wbox.offsetHeight;
    place(wbox, 540 - ww / 2, 960 - wh / 2);
    // L'ombre dure prend une couleur de la palette distincte de la boîte (sinon boîte et ombre font une seule forme).
    var shade = [tone(R.k + 1), tone(R.k + 2), tone(R.k + 3), tone(R.k)].filter(function (t) { return contrast(t, R.surf.mk) >= 1.6; })[0] || mix(R.surf.mk, "#000000", 0.45);
    wbox.style.boxShadow = "16px 16px 0 " + shade;
    R.blk = blk;
    tl.fromTo(wbox, { scale: 0, rotation: -18 }, { scale: 1, rotation: -3, duration: 0.55, ease: "back.out(1.9)" }, c.box);
    wordsIn(tl, blk, c.words, { d: 0.5 });
    (c.inv || []).forEach(function (t, i) { tl.set(R.plate, { attr: { "data-inv": i % 2 ? "0" : "1" } }, t); });
    (c.pulse || []).forEach(function (t) { tl.fromTo(wbox, { scale: 1.07 }, { scale: 1, duration: 0.4, ease: "expo.out", immediateRender: false }, t); });
    R.exitWords = blk.ws.map(function (x) { return x.w; });
    R.rest.push(wbox);
    R.focus = { x: 540, y: 960 };
  };

  /** Appel à l'action : le logo, la marque qui gonfle et son point, la phrase, le bouton qui pulse et qu'on touche. */
  SC.cta = function (tl, R) {
    var B = R.B, c = B.cue, surf = R.surf;
    decoFloor(tl, R, 1430, 490);
    decoDust(tl, R);
    var stack = [];
    var logo = $("logo");
    var lw = null;
    if (logo && S.brand.logo) {
      lw = make("div", "clogo", R.pin);
      lw.appendChild(logo);
      stack.push({ el: lw, h: 120, gap: 44 });
    }
    var wmk = null, chars = [], dot = null;
    if (B.brand) {
      wmk = make("div", "wmk disp", R.pin);
      var m = make("span", "wm", wmk);
      Array.from(String(B.brand)).forEach(function (ch) { chars.push(make("span", "chr" + (VF ? " vf" : ""), m, ch === " " ? " " : ch)); });
      dot = make("i", "wdot", wmk);
      var ws = SZ.cta[0];
      wmk.style.fontSize = ws + "px";
      for (var g = 0; g < 20 && wmk.offsetWidth > 880 && ws > SZ.cta[1]; g++) { ws = Math.max(SZ.cta[1], Math.round(ws * 0.94)); wmk.style.fontSize = ws + "px"; }
      if (wmk.offsetWidth > 880) console.warn("texte trop long " + B.id);
      stack.push({ el: wmk, h: wmk.offsetHeight, gap: 40 });
    }
    // La phrase de l'appel à l'action se lit en grand (police des titres), sous la marque s'il y en a une.
    var box = zone(R, { x: 90, y: 0, w: 900, h: B.brand ? 330 : 620 });
    var blk = block(R.pin, B.words, { carry: R.carryTo });
    fitBlock(blk, box, B.brand ? SZ.ctaLine : SZ.ctaHead, B.id);
    stack.push({ el: blk.el, h: blk.el.offsetHeight, gap: 84, x: box.x });
    R.blk = blk;
    var btnText = B.sub || (B.label ? String(S.brand.handle || "") : "");
    var but = null, rings = [], shine = null;
    if (btnText) {
      but = make("div", "cbut", R.pin);
      make("span", "", but, btnText);
      var bi = svgEl("svg", { class: "cbi", viewBox: "0 0 24 24" }, but);
      svgEl("circle", { cx: 12, cy: 12, r: 12, fill: "currentColor" }, bi);
      svgEl("path", { d: "M7 12h9M12.5 8l4 4-4 4", fill: "none", stroke: surf.mk, "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" }, bi);
      shine = make("i", "cshine", but);
      var bs = SZ.button[0];
      for (var b = 0; b < 12 && but.offsetWidth > 860 && bs > SZ.button[1]; b++) { bs = Math.max(SZ.button[1], Math.round(bs * 0.94)); but.style.fontSize = bs + "px"; }
      // Trop long même au plus petit (une longue adresse) : le bouton passe sur deux lignes, coupées n'importe où.
      if (but.offsetWidth > 860) {
        but.classList.add("two");
        if (but.offsetHeight > 210) console.warn("texte trop long " + B.id);
      }
      var bh = Math.max(128, but.offsetHeight);
      stack.push({ el: but, h: bh, gap: 0 });
    }
    var total = stack.reduce(function (s, p, i) { return s + p.h + (i < stack.length - 1 ? p.gap : 0); }, 0);
    var y = Math.max(250, 900 - total / 2);
    stack.forEach(function (p) {
      if (p.el === lw) place(lw, 0, y);
      else if (p.x !== undefined) place(p.el, p.x, y);
      else place(p.el, 540 - p.el.offsetWidth / 2, y);
      p.y = y;
      y += p.h + p.gap;
    });
    if (but) {
      var bw = but.offsetWidth, bxx = 540 - bw / 2, byy = parseFloat(but.style.top);
      for (var k = 0; k < 3; k++) {
        var ring = make("i", "cring", R.pin);
        ring.style.cssText = "left:" + Math.round(bxx) + "px;top:" + Math.round(byy) + "px;width:" + bw + "px;height:" + bh + "px";
        rings.push(ring);
      }
      R.focus = { x: 540, y: byy + bh / 2 };
    } else R.focus = center(off(blk.el));
    R.mark = makeMark(R, blk);
    // Animation.
    if (lw) tl.fromTo(lw, { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.6, ease: "back.out(1.8)" }, Math.max(R.B.enter, c.brand - 0.1));
    if (wmk) {
      chars.forEach(function (e, i) {
        var from = { yPercent: 118 }, to = { yPercent: 0, duration: 0.75, ease: "expo.out" };
        if (VF) { from["--wg"] = VF.lo; to["--wg"] = VF.w; if (VF.wd) { from["--wd"] = VF.wdLo; to["--wd"] = VF.wd; } }
        tl.fromTo(e, from, to, c.brand + i * 0.03);
      });
      tl.fromTo(dot, { scale: 0 }, { scale: 1, duration: 0.5, ease: "back.out(3)" }, c.dot);
    }
    wordsIn(tl, blk, c.words, { d: 0.55 });
    markIn(tl, R, num(last(c.words), c.t0) + B.h);
    if (but) {
      tl.fromTo(but, { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.6, ease: "back.out(1.8)" }, c.button);
      (c.rings || []).forEach(function (t, i) {
        tl.fromTo(but, { scale: 1.07 }, { scale: 1, duration: 0.45, ease: "expo.out", immediateRender: false }, t);
        tl.fromTo(rings[i % 3], { scale: 1, opacity: 0.85 }, { scale: 1.6, opacity: 0, duration: 0.9, ease: "expo.out", immediateRender: false }, t);
      });
      [c.shine].concat(c.shines || []).filter(Number.isFinite).forEach(function (t) {
        tl.fromTo(shine, { x: -160, opacity: 1 }, { x: but.offsetWidth + 60, opacity: 1, duration: 0.6, ease: "power2.inOut", immediateRender: false }, t);
      });
      // Le doigt tape le bouton (deux fois sur une fin longue : c.taps), la dernière tape fait battre le point.
      var tapX = 540 + but.offsetWidth / 2 - (but.classList.contains("two") ? 40 : 50) - 26, tapY = parseFloat(but.style.top) + bh / 2 + 2;
      (c.taps && c.taps.length ? c.taps : [c.tap]).filter(Number.isFinite).forEach(function (t) {
        tap(tl, R.fly, tapX, tapY, t);
        tl.to(but, { scale: 0.95, duration: 0.07, ease: "power2.in" }, t - 0.04);
        tl.to(but, { scale: 1, duration: 0.5, ease: "elastic.out(1, 0.4)" }, t + 0.04);
      });
      if (dot && Number.isFinite(c.tap)) tl.fromTo(dot, { scale: 1.35 }, { scale: 1, duration: 0.4, ease: "expo.out", immediateRender: false }, c.tap + 0.5);
      R.rest.push(but);
    }
    R.exitWords = blk.ws.map(function (x) { return x.w; }).concat(chars);
    if (lw) R.rest.push(lw);
    if (dot) R.rest.push(dot);
  };

  // ─── Transitions ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** Ce qui part avec la plaque d'avant (son téléphone si sa série finit). */
  function movers(A) { return A.B.run >= 0 && A.B.runLast ? [A.plate, A.runObj.st] : [A.plate]; }
  /** Les mots sortent par le haut, le reste monte et s'efface, la marque se retire. */
  function exitSoft(tl, A, t) {
    var ws = A.exitWords.filter(function (w) { return w !== A.keep; });
    var st = ws.length > 1 ? Math.min(0.025, 0.12 / (ws.length - 1)) : 0;
    // Un mot porté reste : les mots des lignes sous lui sortent par le bas (en montant, ils le traverseraient).
    var kr = A.keep ? off(A.keep) : null;
    var down = kr ? ws.filter(function (w) { return off(w).y > kr.y + kr.h * 0.5; }) : [];
    if (down.length) {
      ws = ws.filter(function (w) { return down.indexOf(w) < 0; });
      tl.to(down.slice().reverse(), { yPercent: 125, duration: 0.28, ease: "power3.in", stagger: st }, t);
    }
    if (ws.length) tl.to(ws, { yPercent: -125, duration: 0.28, ease: "power3.in", stagger: st }, t);
    if (A.rest.length) tl.to(A.rest, { y: "-=40", autoAlpha: 0, duration: 0.28, ease: "power2.in" }, t);
    if (!A.keepMark) markOut(tl, A.mark, t, { down: !!(A.mark && A.mark.ems && A.mark.ems.some(function (w) { return down.indexOf(w) >= 0; })) });
  }
  /**
   * Avant un remplissage : la moitié des mots part en haut, l'autre en bas ; la marque reste si elle devient l'écran.
   * Chaque mot sort par le côté où il part, le plus proche du bord d'abord (le haut dans l'ordre de lecture, le bas en
   * partant du dernier mot) : un mot qui glisse ne passe jamais sur la ligne voisine, déjà en route.
   */
  function exitSplit(tl, A, t) {
    var ws = A.exitWords, half = Math.ceil(ws.length / 2);
    if (half) tl.to(ws.slice(0, half), { yPercent: -125, duration: 0.3, ease: "power3.in", stagger: 0.03 }, t);
    if (ws.length > half) tl.to(ws.slice(half).reverse(), { yPercent: 125, duration: 0.26, ease: "power3.in", stagger: 0.03 }, t + 0.12);
    if (A.rest.length) tl.to(A.rest, { autoAlpha: 0, duration: 0.25, ease: "power2.in" }, t);
    if (!A.keepMark) markOut(tl, A.mark, t);
  }
  /** Le mot commun vole de sa place d'avant à sa place nouvelle (taille comprise). */
  function carryWord(tl, A, R) {
    var c = R.B.carry;
    var aw = c && A.blk && A.blk.ws[c.from], rw = c && R.blk && R.blk.ws[c.to];
    if (!aw || !rw) return false;
    var T = R.B.S, t0 = T - 0.3;
    // Les deux mots mesurés au repos (l'entrée du mot d'avant le tient encore maigre et serré quand on construit) : le
    // mot part exactement d'où il est à l'écran.
    var sa = driftScale(A, t0), ar = scaleRect(settled([aw.w], function () { return off(aw.w); }), sa), rr = settled([rw.w], function () { return off(rw.w); });
    var s0 = (parseFloat(A.blk.el.style.fontSize) * sa) / (parseFloat(R.blk.el.style.fontSize) || 1);
    rw.wm.classList.add("open");
    gsap.set(rw.w, { transformOrigin: "0px 0px" });
    tl.fromTo(rw.w, { x: ar.x - rr.x, y: ar.y - rr.y, scale: s0 }, { x: 0, y: 0, scale: 1, duration: 0.6, ease: "expo.inOut", immediateRender: false }, t0);
    // Sa couleur passe de celle qu'il avait (emphase, posé sur une barre) à la sienne pendant le vol, jamais d'un coup.
    var hl = A.mark && A.mark.kind === "highlight" && A.mark.ems.indexOf(aw.w) >= 0;
    var ca = hl ? A.surf.onMk : getComputedStyle(aw.w).color, cr = getComputedStyle(rw.w).color;
    if (ca !== cr) {
      tl.fromTo(rw.w, { color: ca }, { color: cr, duration: 0.45, ease: "power1.inOut", immediateRender: false }, t0);
      tl.set(rw.w, { clearProps: "color" }, t0 + 0.5);
    }
    tl.set(aw.w, { autoAlpha: 0 }, t0);
    // Une ponctuation que le mot d'avant n'avait pas (« dimanche » → « dimanche, ») n'apparaît qu'à l'atterrissage.
    var ta = tailOf(aw.w).w, tr = tailOf(rw.w);
    if (tr.w > 0 && !(ta > 0)) {
      var hh = Math.round(rr.h), cut = function (x) { return "polygon(-400px " + -hh + "px, " + f1(x) + "px " + -hh + "px, " + f1(x) + "px " + 2 * hh + "px, -400px " + 2 * hh + "px)"; };
      tl.set(rw.w, { clipPath: cut(tr.x - 1) }, t0);
      tl.set(rw.w, { clipPath: "none" }, t0 + 0.55);
    }
    // Posé, le mot retrouve un masque fermé : à la sortie de la scène, il disparaîtra dans son masque comme les autres.
    tl.set(rw.wm, { overflowY: "clip" }, t0 + 0.6);
    A.keep = aw.w;
    return true;
  }
  /** L'instant où commencent les sorties douces de la scène A (mots, reste, marque, téléphone qui tombe). */
  function softExitAt(A) { return Math.max(A.B.enter + 0.2, A.B.exit - 0.05); }
  /** L'instant où ces sorties sont finies (mêmes durées que exitSoft et la chute du téléphone de bridges). */
  function softExitEnd(A, phoneFalls) {
    var tx = softExitAt(A);
    var n = A.exitWords.filter(function (w) { return w !== A.keep; }).length;
    var st = n > 1 ? Math.min(0.025, 0.12 / (n - 1)) : 0;
    var end = n ? tx + 0.28 + st * (n - 1) : tx;
    if (A.rest.length) end = Math.max(end, tx + 0.28);
    if (A.mark && !A.mark.travelled) end = Math.max(end, tx + 0.25);
    if (phoneFalls) end = Math.max(end, tx + 0.45);
    return end;
  }
  /**
   * Deux scènes du même fond (surface) : leurs décors se fondent l'un dans l'autre de t − 0,2 à t + 0,2 (sol, grille,
   * halos : jamais un saut). La nouvelle plaque se montre dès t − 0,2 (son fond, de la même couleur, plus tard),
   * l'ancienne reste jusqu'à t + 0,2 au moins.
   */
  function decoCross(tl, A, R, t) {
    R.showAt = Math.min(R.showAt !== undefined ? R.showAt : t, t - 0.2);
    R.decoAt = t - 0.2;
    A.hideAt = Math.max(A.hideAt !== undefined ? A.hideAt : t, t + 0.2);
    R.bgAt = Math.max(R.bgAt !== undefined ? R.bgAt : t, A.hideAt);
    // Le sol qui continue (decoFloor) prend la place de l'ancien d'un coup, à l'identique : le décor nouveau est là
    // tout de suite, l'ancien (sans son sol) s'efface.
    if (R.floor && R.floor.cont && A.floor) tl.set([A.floor.hz, A.floor.fl], { autoAlpha: 0 }, t - 0.2);
    else tl.fromTo(R.deco, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.inOut", immediateRender: false }, t - 0.2);
    tl.fromTo(A.deco, { opacity: 1 }, { opacity: 0, duration: 0.4, ease: "power1.inOut", immediateRender: false }, t - 0.2);
  }
  function soft(tl, A, R) {
    var B = R.B, T = B.S;
    R.showAt = Math.min(T, B.enter);
    if (B.bin.kind === "carry") {
      if (carryWord(tl, A, R)) R.showAt = Math.min(R.showAt, T - 0.3);
      else unCarry(tl, R);
    }
    if (R.travelled) R.showAt = Math.min(R.showAt, T - 0.3);
    // La scène d'avant reste là jusqu'au bout de ses sorties (sinon ses mots et son téléphone disparaissent d'un coup,
    // en pleine course) ; le fond de la nouvelle, du même fond (surface), ne vient qu'ensuite.
    var phoneFalls = A.B.run >= 0 && !B.bin.phone && !!A.runObj;
    var hide = Math.max(T, softExitEnd(A, phoneFalls) + 1 / 30);
    A.hideAt = hide;
    R.bgAt = hide;
    decoCross(tl, A, R, T);
  }
  /** Le mot porté n'a pas pu voler : il entre comme les autres. */
  function unCarry(tl, R) {
    if (!R.blk) return;
    R.blk.ws.forEach(function (x) {
      if (!x.carry || !Number.isFinite(x.at)) return;
      tl.fromTo(x.w, { yPercent: 125 }, { yPercent: 0, duration: 0.6, ease: "expo.out" }, x.at);
    });
  }
  /** Remplissage : la barre du surligné (ou le point, ou la tape du doigt) s'étend jusqu'à devenir l'écran suivant. */
  function flood(tl, A, R) {
    var T = R.B.S, t0 = T - 0.1, d = 0.55;
    var M = A.mark, from, to;
    if (M && (M.kind === "highlight" || M.kind === "dot") && !M.travelled) {
      var s = driftScale(A, t0), r = scaleRect(M.rect, s), rad = (M.radius || 0) * s;
      from = "inset(" + px(r.y) + " " + px(W - r.x - r.w) + " " + px(H - r.y - r.h) + " " + px(r.x) + " round " + px(rad) + ")";
      to = "inset(0px 0px 0px 0px round 0px)";
      A.keepMark = true;
    } else {
      var p = A.tapAt || { x: 540, y: 1500 };
      var far = Math.ceil(Math.max(Math.hypot(p.x, p.y), Math.hypot(W - p.x, p.y), Math.hypot(p.x, H - p.y), Math.hypot(W - p.x, H - p.y)));
      from = "circle(0px at " + px(p.x) + " " + px(p.y) + ")";
      to = "circle(" + far + "px at " + px(p.x) + " " + px(p.y) + ")";
    }
    gsap.set(R.plate, { clipPath: from });
    tl.fromTo(R.plate, { clipPath: from }, { clipPath: to, duration: d, ease: "expo.inOut", immediateRender: false }, t0);
    tl.set(R.plate, { clipPath: "inset(0px)" }, t0 + d);
    R.showAt = t0; R.bgAt = t0; A.hideAt = t0 + d;
  }
  /** Rideau : un bord en biais passe de droite à gauche, précédé d'une bande de couleur. */
  function wipe(tl, A, R) {
    var T = R.B.S, t0 = T - 0.25, d = 0.55;
    var from = "polygon(1720px 0px, 1800px 0px, 1800px 1920px, 1420px 1920px)";
    var to = "polygon(-40px 0px, 1800px 0px, 1800px 1920px, -340px 1920px)";
    gsap.set(R.plate, { clipPath: from });
    tl.fromTo(R.plate, { clipPath: from }, { clipPath: to, duration: d, ease: "power3.inOut", immediateRender: false }, t0);
    tl.set(R.plate, { clipPath: "inset(0px)" }, t0 + d);
    var band = make("div", "band", $("fxl"));
    var bgA = A.surf.bg, bgR = R.surf.bg;
    var cands = [R.surf.mk, A.surf.mk, R.surf.ink, A.surf.ink, ACC];
    band.style.background = cands.filter(function (x) { return contrast(x, bgA) >= 1.5 && contrast(x, bgR) >= 1.5; })[0] || R.surf.ink;
    gsap.set(band, { skewX: -8.88, x: 1430 });
    tl.set(band, { visibility: "visible" }, t0);
    tl.fromTo(band, { x: 1430 }, { x: -330, duration: d, ease: "power3.inOut", immediateRender: false }, t0);
    tl.set(band, { visibility: "hidden" }, t0 + d);
    R.showAt = t0; R.bgAt = t0; A.hideAt = t0 + d;
  }
  function speedLines(tl, t0, color) {
    var box = $("speed");
    if (!box.children.length) (S.speed || []).forEach(function (s) { make("i", "", box).style.cssText = "top:" + s.y + "px;height:" + s.hh + "px;width:" + s.w + "px"; });
    Array.prototype.forEach.call(box.children, function (e, i) {
      var s = S.speed[i], t = t0 + 0.06 + s.t;
      tl.set(e, { backgroundColor: color }, t);
      tl.fromTo(e, { x: 1150, opacity: 0.9 }, { x: -1100, opacity: 0.9, duration: s.d, ease: "none", immediateRender: false }, t);
      tl.set(e, { opacity: 0 }, t + s.d + 0.01);
    });
  }
  /** Panoramique filé : tout part à gauche avec un flou horizontal, la scène suivante arrive de droite. */
  function whip(tl, A, R) {
    var T = R.B.S, t0 = T - 0.25, d = 0.5;
    var mov = movers(A), fa = blurFilter(false), fb = blurFilter(false);
    tl.set(mov, { filter: fa.url }, t0);
    tl.set(R.plate, { filter: fb.url }, t0);
    tl.fromTo(mov, { x: 0 }, { x: -1080, duration: d, ease: WHIP, immediateRender: false }, t0);
    tl.fromTo(R.plate, { x: 1080 }, { x: 0, duration: d, ease: WHIP, immediateRender: false }, t0);
    [fa, fb].forEach(function (f) {
      tl.fromTo(f.blur, { attr: { stdDeviation: "0 0" } }, { attr: { stdDeviation: "70 0" }, duration: d / 2, ease: "power2.in", immediateRender: false }, t0);
      tl.to(f.blur, { attr: { stdDeviation: "0 0" }, duration: d / 2, ease: "power2.out" }, t0 + d / 2);
    });
    tl.set(mov, { filter: "none" }, t0 + d);
    tl.set(R.plate, { filter: "none" }, t0 + d);
    speedLines(tl, t0, R.surf.ink);
    R.showAt = t0; R.bgAt = t0; A.hideAt = t0 + d;
  }
  /** Poussée : la scène suivante monte et pousse l'autre vers le haut. */
  function push(tl, A, R) {
    var T = R.B.S, t0 = T - 0.22, d = 0.5;
    var mov = movers(A), fa = blurFilter(true), fb = blurFilter(true);
    tl.set(mov, { filter: fa.url }, t0);
    tl.set(R.plate, { filter: fb.url, boxShadow: "0px -40px 80px rgba(0,0,0,0.35)" }, t0);
    tl.fromTo(mov, { y: 0 }, { y: -576, duration: d, ease: "power4.inOut", immediateRender: false }, t0);
    tl.fromTo(R.plate, { y: 1920 }, { y: 0, duration: d, ease: "power4.inOut", immediateRender: false }, t0);
    [fa, fb].forEach(function (f) {
      tl.fromTo(f.blur, { attr: { stdDeviation: "0 0" } }, { attr: { stdDeviation: "0 40" }, duration: d / 2, ease: "power2.in", immediateRender: false }, t0);
      tl.to(f.blur, { attr: { stdDeviation: "0 0" }, duration: d / 2, ease: "power2.out" }, t0 + d / 2);
    });
    tl.set(mov, { filter: "none" }, t0 + d);
    tl.set(R.plate, { filter: "none", boxShadow: "none" }, t0 + d);
    R.showAt = t0; R.bgAt = t0; A.hideAt = t0 + d;
  }
  /** Retournement : la scène pivote sur elle-même, la suivante est au dos. */
  function flip(tl, A, R) {
    var T = R.B.S, mov = movers(A);
    gsap.set(mov.concat([R.plate]), { transformPerspective: 2400, transformOrigin: "540px 960px" });
    tl.to(mov, { rotationY: 90, scale: 0.88, duration: 0.25, ease: "power2.in" }, T - 0.25);
    tl.fromTo(R.plate, { rotationY: -90, scale: 0.88 }, { rotationY: 0, scale: 1, duration: 0.42, ease: "back.out(1.3)", immediateRender: false }, T);
    // Derrière les plaques de profil, le fond de la page prend les couleurs des deux scènes (jamais l'éclair de la base).
    var bg = $("bg");
    tl.set(bg, { backgroundColor: mix(A.surf.bg, R.surf.bg, 0.5) }, T - 0.25);
    tl.set(bg, { backgroundColor: SURF.base.bg }, T + 0.45);
    R.showAt = T; R.bgAt = T; A.hideAt = T;
  }
  /** Plongée : on fonce dans le point fort de la scène (sa marque, le téléphone, la carte), la suivante se pose. */
  function zoom(tl, A, R) {
    var T = R.B.S, dz = Math.min(0.42, 0.85 * R.B.g), t0 = T - dz, mov = movers(A);
    var f = scalePoint(A.focus || { x: 540, y: 960 }, driftScale(A, t0));
    tl.set(mov, { transformOrigin: f1(f.x) + "px " + f1(f.y) + "px" }, t0);
    tl.to(mov, { scale: 7, duration: dz, ease: "expo.in" }, t0);
    gsap.set(R.plate, { transformOrigin: "540px 960px" });
    tl.fromTo(R.plate, { scale: 1.35 }, { scale: 1, duration: 0.6, ease: "expo.out", immediateRender: false }, T);
    // L'éclair prend la couleur de ce dans quoi on plonge (le blanc délavait un fond sombre en gris).
    var fc = A.focusColor || (A.mark && A.mark.kind === "highlight" ? A.surf.mk : "") || (darkBg(R.surf.bg) ? R.surf.mk : "");
    flashTint(tl, T, fc ? 0.5 : 0.4, fc);
    R.showAt = T; R.bgAt = T; A.hideAt = T;
  }
  function bridges(tl, Rs) {
    Rs.forEach(function (R, k) {
      var B = R.B, T = B.S;
      if (k === 0) { R.showAt = 0; R.bgAt = 0; return; }
      var A = Rs[k - 1], kind = B.bin.kind;
      switch (kind) {
        case "flood": flood(tl, A, R); break;
        case "wipe": wipe(tl, A, R); break;
        case "whip": whip(tl, A, R); break;
        case "push": push(tl, A, R); break;
        case "flip": flip(tl, A, R); break;
        case "zoom": zoom(tl, A, R); break;
        case "none": R.showAt = T; R.bgAt = T; A.hideAt = T; decoCross(tl, A, R, T); break;
        case "cut": R.showAt = T; R.bgAt = T; A.hideAt = T; break;
        default: soft(tl, A, R); break;
      }
      var gentle = kind === "rise" || kind === "morph" || kind === "carry";
      if (gentle) exitSoft(tl, A, softExitAt(A));
      else if (kind === "none") exitSoft(tl, A, T - 0.3);
      else if (kind === "flood") exitSplit(tl, A, Math.max(A.B.enter + 0.2, A.B.exit));
      // Le téléphone de la scène d'avant s'en va (sa série finit ici).
      if (A.B.run >= 0 && !B.bin.phone && A.runObj) {
        if (gentle) tl.to(A.runObj.ph, { y: 1300, rotation: 8, duration: 0.45, ease: "power3.in" }, softExitAt(A));
        tl.set(A.runObj.st, { visibility: "hidden" }, A.hideAt);
      }
    });
  }

  // ─── Signature (sans scène de fin), grain ─────────────────────────────────────────────────────────────────────────

  function chrome(tl, Rs) {
    var lastR = Rs[Rs.length - 1];
    if (lastR.B.layout === "cta") return;
    var hd = String(S.brand.handle || "");
    var logo = $("logo");
    if (!hd && !logo) return;
    var ch = $("chrome");
    $("handle").textContent = hd;
    ch.style.fontSize = "40px";
    ch.style.color = lastR.surf.ink;
    var y = lastR.B.layout === "phone" || lastR.B.layout === "cards" ? 1716 : 1580;
    place(ch, 540 - ch.offsetWidth / 2, y);
    tl.fromTo(ch, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: "expo.out" }, lastR.B.S + 0.6);
  }
  function grain(tl) {
    var g = $("grain");
    if (!S.grain || !g) return;
    var n = Math.max(1, Math.round(S.D * S.fps));
    tl.fromTo(g, { backgroundPosition: "0px 0px" }, { backgroundPosition: (n * 137) + "px " + (n * 89) + "px", duration: S.D, ease: "steps(" + n + ")" }, 0);
  }

  // ─── Construction ──────────────────────────────────────────────────────────────────────────────────────────────────

  function stage(tl) {
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    gsap.set($("cam"), { transformOrigin: "540px 960px" });
    var Rs = S.beats.map(plateOf);
    Rs.forEach(function (R, k) {
      R.prev = k ? Rs[k - 1] : null;
      R.carryTo = R.B.bin && R.B.bin.kind === "carry" && R.B.carry ? R.B.carry.to : -1;
    });
    var runs = [];
    Rs.forEach(function (R) { if (R.B.layout === "phone" && R.B.run >= 0) (runs[R.B.run] = runs[R.B.run] || []).push(R); });
    runs.forEach(function (list) { if (list) makeRun(list); });
    // Chaque scène : construite, mesurée, figée, puis animée (ses mesures ne dépendent d'aucune autre scène).
    Rs.forEach(function (R) { CUR = R; (SC[R.B.layout] || SC.stack)(tl, R); CUR = null; });
    runs.forEach(function (list) { if (list) runAnim(tl, list); });
    bridges(tl, Rs);
    Rs.forEach(function (R) {
      tl.set(R.plate, { visibility: "visible" }, R.showAt);
      tl.set(R.pbg, { visibility: "inherit" }, R.bgAt);
      tl.set(R.deco, { visibility: "inherit" }, R.decoAt !== undefined ? Math.min(R.decoAt, R.bgAt) : R.bgAt);
      if (R.hideAt !== undefined) tl.set(R.plate, { visibility: "hidden" }, R.hideAt);
      if (R.drift) tl.fromTo(R.pin, { scale: 1 }, { scale: R.drift.s1, duration: Math.max(0.1, R.drift.t1 - R.drift.t0), ease: R.drift.push ? "power1.in" : "none", immediateRender: false }, R.drift.t0);
    });
    if (!SAFE) {
      var cam = $("cam");
      S.beats.forEach(function (B) {
        (B.cue.punches || []).forEach(function (p) { tl.fromTo(cam, { scale: 1 + p.a }, { scale: 1, duration: 0.4, ease: "expo.out", immediateRender: false }, p.t); });
      });
    }
    chrome(tl, Rs);
    grain(tl);
  }

  function build() {
    if (built) return;
    built = true;
    var tl = gsap.timeline({ paused: true });
    try {
      var plugins = [window.CustomEase, window.DrawSVGPlugin, window.MorphSVGPlugin, window.Physics2DPlugin].filter(Boolean);
      if (plugins.length) gsap.registerPlugin.apply(gsap, plugins);
      if (window.CustomEase) { window.CustomEase.create("whip", "M0,0 C0.6,0 0.25,1 1,1"); WHIP = "whip"; }
      stage(tl);
    } catch (e) {
      console.error("moteur : " + (e && e.message ? e.message : String(e)));
    }
    tl.to({}, { duration: 0.01 }, Math.max(0, S.D - 0.01));
    window.__timelines.main = tl;
    tl.seek(0);
  }

  // Les polices d'abord (sans minuterie) : les mesures se font avec les vraies chasses.
  var loads = (S.fonts.load || []).map(function (f) { return document.fonts.load(f, "Aa Éé 0123"); });
  Promise.all(loads).then(function () { return document.fonts.ready; }).then(build, build);
})();
