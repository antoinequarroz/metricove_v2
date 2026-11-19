// Moteur Plateau (engine 1), côté Chrome : copié tel quel dans assets/stage.js par stage.mjs. Code de confiance, relu
// dans git. Il lit window.__SCORE (données écrites par Node), pose les textes en textContent, ajuste les tailles, mesure
// une fois, puis construit UNE timeline GSAP en pause (window.__timelines.main) : décor, temps forts, liaisons, forme,
// caméra, moments enfermés (avec leur piège), signature, textes libres. Aucun hasard, aucune minuterie : chaque image
// ne dépend que du temps demandé par HyperFrames.
(function () {
  "use strict";
  // Natifs pris avant tout code de moment : même un gestionnaire qui sortirait du bac à sable ne peut plus aveugler le
  // piège (takeRecords remplacé, console.error muet, querySelectorAll détourné).
  var getter = function (o, k) { var d = o && Object.getOwnPropertyDescriptor(o, k); return d ? d.get : null; };
  var NAT = {
    apply: Reflect.apply,
    take: MutationObserver.prototype.takeRecords,
    console: console,
    error: console.error,
    qs: Element.prototype.querySelector,
    qsa: Element.prototype.querySelectorAll,
    dqsa: Document.prototype.querySelectorAll,
    attr: Element.prototype.getAttribute,
    attrNames: Element.prototype.getAttributeNames,
    contains: Node.prototype.contains,
    nodeName: getter(Node.prototype, "nodeName"),
    nodeType: getter(Node.prototype, "nodeType"),
    text: getter(Node.prototype, "textContent"),
    names: Object.getOwnPropertyNames,
    keys: Object.keys,
    proto: Object.getPrototypeOf,
    frozen: Object.isFrozen,
    objProto: Object.prototype,
    isArray: Array.isArray,
    NodeList: NodeList,
    HTMLCollection: HTMLCollection,
    WeakSet: WeakSet,
    // CSSOM (revue 2) : un moment qui réécrit un sélecteur, coupe une feuille ou insère une règle ne change aucun
    // textContent ; le piège relit donc les feuilles elles-mêmes, par leurs accesseurs natifs.
    sheets: getter(Document.prototype, "styleSheets"),
    sheetLen: getter(StyleSheetList.prototype, "length"),
    sheetItem: StyleSheetList.prototype.item,
    rules: getter(CSSStyleSheet.prototype, "cssRules"),
    ruleLen: getter(CSSRuleList.prototype, "length"),
    ruleItem: CSSRuleList.prototype.item,
    ruleText: getter(CSSRule.prototype, "cssText"),
    disabled: getter(StyleSheet.prototype, "disabled"),
    media: getter(StyleSheet.prototype, "media"),
    mediaText: getter(MediaList.prototype, "mediaText"),
    adopted: getter(Document.prototype, "adoptedStyleSheets"),
  };
  function call(fn, self, args) { return NAT.apply(fn, self, args || []); }
  /** console.error natif : HyperFrames check le compte comme bloquant, attribué par le préfixe « moment <id>: ». */
  function cerr(msg) { call(NAT.error, NAT.console, [msg]); }
  var S = window.__SCORE;
  var K = S.K;
  var pal = Object.freeze({ bg: S.pal.bg, ink: S.pal.ink, sub: S.pal.sub, accent: S.pal.accent, onAccent: S.pal.onAccent });
  window.__timelines = window.__timelines || {};
  var built = false;

  // ─── Petits outils ───────────────────────────────────────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }
  function make(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    // Masques des mots et groupes d'emphase : le débordement (mot caché sous son masque) est voulu.
    if (cls === "wm" || cls === "eg") e.setAttribute("data-layout-allow-overflow", "");
    if (text !== undefined && text !== null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  /** Rectangle d'un élément dans la scène, par la chaîne offsetParent jusqu'à #stage (sans transformation). */
  function off(e) {
    var x = 0, y = 0, n = e;
    while (n && n.id !== "stage") { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x: x, y: y, w: e.offsetWidth, h: e.offsetHeight };
  }
  function union(list) {
    var r = null;
    list.forEach(function (a) {
      if (!a || !(a.w > 0 || a.h > 0)) return;
      if (!r) { r = { x: a.x, y: a.y, w: a.w, h: a.h }; return; }
      var x1 = Math.min(r.x, a.x), y1 = Math.min(r.y, a.y);
      var x2 = Math.max(r.x + r.w, a.x + a.w), y2 = Math.max(r.y + r.h, a.y + a.h);
      r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    });
    return r;
  }
  function round(r) { return r && { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  /** Courbe d'une dimension de la forme en voyage : qui rétrécit le fait tôt, qui grandit le fait tard. */
  function sizeEase(from, to) { return to < from ? "power2.out" : to > from ? "power2.in" : "none"; }
  var SAFE = { x0: 90, x1: 990, y0: 280, y1: 1450 };

  // ─── Construction ────────────────────────────────────────────────────────────────────────────────────────────────

  function build() {
    if (built) return;
    built = true;
    var tl = gsap.timeline({ paused: true });
    try {
      var plugins = [window.CustomEase, window.DrawSVGPlugin, window.MorphSVGPlugin].filter(Boolean);
      if (plugins.length) gsap.registerPlugin.apply(gsap, plugins);
      stage(tl);
    } catch (e) {
      cerr("moteur : " + (e && e.message ? e.message : String(e)));
    }
    tl.to({}, { duration: 0.01 }, Math.max(0, S.D - 0.01));
    window.__timelines.main = tl;
    tl.seek(0);
  }

  function stage(tl) {
    var Bd = S.B;
    var A = K.ACTOR;
    var beats = S.beats.map(makeBeat);
    var byId = {};
    beats.forEach(function (B) { byId[B.b.id] = B; });

    // Signature : son texte d'abord (sa hauteur réserve le bas de la boîte du dernier temps fort).
    var chrome = $("chrome");
    var chromeH = 0;
    if (S.chrome) {
      $("handle").textContent = S.chrome.handle;
      chrome.style.fontSize = K.TYPE.sizes.handle[0] + "px";
      chromeH = chrome.offsetHeight;
    }

    // 1. Ajustement, place et mesures (une fois, sans transformation).
    beats.forEach(function (B) {
      B.box = boxOf(B, chromeH);
      fit(B);
      place(B);
      measure(B);
    });
    beats.forEach(function (B, k) { B.rect = actorRect(B, B.b.actor, k ? beats[k - 1].rect : null); });

    // 2. Décor : halos qui dérivent, quadrillage en parallaxe, grain.
    decor(tl, beats);

    // 3. États de départ des temps forts.
    beats.forEach(function (B) {
      gsap.set(B.el, { autoAlpha: 0 });
      var entering = B.b.bridge === "hook" || B.b.bridge === "morph" || B.b.bridge === "carry" || B.b.bridge === "cut";
      if (B.ws.length) gsap.set(B.ws, { yPercent: entering ? K.ENTER.fromYPercent : 0 });
      if (entering && B.second.length) gsap.set(B.second, { autoAlpha: 0, y: 36 });
      if (B.items.length) gsap.set(B.items, { autoAlpha: 0, y: 30 });
    });

    // 4. Entrées, liaisons, sorties.
    enter(tl, beats[0], "hook", 0, null);
    for (var k = 1; k < beats.length; k++) {
      var prev = beats[k - 1], cur = beats[k], T = cur.b.start, br = cur.b.bridge;
      exit(tl, prev, br, T, cur);
      enter(tl, cur, br, T, prev);
    }

    // 5. La forme.
    actor(tl, beats);

    // 6. Caméra.
    camera(tl, beats);

    // 7. Compteurs.
    beats.forEach(function (B) { if (B.b.number && B.b.number.count && B.big) count(tl, B); });

    // 8. Moments, enfermés, avec le piège.
    moments(tl, byId);

    // 9. Signature.
    if (S.chrome) signature(tl, byId[S.chrome.beat], chromeH);

    // 10. Textes libres (textLayer, inchangé ; leur texte en textContent).
    (S.texts || []).forEach(function (t) {
      var e = document.querySelector("#ft" + t.i + " .fti");
      if (e) e.textContent = t.text;
    });
    if (typeof window.__TEXTS === "function") window.__TEXTS(tl, gsap);

    function makeBeat(b) {
      var el = make("div", "beat" + (S.align === "center" ? " center" : ""), $("type"));
      el.id = "t-" + b.id;
      var B = { b: b, el: el, words: [], ws: [], big: null, second: [], items: [], parts: [] };
      if (b.number) {
        var big = make("div", "big", el);
        var bm = make("span", "wm", big);
        var bw = make("span", "w" + (b.number.em ? " em" : ""), bm, b.number.text);
        B.big = { el: big, wm: bm, w: bw };
        B.parts.push([big, "number"]);
      }
      var main = make("div", b.layout === "over" ? "over" : "main" + (b.number ? " cap" : ""), el);
      // Les mots de l'emphase restent sur une même ligne (surlignage et soulignement d'un seul tenant).
      var group = null;
      B.groups = [];
      b.words.forEach(function (tok, i) {
        if (!tok.em) group = null;
        else if (!group) { if (i) main.appendChild(document.createTextNode(" ")); group = make("span", "eg", main); B.groups.push(group); }
        var host = tok.em ? group : main;
        if (i && (!tok.em || host.childNodes.length)) host.appendChild(document.createTextNode(" "));
        var wm = make("span", "wm", host);
        var w = make("span", tok.em ? "w em" : "w", wm, tok.t);
        B.words.push({ wm: wm, w: w, em: !!tok.em });
      });
      B.main = main;
      B.parts.push([main, b.layout === "over" ? "over" : b.number ? "numberText" : b.layout === "list" ? "listTitle" : b.layout]);
      B.ws = (B.big ? [B.big.w] : []).concat(B.words.map(function (x) { return x.w; }));
      if (b.sub) {
        var sub = make("div", "sub", el, b.sub);
        B.parts.push([sub, "sub"]);
        B.second.push(sub);
        B.sub = sub;
      }
      if (b.items && b.items.length) {
        var list = make("div", "items", el);
        b.items.forEach(function (item) {
          var row = make("div", "item", list);
          make("b", "", row);
          make("span", "", row, item.join(" "));
          B.items.push(row);
        });
        B.parts.push([list, "list"]);
      }
      if (b.pill) {
        var pr = make("div", "pillrow", el);
        B.pill = make("span", "pill", pr, b.pill);
        B.parts.push([pr, "pill"]);
        B.second.push(pr);
      }
      return B;
    }

    /** Boîte du texte : cadre de la zone, rentré de 6 px (dérive) ; réduite autour de son centre pour une poussée. */
    function boxOf(B, reserve) {
      var f = B.b.box;
      var x = f.x + 6, y = f.y, w = f.w - 12, h = f.h - 18;
      if (S.chrome && S.chrome.beat === B.b.id && reserve) h -= reserve + 40;
      if (B.b.camera === "push") {
        var s = K.CAMERA.push.scale, cx = x + w / 2, cy = y + h / 2;
        w = w / s; h = h / s; x = cx - w / 2; y = cy - h / 2;
      }
      return { x: x, y: y, w: w, h: h };
    }

    /** Réduit les tailles par pas de ×fitStep jusqu'à ce que le bloc tienne (hauteur, et aucun mot plus large que la boîte). */
    function fit(B) {
      var box = B.box, el = B.el, sizes = K.TYPE.sizes;
      el.style.width = Math.floor(box.w) + "px";
      var f = 1;
      var apply = function () {
        B.parts.forEach(function (p) { var s = sizes[p[1]] || sizes.stack; p[0].style.fontSize = Math.max(s[1], Math.round(s[0] * f)) + "px"; });
      };
      var floor = function () { return B.parts.every(function (p) { var s = sizes[p[1]] || sizes.stack; return s[0] * f <= s[1]; }); };
      var fits = function () {
        if (el.offsetHeight > box.h) return false;
        for (var i = 0; i < B.ws.length; i++) if (B.ws[i].offsetWidth > box.w + 0.5) return false;
        for (var g = 0; g < B.groups.length; g++) if (B.groups[g].offsetWidth > box.w + 0.5) return false;
        if (B.big && B.big.el.offsetHeight > box.h * 0.6) return false;
        if (B.pill && B.pill.offsetWidth > box.w) return false;
        for (var j = 0; j < B.items.length; j++) if (B.items[j].scrollWidth > box.w + 0.5) return false;
        return true;
      };
      apply();
      for (var guard = 0; guard < 80 && !fits(); guard++) {
        if (floor()) { console.warn("texte trop long " + B.b.id); break; }
        f *= K.TYPE.fitStep;
        apply();
      }
    }

    /** Place le bloc dans sa boîte selon sa mise en page. */
    function place(B) {
      var box = B.box, h = B.el.offsetHeight, lay = B.b.layout, top;
      // Pile et liste : un peu au-dessus du centre optique (pas collées en haut avec 60 % de vide dessous).
      if (lay === "stack" || lay === "list") top = box.y + Math.min(Math.max(0, box.h - h), Math.max(box.h * K.TYPE.stackTop, 0.38 * (box.h - h)));
      else if (lay === "number") top = box.y + Math.max(0, (box.h - h) * 0.42);
      else top = box.y + Math.max(0, (box.h - h) / 2);
      B.el.style.left = Math.round(box.x) + "px";
      B.el.style.top = Math.round(top) + "px";
    }

    /** Les rectangles d'un temps fort : bloc, ligne 1, emphase, titre (pour les ancres des moments). */
    function measure(B) {
      var rects = B.ws.map(off);
      B.wordRects = rects;
      var first = null, line1 = [];
      if (B.big) first = off(B.big.w);
      else if (B.words.length) {
        var top0 = B.words[0].w.offsetTop;
        B.words.forEach(function (x, i) { if (Math.abs(x.w.offsetTop - top0) < 4) line1.push(rects[i]); });
        first = union(line1);
      }
      B.line1 = first;
      B.title = round(union(rects));
      var em = [], emTop = null;
      B.words.forEach(function (x, i) {
        if (!x.em) return;
        var r = rects[i + (B.big ? 1 : 0)];
        if (emTop === null) emTop = x.w.offsetTop;
        if (Math.abs(x.w.offsetTop - emTop) < 4) em.push(r);
      });
      if (!em.length && B.big && B.b.number.em) em.push(off(B.big.w));
      B.em = em.length ? round(union(em)) : null;
      // L'emphase est-elle sur la dernière ligne du texte principal ? (sinon le soulignement remonte d'un cran)
      var lastW = B.words.length ? B.words[B.words.length - 1].w : null;
      B.emLast = emTop === null || !lastW || Math.abs(lastW.offsetTop - emTop) < 4;
      B.line1Last = !B.big && (!lastW || Math.abs(lastW.offsetTop - B.words[0].w.offsetTop) < 4);
      var parts = [B.title];
      B.parts.forEach(function (p) { if (p[0] !== B.main && (!B.big || p[0] !== B.big.el)) parts.push(off(p[0])); });
      // Sous-texte, pastille et lignes de liste : leurs rectangles, pour que la forme ne passe pas dessus en voyageant.
      B.restRects = B.second.concat(B.items).map(off);
      B.block = round(union(parts)) || { x: B.box.x, y: B.box.y, w: 10, h: 10 };
      B.center = { x: B.block.x + B.block.w / 2, y: B.block.y + B.block.h / 2 };
    }

    /** Le rectangle visé par la forme pour un état. */
    function actorRect(B, state, prevRect) {
      var line = S.shape === "line";
      var blk = B.block, first = B.line1 || blk, center = S.align === "center", r;
      if (state === "rest") {
        var rw = line ? A.line.w : A.rest.size, rh = line ? A.line.h : A.rest.size;
        r = { x: center ? blk.x + blk.w / 2 - rw / 2 : blk.x, y: Math.max(200, blk.y - A.rest.above - rh), w: rw, h: rh, r: rh / 2 };
      } else if (state === "dot") {
        var dw = line ? A.line.w : A.dot.size, dh = line ? A.line.h : A.dot.size;
        var x = first.x + first.w + 32;
        if (!center && x + dw <= SAFE.x1 - 6) r = { x: x, y: first.y + first.h / 2 - dh / 2, w: dw, h: dh, r: dh / 2 };
        else {
          var y = blk.y - dh - 40;
          if (y < SAFE.y0 - 80) y = blk.y + blk.h + 40;
          r = { x: center ? blk.x + blk.w / 2 - dw / 2 : clamp(blk.x + blk.w - dw, SAFE.x0, SAFE.x1 - dw), y: y, w: dw, h: dh, r: dh / 2 };
        }
      } else if (state === "underline") {
        var u = B.em || first;
        // Sous la dernière ligne : juste sous les mots. Sur une ligne suivie d'une autre : dans la zone des jambages
        // (comme un soulignement typographique), pour ne pas toucher les capitales de la ligne du dessous.
        var low = B.em ? B.emLast : B.line1Last;
        var uy = low ? u.y + u.h + 2 : u.y + u.h - A.underline.h - 2;
        r = { x: u.x, y: uy, w: u.w, h: A.underline.h, r: A.underline.radius };
      } else if (state === "highlight") {
        var t = B.em || first;
        r = { x: t.x - A.highlight.padX, y: t.y - A.highlight.padY, w: t.w + 2 * A.highlight.padX, h: t.h + 2 * A.highlight.padY, r: A.highlight.radius };
      } else if (state === "bar") {
        r = center
          ? { x: blk.x + blk.w / 2 - 120, y: blk.y + blk.h + 36, w: 240, h: A.bar.w, r: A.bar.w / 2 }
          : { x: blk.x - 40, y: blk.y + 6, w: A.bar.w, h: Math.max(40, blk.h - 12), r: A.bar.w / 2 };
      } else {
        r = prevRect ? { x: prevRect.x, y: prevRect.y, w: prevRect.w, h: prevRect.h, r: prevRect.r } : actorRect(B, "rest", null);
      }
      r.x = Math.round(r.x); r.y = Math.round(r.y); r.w = Math.round(r.w); r.h = Math.round(r.h);
      return r;
    }

    // ─── Décor ─────────────────────────────────────────────────────────────────────────────────────────────────────

    function decor(tl, beats) {
      S.halos.forEach(function (pts, h) {
        var el = document.querySelector(".halo.h" + h);
        if (!el || !pts.length) return;
        gsap.set(el, { x: pts[0].x, y: pts[0].y, scale: pts[0].s });
        for (var i = 1; i < pts.length; i++) {
          var a = pts[i - 1], b = pts[i];
          tl.fromTo(el, { x: a.x, y: a.y, scale: a.s }, { x: b.x, y: b.y, scale: b.s, duration: Math.max(0.1, b.t - a.t), ease: "sine.inOut", immediateRender: false }, a.t);
        }
      });
      var grid = $("grid");
      if (grid) {
        // Parallaxe : le quadrillage glisse à 0,3 de la vitesse du texte pendant chaque montée, et dérive doucement.
        var cur = 0;
        gsap.set(grid, { y: 0 });
        beats.forEach(function (B, k) {
          var T = B.b.start, end = k + 1 < beats.length ? beats[k + 1].b.start : S.D;
          var to = cur - (B.b.bridge === "rise" ? K.BRIDGE.rise.distance * K.DECOR.grid.parallax : 0);
          if (B.b.bridge === "rise") {
            tl.fromTo(grid, { y: cur }, { y: to, duration: 1.2 * Bd, ease: "expo.inOut", immediateRender: false }, Math.max(0, T - 0.6 * Bd));
            cur = to;
          }
          var drift = cur - Math.min(14, 3 * (end - T));
          var from = B.b.bridge === "rise" ? T + 0.6 * Bd : T;
          if (end - from > 0.3) { tl.fromTo(grid, { y: cur }, { y: drift, duration: end - from, ease: "none", immediateRender: false }, from); cur = drift; }
        });
      }
      var grain = $("grain");
      if (grain) {
        // Le grain change de place 12 fois par seconde (comme un vrai grain), à des places fixes.
        var steps = K.DECOR.grain.steps, tile = K.DECOR.grain.tile, frames = [];
        for (var i = 0; i < steps; i++) frames.push({ x: -((i * 97) % tile), y: -((i * 61 + 37) % tile), duration: 1 / steps, ease: "steps(1)" });
        gsap.set(grain, { x: 0, y: 0 });
        tl.to(grain, { keyframes: frames, repeat: Math.max(0, Math.ceil(S.D) - 1), ease: "none" }, 0);
      }
    }

    // ─── Entrées et sorties ────────────────────────────────────────────────────────────────────────────────────────

    function enter(tl, B, kind, T, prev) {
      var ws = B.ws.slice();
      var carried = null;
      if (kind === "carry" && B.b.carry) { carried = B.words[B.b.carry.to].w; ws = ws.filter(function (w) { return w !== carried; }); }
      var n = Math.max(1, ws.length), st = S.stagger, end = T, numberAt = T;
      if (kind === "hook") {
        var s0 = n > 1 ? Math.min(st, 0.25 / (n - 1)) : 0;
        tl.set(B.el, { autoAlpha: 1 }, 0);
        if (ws.length) tl.fromTo(ws, { yPercent: K.ENTER.fromYPercent }, { yPercent: 0, duration: 0.55, ease: "expo.out", stagger: s0, immediateRender: false }, K.ENTER.hookAt);
        numberAt = K.ENTER.hookAt;
        end = K.ENTER.hookAt + s0 * (n - 1) + 0.4;
      } else if (kind === "rise") {
        // Le bloc entrant monte et apparaît pendant que le sortant finit de s'effacer (fondu croisé de 0,2 B : le cadre
        // n'est jamais vide), chacun sur son propre chemin en y (ils ne se mêlent pas).
        tl.fromTo(B.el, { y: K.BRIDGE.rise.distance }, { y: 0, duration: 0.85 * Bd + 0.3, ease: "expo.out", immediateRender: false }, T - 0.25 * Bd);
        tl.fromTo(B.el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 * Bd, ease: "power1.out", immediateRender: false }, T - 0.25 * Bd);
        numberAt = T - 0.25 * Bd;
        end = T + 0.3 * Bd;
      } else if (kind === "zoom") {
        tl.fromTo(B.el, { scale: K.BRIDGE.zoom.enterFrom, autoAlpha: 0, transformOrigin: "50% 50%" }, { scale: 1, autoAlpha: 1, duration: K.BRIDGE.zoom.enterFrac * Bd + 0.2, ease: "expo.out", immediateRender: false }, T);
        numberAt = T;
        end = T + 0.5 * Bd;
      } else if (kind === "cut") {
        var sc = n > 1 ? 0.1 / (n - 1) : 0;
        tl.set(B.el, { autoAlpha: 1 }, T);
        if (ws.length) tl.fromTo(ws, { yPercent: 55 }, { yPercent: 0, duration: K.ENTER.cutIn - 0.1, ease: "expo.out", stagger: sc, immediateRender: false }, T);
        end = T + K.ENTER.cutIn;
      } else {
        // morph et carry : les mots montent dans leurs masques pendant que la forme se pose.
        var sm = n > 1 ? Math.min(st, 0.4 / (n - 1)) : 0, at = T - 0.05 * Bd;
        tl.set(B.el, { autoAlpha: 1 }, T - 0.2 * Bd);
        if (ws.length) tl.fromTo(ws, { yPercent: K.ENTER.fromYPercent }, { yPercent: 0, duration: 0.6, ease: "expo.out", stagger: sm, immediateRender: false }, at);
        numberAt = at;
        end = at + sm * (n - 1) + 0.4;
      }
      B.numberAt = numberAt;
      var word = kind === "hook" || kind === "cut" || kind === "morph" || kind === "carry";
      if (word && B.second.length) tl.fromTo(B.second, { autoAlpha: 0, y: 36 }, { autoAlpha: 1, y: 0, duration: kind === "cut" ? 0.3 : 0.6, ease: "expo.out", stagger: 0.08, immediateRender: false }, Math.max(0, end - 0.2));
      if (B.items.length) tl.fromTo(B.items, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: kind === "cut" ? 0.3 : 0.55, ease: "expo.out", stagger: kind === "cut" ? 0.06 : 0.16, immediateRender: false }, Math.max(0, end - 0.1));
      // carry : un porteur créé par le moteur fait le chemin du mot commun (FLIP x, y, échelle).
      if (carried && prev) {
        var from = prev.words[B.b.carry.from].w, ra = off(from), rb = off(carried);
        var carrier = make("span", "carrier", $("type"), from.textContent);
        var cs = getComputedStyle(from), ct = getComputedStyle(carried);
        carrier.style.fontSize = cs.fontSize;
        var k = parseFloat(ct.fontSize) / Math.max(1, parseFloat(cs.fontSize));
        var swap = K.BRIDGE.carry.swap * Bd;
        gsap.set(carrier, { x: ra.x, y: ra.y, scale: 1, transformOrigin: "0 0", color: cs.color, autoAlpha: 0 });
        tl.set(from, { autoAlpha: 0 }, T - swap);
        tl.set(carrier, { autoAlpha: 1 }, T - swap);
        tl.fromTo(carrier, { x: ra.x, y: ra.y, scale: 1, color: cs.color }, { x: rb.x, y: rb.y, scale: k, color: ct.color, duration: 2 * swap, ease: "expo.inOut", immediateRender: false }, T - swap);
        tl.set(carried, { yPercent: 0 }, T + swap);
        tl.set(carrier, { autoAlpha: 0 }, T + swap);
      }
    }

    function exit(tl, B, kind, T, next) {
      if (kind === "rise") {
        // Le bloc sortant monte jusqu'à la frontière ; son opacité tombe à zéro juste avant (T − 0,05 B), après l'arrivée
        // du bloc entrant (T − 0,25 B).
        tl.fromTo(B.el, { y: 0 }, { y: -K.BRIDGE.rise.distance, duration: 0.6 * Bd, ease: "power3.in", immediateRender: false }, T - 0.6 * Bd);
        tl.fromTo(B.el, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.55 * Bd, ease: "power2.in", immediateRender: false }, T - 0.6 * Bd);
        return;
      }
      if (kind === "morph" || kind === "carry") {
        var ws = B.ws.slice();
        if (kind === "carry" && next.b.carry) { var keep = B.words[next.b.carry.from].w; ws = ws.filter(function (w) { return w !== keep; }); }
        var n = Math.max(1, ws.length), s = n > 1 ? Math.min(0.025, 0.15 / (n - 1)) : 0;
        var dur = Math.max(0.2, 0.6 * Bd - s * (n - 1));
        if (ws.length) tl.fromTo(ws, { yPercent: 0 }, { yPercent: K.ENTER.exitYPercent, duration: dur, ease: "power3.in", stagger: s, immediateRender: false }, T - 0.6 * Bd);
        var rest = B.second.concat(B.items);
        if (rest.length) tl.fromTo(rest, { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -30, duration: 0.5 * Bd, ease: "power3.in", immediateRender: false }, T - 0.6 * Bd);
      }
      tl.set(B.el, { autoAlpha: 0 }, T);
    }

    // ─── La forme ──────────────────────────────────────────────────────────────────────────────────────────────────

    function actor(tl, beats) {
      var el = $("actor"), core = el.firstElementChild;
      var look = function (state) { return state === "hidden" ? { scale: A.hidden.scale, opacity: A.hidden.opacity } : { scale: 1, opacity: 1 }; };
      // La forme est ancrée par son bord bas (y = bas, marginTop = -hauteur) : un surlignage qui rétrécit se replie
      // sous ses mots (il devient leur soulignement) au lieu de les barrer.
      var geo = function (r) { return { x: r.x, y: r.y + r.h, width: r.w, height: r.h, marginTop: -r.h, borderRadius: r.r }; };
      var r0 = beats[0].rect, s0 = beats[0].b.actor;
      gsap.set(el, Object.assign({ autoAlpha: 1 }, geo(r0)));
      var landed, wipe = null;
      if (s0 === "highlight" || s0 === "underline") {
        // Accroche surlignée ou soulignée : le trait balaie de gauche à droite pendant que les mots montent.
        wipe = { at: 0.35, d: 0.5 };
        gsap.set(core, { scaleX: 0, scaleY: 1, opacity: 1, transformOrigin: "0% 50%" });
        tl.fromTo(core, { scaleX: 0 }, { scaleX: 1, duration: wipe.d, ease: "expo.inOut", immediateRender: false }, wipe.at);
        tl.set(core, { transformOrigin: "50% 50%" }, 0.86);
        landed = [0.85];
      } else {
        gsap.set(core, { scale: 0, opacity: 1, transformOrigin: "50% 50%" });
        tl.fromTo(core, { scale: 0, opacity: 1 }, Object.assign({}, look(s0), { duration: 0.6, ease: "expo.out", immediateRender: false }), 0.1);
        landed = [0.7];
      }
      var trips = [];
      for (var k = 1; k < beats.length; k++) {
        var a = beats[k - 1], b = beats[k], T = b.b.start, br = b.b.bridge;
        var la = look(a.b.actor), lb = look(b.b.actor);
        if (br === "cut" || br === "zoom") {
          tl.set(el, geo(b.rect), T);
          tl.set(core, lb, T);
          landed.push(T);
        } else {
          var at = T - 0.6 * Bd;
          if (a.b.actor === "highlight") {
            // Un surlignage qui part tombe d'abord en soulignement sous ses propres mots (vite, pendant que les mots
            // repassent sur l'accent), puis voyage : jamais un pavé d'accent sur des mots couleur accent.
            var u = actorRect(a, "underline", null), d1 = 0.25 * Bd;
            fold(tl, el, a.rect, u, at, d1);
            travel(tl, el, u, b.rect, at + d1, Bd - d1);
            trips.push({ A: a, B: b, ra: u, rb: b.rect, at: at + d1, d: Bd - d1 });
          } else {
            travel(tl, el, a.rect, b.rect, at, Bd);
            trips.push({ A: a, B: b, ra: a.rect, rb: b.rect, at: at, d: Bd });
          }
          if (la.scale !== lb.scale || la.opacity !== lb.opacity) tl.fromTo(core, la, Object.assign({}, lb, { duration: Bd, ease: "expo.inOut", immediateRender: false }), at);
          landed.push(at + Bd);
        }
      }
      dips(tl, el, trips);
      /** Voyage de la forme : position en expo.inOut ; une dimension qui rétrécit le fait tôt, une qui grandit le fait
       * tard (la forme passe par un petit format au lieu d'un grand rectangle entre une barre et un soulignement). */
      function travel(tl, el, a, b, at, d) {
        var eh = sizeEase(a.h, b.h);
        tl.fromTo(el, { x: a.x, y: a.y + a.h }, { x: b.x, y: b.y + b.h, duration: d, ease: "expo.inOut", immediateRender: false }, at);
        tl.fromTo(el, { width: a.w }, { width: b.w, duration: d, ease: sizeEase(a.w, b.w), immediateRender: false }, at);
        tl.fromTo(el, { height: a.h, marginTop: -a.h }, { height: b.h, marginTop: -b.h, duration: d, ease: eh, immediateRender: false }, at);
        tl.fromTo(el, { borderRadius: a.r }, { borderRadius: b.r, duration: d, ease: "expo.inOut", immediateRender: false }, at);
      }
      /** Repli rapide d'un rectangle vers un autre, tout en expo.out (le surlignage qui devient soulignement). */
      function fold(tl, el, a, b, at, d) {
        tl.fromTo(el, { x: a.x, y: a.y + a.h, width: a.w, height: a.h, marginTop: -a.h, borderRadius: a.r }, { x: b.x, y: b.y + b.h, width: b.w, height: b.h, marginTop: -b.h, borderRadius: b.r, duration: d, ease: "expo.out", immediateRender: false }, at);
      }
      // Respiration au repos ; en surlignage, les mots de l'emphase passent sur l'accent quand la forme est posée.
      beats.forEach(function (B, k) {
        var from = landed[k] + 0.1, to = (k + 1 < beats.length ? beats[k + 1].b.start - 0.6 * Bd : S.D) - 0.05;
        if (B.b.actor === "rest") {
          var half = A.rest.period / 2, halves = Math.floor((to - from) / half);
          if (halves % 2) halves -= 1;
          if (halves >= 2) tl.fromTo(core, { scale: 1 }, { scale: A.rest.breathe, duration: half, ease: "sine.inOut", yoyo: true, repeat: halves - 1, immediateRender: false }, from);
        }
        if (B.b.actor === "highlight") {
          var em = B.words.filter(function (x) { return x.em; }).map(function (x) { return x.w; });
          if (B.big && B.b.number.em) em.push(B.big.w);
          if (em.length) {
            if (k === 0 && wipe) {
              // Balayage d'entrée : la couleur des mots change exactement sous le bord du trait. Chaque mot est peint
              // par un dégradé à arête franche (couleur sur le trait | accent), découpé au texte, dont l'arête suit le
              // bord droit du trait avec la même courbe. À la fin, le mot reprend une couleur pleine.
              var R = B.rect;
              em.forEach(function (w) {
                var r = off(w), x0 = R.x - r.x - R.w, x1 = R.x - r.x;
                gsap.set(w, { backgroundImage: "linear-gradient(90deg," + pal.onAccent + " 50%," + pal.accent + " 50%)", backgroundSize: 2 * R.w + "px 100%", backgroundRepeat: "no-repeat", backgroundPosition: x0 + "px 0px", backgroundClip: "text", WebkitBackgroundClip: "text", color: "transparent" });
                tl.fromTo(w, { backgroundPosition: x0 + "px 0px" }, { backgroundPosition: x1 + "px 0px", duration: wipe.d, ease: "expo.inOut", immediateRender: false }, wipe.at);
                tl.set(w, { backgroundImage: "none", color: pal.onAccent }, wipe.at + wipe.d + 0.01);
              });
            } else tl.set(em, { color: pal.onAccent }, Math.max(0, landed[k] - 0.15));
            // La forme repart (elle tombe sous les mots) : les mots reprennent l'accent, sinon ils sortent en blanc sur
            // fond clair. Après un cut ou un zoom, le bloc disparaît d'un coup : rien à faire.
            var nb = beats[k + 1];
            if (nb && nb.b.bridge !== "cut" && nb.b.bridge !== "zoom") {
              var back = Math.max(landed[k], nb.b.start - 0.6 * Bd);
              tl.fromTo(em, { color: pal.onAccent }, { color: pal.accent, duration: 0.1, ease: "power1.out", immediateRender: false }, back);
            }
          }
        }
      });
    }

    /**
     * La forme ne passe jamais sur des mots visibles : pour chaque voyage, on rejoue (en 60 points par seconde) le
     * rectangle de la forme et ceux des mots sortants et entrants avec les mêmes courbes que leurs tweens, et là où ils
     * se croisent, #actor s'efface en 0,07 s puis revient en 0,1 s (la forme semble passer sous le texte). Les deux
     * bouts du voyage (posés par construction contre leurs mots) ne comptent pas. Tout est calculé une fois, au
     * montage : rien ne dépend de l'instant demandé.
     */
    function dips(tl, el, trips) {
      var E = {};
      ["expo.inOut", "expo.out", "power1.out", "power2.in", "power2.out", "power3.in", "none"].forEach(function (n) { E[n] = gsap.parseEase(n); });
      var q01 = function (t, a, d) { return d > 0 ? clamp((t - a) / d, 0, 1) : t >= a ? 1 : 0; };
      var hit = function (r, list) {
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (!o || o.h <= 2 || o.w <= 0) continue;
          if (r.x < o.x + o.w + 2 && r.x + r.w > o.x - 2 && r.y < o.y + o.h + 2 && r.y + r.h > o.y - 2) return true;
        }
        return false;
      };
      var shift = function (list, dy) { return list.map(function (o) { return { x: o.x, y: o.y + dy, w: o.w, h: o.h }; }); };
      /** Les rectangles visibles du bloc sortant A (liaison `kind` vers le temps fort qui commence en T) à l'instant t. */
      var outgoing = function (A, kind, T, t) {
        var a0 = T - 0.6 * Bd;
        if (kind === "rise") {
          var op = 1 - E["power2.in"](q01(t, a0, 0.55 * Bd));
          if (op < 0.15) return [];
          return shift(A.wordRects.concat(A.restRects), -K.BRIDGE.rise.distance * E["power3.in"](q01(t, a0, 0.6 * Bd)));
        }
        // morph, carry : les mots montent dans leurs masques (on voit le haut du masque) ; le reste s'efface.
        var p = 1.5 * E["power3.in"](q01(t, a0, 0.6 * Bd));
        var out = p >= 1 ? [] : A.wordRects.map(function (o) { return { x: o.x, y: o.y, w: o.w, h: o.h * (1 - p) }; });
        var qr = q01(t, a0, 0.5 * Bd);
        if (1 - E["power3.in"](qr) > 0.2) out = out.concat(shift(A.restRects, -30 * E["power3.in"](qr)));
        return out;
      };
      /** Les rectangles visibles du bloc entrant B à l'instant t. */
      var incoming = function (B, kind, T, t) {
        if (kind === "rise") {
          var s0 = T - 0.25 * Bd;
          if (t < s0 || E["power1.out"](q01(t, s0, 0.5 * Bd)) < 0.15) return [];
          return shift(B.wordRects.concat(B.restRects), K.BRIDGE.rise.distance * (1 - E["expo.out"](q01(t, s0, 0.85 * Bd + 0.3))));
        }
        var w0 = T - 0.05 * Bd;
        if (t < w0) return [];
        var p = 1.1 * (1 - E["expo.out"](q01(t, w0, 0.6)));
        var out = p >= 1 ? [] : B.wordRects.map(function (o) { return { x: o.x, y: o.y + o.h * p, w: o.w, h: o.h * (1 - p) }; });
        var r0 = w0 + 0.2;
        if (t >= r0 && E["expo.out"](q01(t, r0, 0.6)) > 0.2) out = out.concat(B.restRects);
        return out;
      };
      var spans = [];
      trips.forEach(function (j) {
        var a = j.ra, b = j.rb, kind = j.B.b.bridge, T = j.B.b.start;
        var ew = E[sizeEase(a.w, b.w)], eh = E[sizeEase(a.h, b.h)];
        var n = Math.max(12, Math.round(j.d * 60)), run = null;
        for (var s = 0; s <= n; s++) {
          var q = s / n, t = j.at + j.d * q, on = false;
          if (q >= 0.12 && q <= 0.85) {
            var px = E["expo.inOut"](q), w = a.w + (b.w - a.w) * ew(q), h = a.h + (b.h - a.h) * eh(q);
            var bottom = a.y + a.h + (b.y + b.h - a.y - a.h) * px;
            var r = { x: a.x + (b.x - a.x) * px, y: bottom - h, w: w, h: h };
            on = hit(r, outgoing(j.A, kind, T, t)) || hit(r, incoming(j.B, kind, T, t));
          }
          if (on && !run) run = { a: t, b: t };
          else if (on) run.b = t;
          else if (run) { spans.push(run); run = null; }
        }
        if (run) spans.push(run);
      });
      // Deux croisements à moins de 0,25 s ne font qu'un (pas de clignotement), et une éclipse dure au moins 0,2 s.
      var merged = [];
      spans.forEach(function (x) {
        var last = merged[merged.length - 1];
        if (last && x.a - last.b < 0.25) last.b = Math.max(last.b, x.b);
        else merged.push({ a: x.a, b: x.b });
      });
      // Fondu de sortie de 0,11 s fini au début du croisement (quatre images, pas un saut), retour en 0,14 s.
      merged.forEach(function (x) {
        var a = Math.max(0, x.a - 0.11), b = Math.max(x.b, a + 0.2);
        tl.fromTo(el, { opacity: 1 }, { opacity: 0, duration: 0.11, ease: "power1.inOut", immediateRender: false }, a);
        tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.14, ease: "power1.out", immediateRender: false }, b);
      });
      S.dips = merged.length;
    }

    // ─── Caméra ────────────────────────────────────────────────────────────────────────────────────────────────────

    function camera(tl, beats) {
      var drift = $("drift"), cam = $("cam");
      gsap.set(drift, { y: 0, scale: 1, transformOrigin: "540px 865px" });
      gsap.set(cam, { scale: 1, transformOrigin: "540px 960px" });
      var cy = 0, cs = 1;
      beats.forEach(function (B, k) {
        var T = B.b.start, next = beats[k + 1], end = next ? next.b.start : S.D;
        var cam1 = B.b.camera;
        if (cam1 === "drift" && end - T > 0.2) {
          // Dérive continue : 18 px et 1,2 % d'un temps fort à l'autre, en alternant (bornée, jamais figée).
          var ty = cy > 0 ? K.CAMERA.drift.y / 2 : -K.CAMERA.drift.y / 2, ts = cs > 1.006 ? 1 : K.CAMERA.drift.scale;
          tl.fromTo(drift, { y: cy, scale: cs }, { y: ty, scale: ts, duration: end - T, ease: "sine.inOut", immediateRender: false }, T);
          cy = ty; cs = ts;
        }
        if (cam1 === "push") {
          var start = T + (B.b.bridge === "zoom" ? K.BRIDGE.zoom.enterFrac * Bd : 0);
          var stop = next ? next.b.start - 0.6 * Bd : S.D;
          tl.set(cam, { transformOrigin: Math.round(B.center.x) + "px " + Math.round(B.center.y) + "px" }, T);
          if (stop - start > 0.3) {
            tl.fromTo(cam, { scale: 1 }, { scale: K.CAMERA.push.scale, duration: stop - start, ease: "sine.inOut", immediateRender: false }, start);
            if (next) tl.fromTo(cam, { scale: K.CAMERA.push.scale }, { scale: 1, duration: 0.6 * Bd, ease: "power2.inOut", immediateRender: false }, stop);
          }
        }
        if (next && next.b.bridge === "zoom") {
          // Plongée : #cam s'enfonce dans l'emphase sortante, puis revient à 1 à la frontière (le texte sortant disparaît).
          var c = B.em ? { x: B.em.x + B.em.w / 2, y: B.em.y + B.em.h / 2 } : B.center;
          var z0 = next.b.start - K.BRIDGE.zoom.inFrac * Bd;
          tl.set(cam, { transformOrigin: Math.round(c.x) + "px " + Math.round(c.y) + "px" }, z0);
          tl.fromTo(cam, { scale: 1 }, { scale: K.BRIDGE.zoom.scale, duration: K.BRIDGE.zoom.inFrac * Bd, ease: "expo.in", immediateRender: false }, z0);
          tl.set(cam, { scale: 1 }, next.b.start);
        }
      });
    }

    // ─── Compteur ──────────────────────────────────────────────────────────────────────────────────────────────────

    function count(tl, B) {
      var N = B.b.number, w = B.big.w;
      var fmt;
      try { fmt = new Intl.NumberFormat(K.COUNT.locale, { minimumFractionDigits: N.decimals, maximumFractionDigits: N.decimals }); } catch { fmt = null; }
      var write = function (v) { w.textContent = v >= N.value ? N.text : N.prefix + (fmt ? fmt.format(v) : String(Math.round(v))) + N.suffix; };
      // Le nombre garde la largeur de sa valeur finale : le texte ne bouge pas pendant qu'il monte.
      w.style.minWidth = w.offsetWidth + "px";
      if (S.align === "center") w.style.textAlign = "center";
      write(0);
      var o = { v: 0 };
      var d = Math.min(K.COUNT.max, K.COUNT.frac * (B.b.end - B.b.start));
      tl.fromTo(o, { v: 0 }, { v: N.value, duration: d, ease: "power2.out", immediateRender: false, onUpdate: function () { write(o.v); } }, B.numberAt);
    }

    // ─── Moments ───────────────────────────────────────────────────────────────────────────────────────────────────

    function moments(tl, byId) {
      if (!S.moments.length) return;
      var M = window.__MOMENTS || {};
      var BAD = /^(SCRIPT|IFRAME|FRAME|FRAMESET|OBJECT|EMBED|APPLET|LINK|META|BASE|FORM|INPUT|BUTTON|TEXTAREA|SELECT|IMG|IMAGE|PICTURE|VIDEO|AUDIO|SOURCE|TRACK|CANVAS|PORTAL|TEMPLATE|SLOT|STYLE|A|USE|FOREIGNOBJECT|ANIMATE|SET|ANIMATEMOTION|ANIMATETRANSFORM|FEIMAGE|SVG:SCRIPT)$/;
      var ATTR = /^(on.*|src|srcset|href|xlink:href|srcdoc|action|formaction|poster|data|ping|background|style)$/i;
      // Le piège écoute les ajouts de nœuds et les écritures d'attributs qui chargent, exécutent ou renomment : tous
      // les gestionnaires on* que connaît ce Chrome (pris sur les prototypes), src, href…, et id (un id du moteur
      // repris par un moment le détournerait). Pas style : GSAP l'écrit à chaque image.
      var onNames = [], seen = {};
      [HTMLElement.prototype, SVGElement.prototype, Element.prototype, Document.prototype, window].forEach(function (o) {
        call(NAT.names, Object, [o]).forEach(function (k) { if (/^on[a-z]+$/.test(k) && !seen[k]) { seen[k] = 1; onNames.push(k); } });
      });
      var watch = new MutationObserver(function () {});
      watch.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "srcset", "href", "srcdoc", "action", "formaction", "poster", "data", "id"].concat(onNames) });
      var take = function () { return call(NAT.take, watch); };
      var ownerOf = function (n) {
        for (var e = n && n.nodeType === 1 ? n : n && n.parentElement; e; e = e.parentElement) if (e.classList && e.classList.contains("mframe")) return e.id.slice(2);
        return S.moments.length === 1 ? S.moments[0].id : "?";
      };
      /** Relève un élément interdit ou un attribut interdit ; renvoie true s'il a relevé quelque chose. */
      var check = function (n, who, late) {
        var name = String(call(NAT.nodeName, n)).toUpperCase(), bad = false;
        if (name === "STYLE" && call(NAT.attr, n, ["data-owner"]) === "engine") return false;
        if (BAD.test(name)) { cerr("moment " + who + ": élément interdit <" + name.toLowerCase() + ">"); bad = true; }
        var names = call(NAT.attrNames, n);
        for (var i = 0; i < names.length; i++) {
          var at = names[i];
          // style= : interdit dans le html du moment (relevé juste après innerHTML). Plus tard, GSAP l'a écrit par le
          // CSSOM sur les nœuds du moment : il ne compte plus.
          if (ATTR.test(at) && !(at.toLowerCase() === "style" && (late || call(NAT.attr, n, ["data-owner"]) === "engine"))) { cerr("moment " + who + ": attribut interdit " + at); bad = true; }
        }
        return bad;
      };
      var trip = function (who, late) {
        var recs = take(), bad = false;
        for (var k = 0; k < recs.length; k++) {
          var r = recs[k], by = who || ownerOf(r.target);
          if (r.type === "attributes") { cerr("moment " + by + ": attribut interdit " + r.attributeName); bad = true; continue; }
          for (var i = 0; i < r.addedNodes.length; i++) {
            var n = r.addedNodes[i];
            if (n.nodeType !== 1) continue;
            if (check(n, by, late)) bad = true;
            var all = call(NAT.qsa, n, ["*"]);
            for (var j = 0; j < all.length; j++) if (check(all[j], by, late)) bad = true;
          }
        }
        return bad;
      };
      var baseline = null, warned = false;
      var onSeek = function () {
        trip(null, true);
        if (baseline === null || warned || settled() === baseline) return;
        // Aucun code de moment ne tourne pendant la lecture : si cet état bouge quand même, chaque moment est désigné
        // (check les retire tous, la vidéo se rend sans eux).
        warned = true;
        S.moments.forEach(function (m) { cerr("moment " + m.id + ": la page a changé pendant la lecture (feuilles de style, éléments ou texte)"); });
      };
      window.addEventListener("hf-seek", onSeek);
      document.addEventListener("hf-seek", onSeek);
      /** L'état du moteur hors du conteneur `skip` : balises, ids, classes, styles en ligne, gestionnaires, textes du
       * moteur, feuilles de style. Un moment qui le change a touché la page hors de son cadre. */
      var stageEl = $("root");
      var fingerprint = function (skip) {
        var all = call(NAT.qsa, stageEl, ["*"]), out = "";
        for (var i = 0; i < all.length; i++) {
          var e = all[i];
          if (e === skip || call(NAT.contains, skip, [e])) continue;
          out += call(NAT.nodeName, e) + "#" + call(NAT.attr, e, ["id"]) + "." + call(NAT.attr, e, ["class"]) + "{" + call(NAT.attr, e, ["style"]) + "}";
          var names = call(NAT.attrNames, e);
          for (var j = 0; j < names.length; j++) if (/^on/i.test(names[j])) out += "!" + names[j];
        }
        ["type", "chrome", "texts"].forEach(function (id) { var x = $(id); out += "|" + (x ? call(NAT.text, x) : ""); });
        var css = call(NAT.dqsa, document, ["style,link,script,meta,base"]);
        out += "|" + css.length;
        for (var k = 0; k < css.length; k++) out += ":" + String(call(NAT.text, css[k]) || "").length;
        return out + "|" + cssom();
      };
      /** Les feuilles de style telles que Chrome les applique : coupée ou non, media, et le texte de chaque règle
       * (selectorText, insertRule, deleteRule, disabled se voient ici, pas dans les textContent). */
      var cssom = function () {
        var out = "";
        try {
          var list = call(NAT.sheets, document), n = call(NAT.sheetLen, list);
          for (var i = 0; i < n; i++) {
            var sh = call(NAT.sheetItem, list, [i]);
            out += "§" + call(NAT.disabled, sh) + "@" + call(NAT.mediaText, call(NAT.media, sh));
            try {
              var rules = call(NAT.rules, sh), m = call(NAT.ruleLen, rules);
              for (var j = 0; j < m; j++) out += "¶" + call(NAT.ruleText, call(NAT.ruleItem, rules, [j]));
            } catch { out += "¶?"; }
          }
          if (NAT.adopted) out += "|a" + call(NAT.adopted, document).length;
        } catch { out += "|cssom?"; }
        return out;
      };
      /** Ce qui ne bouge plus après le montage, relu à chaque image (hf-seek) : les feuilles de style, le nombre
       * d'éléments de la scène, et le texte de chaque cadre de moment (revue 2 : une méthode de l'élément appelée par
       * GSAP à chaque recherche ajoutait du texte, image après image). */
      var settled = function () {
        var out = cssom() + "|" + call(NAT.qsa, stageEl, ["*"]).length;
        var frames = call(NAT.dqsa, document, [".mframe"]);
        for (var i = 0; i < frames.length; i++) out += "|" + String(call(NAT.text, frames[i]) || "").length;
        return out;
      };
      /** L'environnement de la page : le piège, la console et le nombre de globaux ne bougent pas pendant un moment. */
      var envOf = function () {
        return [MutationObserver.prototype.takeRecords === NAT.take, console === NAT.console, console.error === NAT.error, call(NAT.names, Object, [window]).length].join(",");
      };

      S.moments.forEach(function (m) {
        var behind = m.zone === "behind";
        var frame = make("div", "mframe", behind ? $("behind") : $("moments"));
        frame.id = "m-" + m.id;
        frame.style.left = m.frame.x + "px";
        frame.style.top = m.frame.y + "px";
        frame.style.width = m.frame.w + "px";
        frame.style.height = m.frame.h + "px";
        var root = make("div", "mroot", frame);
        var css = document.createElement("style");
        css.setAttribute("data-owner", "engine");
        // Le css du moment s'applique à son conteneur (.mroot) et à ce qu'il contient, jamais au cadre : le cadre garde
        // sa place, son overflow:hidden et son opacité (revue 1 : transform ou margin sur #m-<id> sortait de la zone).
        css.textContent = "#m-" + m.id + " > .mroot{" + m.css + "}";
        document.head.appendChild(css);
        frame.setAttribute("data-owner", "engine");
        root.setAttribute("data-owner", "engine");
        take(); // les nœuds du moteur ne comptent pas
        var mt = gsap.timeline({ paused: true });
        var ok = true, box = null;
        try {
          var fn = M[m.id];
          if (typeof fn !== "function") throw new Error("code illisible (erreur de syntaxe)");
          root.innerHTML = m.html;
          if (trip(m.id, false)) ok = false; // le html tel quel, avant que GSAP n'écrive des style
          var zone = Object.freeze({ w: m.frame.w, h: m.frame.h });
          var list = Object.freeze(m.beats.map(function (b) { return Object.freeze({ id: b.id, t: b.t, d: b.d }); }));
          var anchors = Object.create(null);
          m.beats.forEach(function (mb) {
            var B = byId[mb.id];
            if (!B) return;
            var rel = function (r) { return Object.freeze({ x: r.x - m.frame.x, y: r.y - m.frame.y, w: r.w, h: r.h }); };
            var a = { title: rel(B.title || B.block) };
            if (B.em) a.emphasis = rel(B.em);
            anchors[mb.id] = Object.freeze(a);
          });
          Object.freeze(anchors);
          box = sandbox(root, m.id, mt);
          var before = fingerprint(root), env = envOf();
          try {
            gsap.context(function () { fn(box.mt, box.gsap, root, m.D, zone, pal, list, anchors); }, root);
          } finally {
            box.done();
          }
          if (fingerprint(root) !== before) { ok = false; cerr("moment " + m.id + ": a modifié la page hors de son cadre"); }
          if (envOf() !== env) { ok = false; cerr("moment " + m.id + ": a modifié l'environnement de la page"); }
        } catch (e) {
          ok = false;
          cerr("moment " + m.id + ": " + (e && e.message ? e.message : String(e)));
        }
        if (box) box.done();
        if (trip(m.id, true)) ok = false;
        var inRoot = call(NAT.qsa, root, ["*"]);
        for (var i = 0; i < inRoot.length; i++) if (check(inRoot[i], m.id, true)) ok = false;
        if (inRoot.length > K.MOMENT.elements) { ok = false; cerr("moment " + m.id + ": plus de " + K.MOMENT.elements + " éléments"); }
        if (!ok) { frame.style.display = "none"; return; }
        tl.add(mt.tweenFromTo(0, m.D, { immediateRender: false }), m.start);
        var top = behind ? K.ZONE_FRAMES.behind.maxOpacity : 1;
        gsap.set(frame, { autoAlpha: 0 });
        tl.fromTo(frame, { autoAlpha: 0 }, { autoAlpha: top, duration: K.MOMENT.fade, ease: "power1.out", immediateRender: false }, m.start);
        if (!m.last) tl.fromTo(frame, { autoAlpha: top }, { autoAlpha: 0, duration: K.MOMENT.fade, ease: "power1.in", immediateRender: false }, Math.max(m.start + K.MOMENT.fade, m.start + m.D - K.MOMENT.fade));
      });
      take();
      baseline = settled();
    }

    /**
     * Ce qu'un moment reçoit à la place de sa timeline et de gsap : des façades gelées, sans retour vers les objets de
     * GSAP ni vers la page (revue 2 : ni getProperty ni parseEase, qui lisaient n'importe quelle propriété de n'importe
     * quel objet). Toute entrée est relue ici, quoi qu'ait dit le filtre statique :
     * - une cible est un élément de son conteneur, une liste de ces éléments, un sélecteur texte (cherché dans le
     *   conteneur seulement) ou un petit objet à lui fait de nombres et de textes ({ v: 0 }) ; window, une règle ou une
     *   feuille CSS, un objet de GSAP sont refusés ;
     * - chaque clé est dans la liste fermée de vocab.mjs (K.KEYS) et n'est jamais le nom d'une méthode de la cible
     *   (GSAP l'appellerait avec la valeur) ;
     * - chaque valeur est un nombre, un texte court, un booléen, ou une fonction rendue par gsap.utils (pure) ;
     * - 4000 appels et 6000 tweens d'élément au plus (une RangeError retire le moment au lieu de figer chaque image) ;
     * - plus aucun appel après le montage.
     * GSAP reçoit des copies : le moment ne garde aucune prise sur ce qu'il a passé.
     */
    function sandbox(root, id, mt) {
      var U = gsap.utils, live = true, calls = 0, load = 0;
      var KEYS = K.KEYS || {};
      var setOf = function (list, lower) {
        var o = Object.create(null);
        (list || []).forEach(function (k) { o[lower ? String(k).toLowerCase() : k] = 1; });
        return o;
      };
      var TWEEN = setOf(KEYS.tween), STAGGER = setOf(KEYS.stagger), MORPH = setOf(KEYS.morph), KF = setOf(KEYS.keyframe), ATTRS = setOf(KEYS.attr, true);
      var FIELDS = setOf(KEYS.fields);
      var CAP = K.MOMENT.targetTweens || 6000;
      var pure = new NAT.WeakSet();
      var fail = function (what) { throw new Error(live ? what : "moment " + id + ": " + what); };
      var isArr = function (x) { return call(NAT.isArray, Array, [x]); };
      var keysOf = function (o) { return call(NAT.keys, Object, [o]); };
      var plain = function (o) {
        if (!o || typeof o !== "object") return false;
        var p = call(NAT.proto, Object, [o]);
        return p === NAT.objProto || p === null;
      };
      var typeOf = function (t) { try { return call(NAT.nodeType, t); } catch { return 0; } };

      // ─ Cibles ─
      /** Les cibles d'un appel, aplaties : éléments du conteneur et objets du moment. */
      var targets = function (t, out, depth) {
        if (t === null || t === undefined) return out;
        if (typeof t === "string") {
          if (t.length > 200) fail("sélecteur trop long");
          var found = U.toArray(t, root);
          for (var i = 0; i < found.length; i++) targets(found[i], out, depth + 1);
          return out;
        }
        if (typeof t !== "object") fail("cible de tween invalide");
        var nt = typeOf(t);
        if (nt === 1) {
          if (t !== root && !call(NAT.contains, root, [t])) fail("cible hors de son cadre");
          out.push(t);
          return out;
        }
        if (nt) fail("cible de tween invalide (seulement des éléments)");
        if (isArr(t) || t instanceof NAT.NodeList || t instanceof NAT.HTMLCollection) {
          if (depth > 2) fail("cible de tween invalide (listes trop imbriquées)");
          for (var j = 0; j < t.length; j++) targets(t[j], out, depth + 1);
          return out;
        }
        if (plain(t) && !call(NAT.frozen, Object, [t])) {
          var ks = keysOf(t);
          if (ks.length > 32) fail("cible de tween invalide (objet trop grand)");
          for (var k = 0; k < ks.length; k++) {
            if (ks[k] === "_gsap") continue; // le cache que GSAP pose sur la cible à son premier tween
            var v = t[ks[k]];
            if (typeof v !== "number" && typeof v !== "string" && typeof v !== "boolean") fail("cible de tween invalide (un objet du moment ne contient que des nombres et des textes)");
          }
          out.push(t);
          return out;
        }
        fail("cible de tween invalide (seulement des éléments de son cadre, un sélecteur ou un objet de nombres)");
      };
      var own = function (t) { return targets(t, [], 0); };

      // ─ Valeurs ─
      /** Une valeur au bout d'une clé : scalaire, ou fonction rendue par gsap.utils (wrap([…]), mapRange(…)). */
      var leaf = function (x, max) {
        if (typeof x === "function") {
          if (!pure.has(x)) fail("valeur de tween en fonction interdite (seulement une fonction rendue par gsap.utils)");
          return x;
        }
        return scalar(x, max);
      };
      var scalar = function (x, max) {
        if (typeof x === "number" || typeof x === "boolean" || x === null || x === undefined) return x;
        if (typeof x === "string") {
          if (x.length > (max || 200)) fail("valeur de tween trop longue");
          // GSAP tire au sort derrière "random(…)" et stagger from: "random" : deux rendus différeraient.
          if (/random|shuffle/i.test(x)) fail("aucun hasard dans un moment (ni random, ni shuffle)");
          return x;
        }
        fail("valeur de tween invalide (un nombre, un texte ou un booléen)");
      };
      var obj = function (x, what) { if (!plain(x)) fail(what + " : un objet écrit en clair"); return keysOf(x); };
      var nums = function (x, n, what) {
        if (!isArr(x) || x.length > n) fail(what + " : une liste de " + n + " nombres au plus");
        var out = [];
        for (var i = 0; i < x.length; i++) { if (typeof x[i] !== "number") fail(what + " : une liste de nombres"); out.push(x[i]); }
        return out;
      };
      /** Forme d'arrivée de morphSVG : un tracé ("M0,0 …"), ou un sélecteur ou un élément de son conteneur. */
      var shape = function (x) {
        if (typeof x === "string") {
          if (/^\s*[Mm]/.test(x)) return scalar(x, 20000);
          var e = x.length <= 200 ? call(NAT.qs, root, [x]) : null;
          if (!e) fail("morphSVG : forme introuvable dans son cadre (« " + x.slice(0, 40) + " »)");
          return own(e)[0];
        }
        var list = own(x);
        if (list.length !== 1 || typeOf(list[0]) !== 1) fail("morphSVG : une forme de son cadre");
        return list[0];
      };
      var value = function (k, x, els, inKf) {
        var i, ks, out;
        if (k === "attr") {
          ks = obj(x, "attr"); out = {};
          for (i = 0; i < ks.length; i++) {
            if (!ATTRS[ks[i].toLowerCase()]) fail("attr : « " + ks[i] + " » interdit");
            out[ks[i]] = leaf(x[ks[i]], 20000); // un tracé d (attr: { d: … }) peut être long
          }
          return out;
        }
        if (k === "stagger") {
          if (typeof x === "number") return x;
          ks = obj(x, "stagger"); out = {};
          for (i = 0; i < ks.length; i++) {
            var sk = ks[i], sv = x[sk];
            if (!STAGGER[sk]) fail("stagger : clé « " + sk + " » interdite");
            if ((sk === "grid" || sk === "from") && isArr(sv)) out[sk] = nums(sv, 2, "stagger." + sk);
            else if (sk === "ease" && typeof sv !== "string") fail("stagger.ease : un nom de courbe");
            else out[sk] = scalar(sv);
          }
          return out;
        }
        if (k === "keyframes") {
          if (inKf) fail("keyframes dans keyframes");
          if (isArr(x)) {
            if (x.length > 50) fail("keyframes : 50 étapes au plus");
            out = [];
            for (i = 0; i < x.length; i++) out.push(vars(x[i], els, true));
            return out;
          }
          ks = obj(x, "keyframes"); out = {};
          for (i = 0; i < ks.length; i++) {
            var fk = ks[i], fv = x[fk];
            if (/^\d{1,3}(\.\d{1,2})?%$/.test(fk)) out[fk] = vars(fv, els, true);
            else if (KF[fk]) { if (typeof fv !== "string") fail("keyframes." + fk + " : un nom de courbe"); out[fk] = fv; }
            else if (TWEEN[fk] && fk !== "keyframes") {
              if (isArr(fv)) {
                if (fv.length > 50) fail("keyframes : 50 valeurs au plus");
                out[fk] = [];
                for (var j = 0; j < fv.length; j++) out[fk].push(scalar(fv[j]));
              } else out[fk] = value(fk, fv, els, true);
            } else fail("keyframes : clé « " + fk + " » interdite");
          }
          return out;
        }
        if (k === "morphSVG") {
          if (typeof x === "string" || typeOf(x) === 1) return shape(x);
          ks = obj(x, "morphSVG"); out = {};
          for (i = 0; i < ks.length; i++) {
            var mk = ks[i], mv = x[mk];
            if (!MORPH[mk]) fail("morphSVG : clé « " + mk + " » interdite");
            if (mk === "shape") out[mk] = shape(mv);
            else if (mk === "shapeIndex" && isArr(mv)) out[mk] = nums(mv, 100, "morphSVG.shapeIndex");
            else out[mk] = scalar(mv);
          }
          return out;
        }
        if (k === "ease" || k === "yoyoEase") {
          if (typeof x === "string" || (k === "yoyoEase" && typeof x === "boolean")) return scalar(x);
          fail(k + " : un nom de courbe entre guillemets");
        }
        if (k === "repeat" && !(typeof x === "number" && x >= 0 && x <= 20)) fail("repeat : un nombre de 0 à 20");
        return leaf(x);
      };
      /** Un champ de compteur ({ v: 0 } → v) ne s'anime que sur les objets du moment qui l'ont déjà, jamais sur un élément. */
      var fieldOfAll = function (els, k) {
        if (!els.length) return false;
        for (var i = 0; i < els.length; i++) if (typeOf(els[i]) || !plain(els[i]) || typeof els[i][k] !== "number") return false;
        return true;
      };
      /** Les paramètres d'un tween, recopiés clé par clé. */
      var vars = function (v, els, inKf) {
        if (!plain(v)) fail("paramètres de tween invalides (un objet écrit en clair)");
        var ks = keysOf(v), out = {};
        for (var i = 0; i < ks.length; i++) {
          var k = ks[i];
          if (inKf && k === "stagger") fail("clé de tween « stagger » interdite dans keyframes");
          if (!TWEEN[k] && !(FIELDS[k] && fieldOfAll(els, k))) fail("clé de tween « " + k + " » interdite");
          for (var j = 0; j < els.length; j++) if (typeof els[j][k] === "function") fail("clé de tween « " + k + " » interdite (méthode de la cible)");
          out[k] = value(k, v[k], els, inKf);
        }
        return out;
      };
      var pos = function (p) {
        if (p === undefined || (typeof p === "number" && p === p) || (typeof p === "string" && p.length <= 40)) return p;
        fail("instant de tween invalide (un nombre de secondes ou un libellé court)");
      };
      /** Avant chaque appel : vivant, 4000 appels, 6000 tweens d'élément (cibles × étapes de keyframes). */
      var gate = function (els, v) {
        if (!live) fail("appel après le montage (aucun code de moment pendant la lecture)");
        if (++calls > K.MOMENT.tweens) throw new RangeError("trop de tweens (plus de " + K.MOMENT.tweens + " appels)");
        if (!els) return;
        var kf = v && plain(v) && v.keyframes ? (isArr(v.keyframes) ? v.keyframes.length : keysOf(v.keyframes).length) : 1;
        load += Math.max(1, els.length) * Math.max(1, kf);
        if (load > CAP) throw new RangeError("trop d'animations (plus de " + CAP + " tweens d'élément)");
      };
      var T = Object.freeze({
        to: function (t, v, p) { var els = own(t); gate(els, v); mt.to(els, vars(v, els), pos(p)); return T; },
        from: function (t, v, p) { var els = own(t); gate(els, v); mt.from(els, vars(v, els), pos(p)); return T; },
        fromTo: function (t, a, b, p) { var els = own(t); gate(els, b); mt.fromTo(els, vars(a, els), vars(b, els), pos(p)); return T; },
        set: function (t, v, p) { var els = own(t); gate(els, v); mt.set(els, vars(v, els), pos(p)); return T; },
        addLabel: function (n, p) {
          gate(null);
          if (typeof n !== "string" || n.length > 40) fail("addLabel : un nom de 40 caractères au plus");
          mt.addLabel(n, pos(p));
          return T;
        },
      });

      // ─ gsap.utils ─
      /** Argument d'une fonction de gsap.utils : nombres, textes, booléens, listes et objets de ceux-ci, ou une fonction
       * déjà rendue par gsap.utils. */
      var pureArg = function (x, depth) {
        if (x === null || x === undefined || typeof x === "number" || typeof x === "boolean") return x;
        if (typeof x === "string") { if (x.length > 200) fail("gsap.utils : texte trop long"); return x; }
        if (typeof x === "function") { if (pure.has(x)) return x; fail("gsap.utils : argument invalide"); }
        if (depth > 2 || typeof x !== "object") fail("gsap.utils : argument invalide");
        var out, i;
        if (isArr(x)) {
          if (x.length > 1000) fail("gsap.utils : liste trop longue");
          out = [];
          for (i = 0; i < x.length; i++) out.push(pureArg(x[i], depth + 1));
          return out;
        }
        if (!plain(x)) fail("gsap.utils : argument invalide (ni élément, ni objet de la page)");
        var ks = keysOf(x);
        if (ks.length > 64) fail("gsap.utils : objet trop grand");
        out = {};
        for (i = 0; i < ks.length; i++) { if (ks[i] === "_gsap") continue; out[ks[i]] = pureArg(x[ks[i]], depth + 1); }
        return out;
      };
      var util = function (name) {
        var fn = U[name];
        return function () {
          if (!live) fail("appel après le montage (aucun code de moment pendant la lecture)");
          var a = [];
          for (var i = 0; i < arguments.length; i++) a.push(pureArg(arguments[i], 0));
          var r = call(fn, U, a);
          if (typeof r === "function") pure.add(r); // mapRange(0, 1, 0, 100), wrap([…]) : pures, GSAP peut les appeler
          return r;
        };
      };
      var utils = Object.freeze({
        toArray: function (v) {
          if (!live) fail("appel après le montage (aucun code de moment pendant la lecture)");
          return own(v);
        },
        clamp: util("clamp"), mapRange: util("mapRange"), interpolate: util("interpolate"), normalize: util("normalize"), snap: util("snap"),
        wrap: util("wrap"), wrapYoyo: util("wrapYoyo"), splitColor: util("splitColor"), getUnit: util("getUnit"),
      });
      var G = Object.freeze({
        set: function (t, v) { var els = own(t); gate(els, v); gsap.set(els, vars(v, els)); },
        utils: utils,
      });
      return { mt: T, gsap: G, done: function () { live = false; } };
    }

    // ─── Signature ─────────────────────────────────────────────────────────────────────────────────────────────────

    function signature(tl, B, h) {
      if (!B) return;
      var chrome = $("chrome");
      var w = chrome.offsetWidth, x, y;
      if (S.chrome.cta) y = B.block.y + B.block.h + 44;
      else y = B.b.box.y + B.b.box.h - 18 - h;
      y = Math.min(y, SAFE.y1 - 10 - h);
      if (S.align === "center") x = 540 - w / 2;
      else x = B.box.x;
      chrome.style.left = Math.round(x) + "px";
      chrome.style.top = Math.round(y) + "px";
      gsap.set(chrome, { autoAlpha: 0, y: 24 });
      tl.fromTo(chrome, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: "expo.out", immediateRender: false }, S.chrome.at);
    }
  }

  // Les polices d'abord (sans minuterie) : les mesures se font avec les vraies chasses.
  var loads = (S.fonts.load || []).map(function (f) { return document.fonts.load(f, "Aa Éé 0123"); });
  Promise.all(loads).then(function () { return document.fonts.ready; }).then(build, build);
})();
