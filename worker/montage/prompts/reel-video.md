# Savoir-faire du plateau : écrire un moment

Un moment est un visuel sur mesure, posé dans une zone fixe, qui vit pendant 1 à 3 temps forts (plus pour behind). Le moteur pose déjà le texte, la forme de marque, le décor et la caméra : le moment ajoute ce que les mots ne montrent pas (un objet, une donnée, une métaphore). Il ne répète jamais le texte et n'en contient presque pas (6 petits libellés au plus).

## Ce qui fait un bon moment

- Une seule idée visuelle, lisible en une seconde sur un téléphone : formes pleines, traits épais (12 px et plus), peu d'éléments.
- Il occupe sa zone : le visuel remplit 70 à 90 % de la largeur et de la hauteur de `zone`, comme une illustration d'affiche, jamais une vignette perdue au milieu.
- Il vit tout le temps : il entre, change d'état à chaque temps fort couvert (`beats[i].t`), respire, puis se pose. Jamais 1,5 s sans mouvement : entre deux changements d'état, une respiration lente (`sine.inOut`, `yoyo: true`, `repeat` en chiffres) garde l'image en vie.
- Il prolonge la marque : l'accent (`var(--accent)`, `pal.accent`) pour ce qui compte, `var(--ink)` pour la structure, `var(--sub)` pour le secondaire, `rgba(var(--accent-rgb),.2)` pour un fond doux.
- Calme et précis : des courbes franches, des pauses, pas de rebonds exagérés ni d'elastic.

## Procédés de continuité

- Trait qui se dessine : un `path` SVG avec `stroke="currentColor"` et `fill="none"`, couleur en CSS. État de départ `gsap.set(trait, { drawSVG: "0% 0%" })`, puis `mt.to(trait, { drawSVG: "0% 100%", duration: 0.9, ease: "expo.out" }, t)`. Sans plugin : `stroke-dasharray` et `stroke-dashoffset` animés.
- Forme qui se transforme : deux `path` dont le second est caché (`opacity="0"` ou dans `defs`), puis `mt.to(forme, { morphSVG: "#m<id>-cible", duration: 0.8, ease: "expo.inOut" }, t)`.
- Révélation par masque : un conteneur en `overflow:hidden` et un enfant qui monte de `yPercent: 150` à `0` (expo.out) ; il sort vers `yPercent: -150` au moins (power3.in), sinon un bout de jambage reste visible.
- Pointer un mot : `anchors["id-du-temps-fort"].emphasis` (ou `.title`, ou `anchors[beats[i].id]`) donne le rectangle du mot en coordonnées de ton conteneur ; `emphasis` peut manquer, teste-le. En zone above ou below, le texte est hors de ton cadre : vise le bord le plus proche à l'abscisse du mot (`a.x + a.w / 2`).
- Changer d'état avec le récit : pour chaque temps fort couvert, `beats[i].t` est son début (en secondes depuis le début du moment). Un état par temps fort : le visuel évolue, il ne se remplace pas.
- Le moment apparaît en 0,3 s (le moteur le fait) : commence ton entrée vers 0,2 s, et garde 0,3 s de calme avant D.

## Courbes et durées

