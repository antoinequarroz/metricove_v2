# Metricove

Calendrier éditorial et publication multi-comptes (Instagram, Facebook, X, LinkedIn) pour Antoine.

## Lancer en local

```bash
pnpm install
pnpm dev
```

Puis ouvrir http://localhost:3000.

## Où en est le projet

1. **Base et design** (ce rendu) : calendrier mois / semaine / liste, glisser-déposer des posts, éditeur avec aperçu par réseau, bibliothèque vidéo, comptes, recherche ⌘K. Les données sont une démo enregistrée dans le navigateur.
2. **Publication** : base de données, connexion des comptes et publication à l'heure prévue via treg (ou Postiz auto-hébergé).
3. **Vidéos et Hermes** : import automatique des vidéos générées par Claude Code et légendes proposées par Hermes.
4. **Mise en ligne** : Docker sur le VPS, sous-domaine de antoinequarroz.ch.

## Stack

Next.js 15, Tailwind CSS 4, Base UI, cmdk, Sonner, dnd kit, zustand. Le design suit les skills d'Emil Kowalski (`.agents/skills`).
