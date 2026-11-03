# Metricove

Calendrier éditorial et publication multi-comptes (Instagram, Facebook, X, LinkedIn) pour Antoine.

## Lancer en local

```bash
pnpm install
pnpm dev
```

Puis ouvrir http://localhost:3000.

## Configuration

Copier `.env.example` en `.env.local` et remplir :

| Variable | Rôle |
| --- | --- |
| `APP_PASSWORD` | Mot de passe de l'app. **Obligatoire en ligne**, sinon tout le monde y a accès. |
| `API_TOKEN` | Jeton pour Hermes et Claude Code (`Authorization: Bearer …` sur `/api`). |
| `PUBLISHER` | `demo` (rien n'est envoyé) ou `postiz`. |
| `POSTIZ_URL` | API publique de Postiz, par ex. `https://postiz.antoinequarroz.ch/api/public/v1`. |
| `POSTIZ_API_KEY` | Clé API de Postiz (Réglages → API). |
| `DATA_DIR` | Dossier de la base SQLite et des vidéos (`./data` par défaut). |

## Comment la publication fonctionne

1. Les posts sont enregistrés dans SQLite (`data/metricove.db`).
2. Toutes les 30 secondes, le planificateur prend les posts programmés dont l'heure est passée.
3. Pour chaque compte, il envoie le post à Postiz (`POST /posts`, type `now`), avec la vidéo envoyée avant via `/upload`.
4. Le post passe en « Publié », ou en « Échec » avec le message d'erreur. « Relancer » ne republie que les comptes en échec.

Les comptes se connectent dans Postiz (Instagram, Facebook, X, LinkedIn, YouTube), puis se synchronisent depuis la page **Comptes**.
Pour YouTube, choisir « Vidéo » ou « Short » dans l'éditeur. Un Short est une vidéo verticale de 3 minutes maximum, et le tag `#Shorts` est ajouté automatiquement.

## API (pour Hermes et Claude Code)

| Méthode | Route | Rôle |
| --- | --- | --- |
| GET | `/api/state` | Comptes, vidéos, posts |
| POST | `/api/posts` | Créer ou modifier un post |
| PATCH | `/api/posts/:id` | Changer la date |
| DELETE | `/api/posts/:id` | Supprimer |
| POST | `/api/posts/:id/retry` | Relancer un post en échec |
| POST | `/api/accounts/sync` | Importer les comptes de Postiz |

## Où en est le projet

1. ✅ **Base et design** : calendrier mois / semaine / liste, glisser-déposer, éditeur avec aperçu par réseau, bibliothèque vidéo, recherche ⌘K.
2. ✅ **Publication** : base SQLite, mot de passe, planificateur, publication via Postiz (Instagram, Facebook, X, LinkedIn, YouTube et Shorts).
3. **Vidéos et Hermes** : import automatique des vidéos générées par Claude Code, légendes proposées par Hermes (avec treg).
4. ✅ **Mise en ligne** : Docker + Caddy (HTTPS) + Postiz sur le VPS. Voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

## Stack

Next.js 15, SQLite (better-sqlite3), Tailwind CSS 4, Base UI, cmdk, Sonner, dnd kit, zustand. Le design suit les skills d'Emil Kowalski (`.agents/skills`).