- Entrée : `expo.out`, 0,5 à 0,9 s. Sortie : `power3.in`, 0,3 à 0,5 s (plus rapide que l'entrée).
- Voyage d'une place à une autre : `expo.inOut`, 0,6 à 0,9 s.
- Respiration : `sine.inOut` avec `yoyo: true` et un `repeat` écrit en chiffres (20 au plus).
- Nombre ou jauge qui monte : `power2.out`, 1 à 1,4 s.
- Décalage entre éléments : `stagger` de 0,03 à 0,08 s.

## Règles de HyperFrames (le moment est refusé sinon)

- Tout passe par `mt`, avec un instant écrit en secondes : `mt.to(cible, { … }, 1.2)`, `mt.fromTo(cible, { … }, { …, immediateRender: false }, t)`. États de départ avec `gsap.set` au début du code. Ce qui apparaît plus tard commence caché.
- Propriétés animées : `x`, `y`, `xPercent`, `yPercent`, `scale`, `scaleX`, `scaleY`, `rotation`, `opacity`, `autoAlpha`, `width`, `height`, `borderRadius`, `color`, `backgroundColor`, `strokeDashoffset`, `drawSVG`, `morphSVG`, `attr`. Jamais `left`, `top`, `right`, `bottom`, `margin…`, `padding…`, `fontSize`, `letterSpacing`, `lineHeight`.
- Dessine dans un SVG `viewBox="0 0 W H"` à la taille de la zone (`zone.w × zone.h`) : les coordonnées sont alors des px.
- Déterministe : aucun hasard, aucune date, aucune minuterie. Pour varier, un tableau de valeurs écrites à la main, lu avec le compteur de la boucle (`peaks[i]`).
- Choisir des éléments : range-les dans un tableau (`const choisis = [els[1], els[3]]`) puis parcours-le ; jamais `els[ordre[i]]` ni `const k = ordre[i]; els[k]` (refusé : l'index d'un accès calculé est un nombre ou un compteur).
- Seulement de l'ASCII dans le js, commentaires compris (aucun accent) ; pas de `el.style`, `el.textContent` ni `classList` : `gsap.set(el, { … })` et les tweens font tout.
- Fini : tout est terminé avant `D`. Ne mesure jamais le DOM : `zone` et `anchors` suffisent.
- Sélection : `root.querySelector(".x")` et `root.querySelectorAll(".x")`, ou un sélecteur texte (il ne cherche que dans ton conteneur).
- Pas plus de 300 éléments, pas de flou ni d'ombre sur de grandes surfaces.

## Exemple complet (zone below, 900 × 540, « la plupart regardent sans le son »)

html :
```html
<svg class="eq" viewBox="0 0 900 540" aria-hidden="true"><g class="bars"><rect class="bar" x="188" y="248" width="44" height="44" rx="22" fill="currentColor"/><rect class="bar" x="268" y="248" width="44" height="44" rx="22" fill="currentColor"/><rect class="bar" x="348" y="248" width="44" height="44" rx="22" fill="currentColor"/><rect class="bar" x="428" y="248" width="44" height="44" rx="22" fill="currentColor"/><rect class="bar" x="508" y="248" width="44" height="44" rx="22" fill="currentColor"/><rect class="bar" x="588" y="248" width="44" height="44" rx="22" fill="currentColor"/><rect class="bar" x="668" y="248" width="44" height="44" rx="22" fill="currentColor"/></g><line class="slash" x1="290" y1="440" x2="610" y2="100" stroke="currentColor" stroke-width="20" stroke-linecap="round" stroke-dasharray="520 600" stroke-dashoffset="540"/></svg>
```

css :
```css
svg{display:block;width:900px;height:540px}.bars{color:var(--accent)}.slash{color:var(--ink)}
```

js :
```js
const bars = root.querySelectorAll(".bar");
const slash = root.querySelector(".slash");
const peaks = [120, 210, 160, 260, 150, 230, 110];
for (let i = 0; i < bars.length; i++) {
  mt.to(bars[i], { attr: { y: 270 - peaks[i] / 2, height: peaks[i] }, duration: 0.3, ease: "sine.inOut", repeat: 3, yoyo: true }, 0.25 + i * 0.05);
}
const hush = Math.min(2.1, D * 0.5);
mt.to(bars, { opacity: 0.35, duration: 0.5, ease: "power2.out", stagger: 0.03 }, hush);
mt.to(slash, { strokeDashoffset: 0, duration: 0.7, ease: "expo.out" }, hush + 0.25);
```

Pourquoi il marche : une seule idée (le son coupé), des formes pleines aux couleurs de la marque, un premier état vivant (les barres dansent), un second qui raconte la chute (elles s'éteignent, le trait barre), aucune mesure du DOM, tout fini bien avant D.
