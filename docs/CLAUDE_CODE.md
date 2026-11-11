# Envoyer les vidéos et les photos de Claude Code vers Metricove

Il y a deux façons d'envoyer une vidéo ou une photo. Les deux la mettent dans la bibliothèque **Médias**, et peuvent aussi créer le post (en brouillon ou programmé).

Les photos marchent comme les vidéos : envoie un `.jpg` (ou un `.png`) à la place du `.mp4`. Instagram n'accepte que le JPEG, 8 Mo au plus.

## Option 1 : l'API, de n'importe où

C'est la meilleure option quand Claude Code tourne sur ton Mac :

```bash
curl -X POST https://metricove.antoinequarroz.ch/api/media \
  -H "Authorization: Bearer $METRICOVE_TOKEN" \
  -F "file=@out/teaser.mp4" \
  -F 'post={
        "title": "Teaser automatisation",
        "caption": "Nouvelle vidéo : comment j automatise mes contenus 🎬 #ia",
        "accounts": ["instagram", "@antoinequarroz", "youtube"],
        "scheduledAt": "2026-11-05T18:00:00+01:00",
        "youtube": { "format": "short" }
      }'
```

- `METRICOVE_TOKEN` est la valeur de `API_TOKEN` dans le `.env` du serveur.
- Le champ `post` est facultatif. Sans lui, la vidéo arrive seule dans la bibliothèque.

## Option 2 : le dossier surveillé, sur le VPS

Quand Claude Code rend ses vidéos directement sur le VPS (ou les y copie avec `rsync`), il suffit de les déposer dans le dossier `VIDEO_INBOX` (`/home/antoine/metricove-inbox` par défaut). Metricove les importe en 15 à 30 secondes, une fois le fichier complètement écrit.

Pour donner le texte, les comptes et la date, dépose un fichier JSON avec le même nom à côté de la vidéo :

```
metricove-inbox/
  teaser.mp4
  teaser.json   ← facultatif
```

`teaser.json` :

```json
{
  "title": "Teaser automatisation",
  "caption": "Nouvelle vidéo 🎬 #ia",
  "accounts": ["instagram", "x"],
  "scheduledAt": "2026-11-05T18:00:00+01:00"
}
```

Écris le `.json` **avant** la vidéo. Sinon, la vidéo peut être importée sans lui.

Depuis ton Mac :

```bash
rsync -av out/teaser.json out/teaser.mp4 antoine-vps:/home/antoine/metricove-inbox/
```

## Les champs du post

| Champ | Rôle |
| --- | --- |
| `title` | Titre de la vidéo dans la bibliothèque (par défaut : le nom du fichier) |
| `caption` | Texte du post |
| `accounts` | Un id de compte, un `@handle`, ou un réseau (`instagram`, `facebook`, `x`, `linkedin`, `youtube`) pour tous ses comptes |
| `scheduledAt` | Date ISO. Avec des comptes, le post est **programmé**. Sans date, il est créé en **brouillon** pour demain à 18h |
| `status` | `draft` pour forcer un brouillon, même avec une date |
| `format` | `"story"` pour une story Instagram ou Facebook (photo, ou vidéo de 60 secondes au plus). Absent : publication dans le fil (Reel pour une vidéo, post photo pour une photo) |
| `youtube` | `{ "title": "...", "format": "video" \| "short", "privacy": "public" \| "unlisted" \| "private" }` |

Un post que les réseaux refuseraient reste en **brouillon**, même avec une date : une story avec un compte TikTok, une photo pour YouTube, ou une photo trop haute pour le fil Instagram (elle doit être entre 4:5 et 1,91:1).

Si `youtube` est absent mais qu'une chaîne YouTube est choisie, Metricove choisit seul : une vidéo verticale de 3 minutes ou moins devient un Short.

## À coller dans le CLAUDE.md de ton projet vidéo

```markdown
## Publication
Quand une vidéo est finie, envoie-la à Metricove :
curl -X POST "$METRICOVE_URL/api/media" -H "Authorization: Bearer $METRICOVE_TOKEN" \
  -F "file=@<chemin>.mp4" -F 'post={"title":"…","caption":"…","accounts":["instagram","youtube"]}'
Sans date, le post est créé en brouillon : Antoine le relit dans le calendrier avant de le programmer.
```
