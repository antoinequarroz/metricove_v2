---
name: metricove
description: Lire et remplir le calendrier éditorial Metricove d'Antoine (posts Instagram, Facebook, X, LinkedIn, YouTube). Utiliser pour voir ce qui est programmé, créer des brouillons, programmer ou déplacer un post.
version: 1.0.0
required_environment_variables:
  - name: METRICOVE_URL
    prompt: "URL de Metricove"
    help: "Par exemple https://social.antoinequarroz.ch"
    required_for: "Accès au calendrier"
  - name: METRICOVE_TOKEN
    prompt: "Jeton d'API de Metricove"
    help: "La valeur de API_TOKEN dans le .env de Metricove"
    required_for: "Accès au calendrier"
metadata:
  hermes:
    tags: [social, calendrier, publication]
---

# Metricove

Metricove est le calendrier éditorial d'Antoine. Il publie via Postiz à l'heure prévue.

## When to Use

- « Qu'est-ce qui est prévu cette semaine ? »
- « Prépare un post LinkedIn sur … pour jeudi 8h »
- « Décale le post de demain à vendredi »
- Après avoir trouvé une idée ou une tendance (par exemple avec treg), pour la mettre au calendrier.

## Procedure

Toutes les requêtes portent `Authorization: Bearer $METRICOVE_TOKEN`.

1. **Lire l'état** (comptes, vidéos, posts) :
   ```bash
   curl -s "$METRICOVE_URL/api/state" -H "Authorization: Bearer $METRICOVE_TOKEN"
   ```
   Les comptes ont un `id`, un `network` et un `handle`. Les posts ont un `status` : `draft`, `scheduled`, `publishing`, `published` ou `failed`.

2. **Créer ou modifier un post** :
   ```bash
   curl -s -X POST "$METRICOVE_URL/api/posts" -H "Authorization: Bearer $METRICOVE_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"accountIds":["<id>"],"caption":"…","scheduledAt":"2026-11-06T08:00:00+01:00","status":"draft","origin":"hermes"}'
   ```
   - Pour modifier un post, ajoute son `id`.
   - `mediaId` attache une vidéo de la bibliothèque.
   - Pour YouTube, ajoute `"youtube":{"title":"…","format":"video|short","privacy":"public"}`.

3. **Déplacer un post** : `PATCH $METRICOVE_URL/api/posts/<id>` avec `{"scheduledAt":"…"}`.
4. **Relancer un post en échec** : `POST $METRICOVE_URL/api/posts/<id>/retry`.

## Pitfalls

- **Crée des brouillons (`"status":"draft"`) par défaut.** Ne programme (`"scheduled"`) que si Antoine le demande explicitement : un post programmé part tout seul.
- Respecte les limites : X 280 caractères, Instagram 2200, LinkedIn 3000.
- Instagram et YouTube exigent une vidéo (`mediaId`).
- Les heures sont en heure de Zurich : donne toujours le décalage (`+01:00` en hiver, `+02:00` en été).
- Un post publié ne peut plus être modifié (erreur 409).

## Verification

Relis `/api/state` et confirme à Antoine le post créé : date, comptes et premiers mots du texte.
