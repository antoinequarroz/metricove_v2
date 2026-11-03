# Brancher Hermes (et treg) sur Metricove

Le branchement va dans les deux sens :

1. **Metricove → Hermes** : le bouton « Proposer avec Hermes » de l'éditeur demande une légende à ton agent. Hermes peut utiliser treg pour vérifier les tendances et les hashtags.
2. **Hermes → Metricove** : avec le skill fourni, Hermes peut lire ton calendrier, créer des brouillons et programmer des posts.

## 1. Activer l'API de Hermes

Dans `~/.hermes/.env` sur le VPS :

```env
API_SERVER_ENABLED=true
API_SERVER_KEY=<openssl rand -hex 32>
# Écoute aussi sur le réseau Docker, pour que le conteneur Metricove puisse joindre Hermes
API_SERVER_HOST=0.0.0.0
```

Relance Hermes (`hermes gateway`). Le port par défaut est **8642**.

> ⚠️ Avec `0.0.0.0`, bloque le port 8642 depuis l'extérieur : `sudo ufw deny 8642` (seuls le VPS et ses conteneurs doivent y accéder).

Pour vérifier depuis le VPS :

```bash
curl http://127.0.0.1:8642/v1/chat/completions \
  -H "Authorization: Bearer <API_SERVER_KEY>" -H "Content-Type: application/json" \
  -d '{"model":"hermes-agent","messages":[{"role":"user","content":"Bonjour"}]}'
```

## 2. Le dire à Metricove

Dans le `.env` de Metricove :

```env
HERMES_URL=http://host.docker.internal:8642
HERMES_API_KEY=<la même clé que API_SERVER_KEY>
```

Puis `docker compose up -d` (le compose sait déjà joindre l'hôte via `host.docker.internal`). Dans la barre latérale, « Hermes · treg » passe au vert.

## 3. treg dans Hermes

Si ce n'est pas déjà fait, installe treg dans Hermes pour qu'il puisse chercher les tendances, les hashtags et les stats :

```bash
curl -fsSL https://treg.to/install.sh | sh
treg login
```

(voir https://treg.to/skill.md pour l'installer comme skill Hermes)

## 4. Le skill Metricove pour Hermes

Copie le dossier `docs/hermes-skill/metricove` dans `~/.hermes/skills/social/metricove/`, puis ajoute dans `~/.hermes/.env` :

```env
METRICOVE_URL=https://social.antoinequarroz.ch
METRICOVE_TOKEN=<API_TOKEN de Metricove>
```

Pour tester : `hermes chat --toolsets skills -q "Qu'est-ce qui est programmé cette semaine sur Metricove ?"`
