# Mettre Metricove en ligne sur le VPS

À la fin de ce guide, tu auras :

- **https://metricove.antoinequarroz.ch** : le calendrier, protégé par un mot de passe ;
- **https://postiz.antoinequarroz.ch** : Postiz, qui publie sur tes réseaux.

Il faut compter environ 45 minutes, dont la plus grande partie pour créer les applications développeur des réseaux sociaux (étape 2).

---

## 0. Prérequis

- Le VPS sous Ubuntu 22.04 ou 24.04, avec **au moins 2 Go de RAM** (c'est ce que Postiz demande).
- Docker et le plugin compose. Pour vérifier : `docker compose version`. S'il manque :
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- Les ports **80 et 443 libres**. Si un nginx ou un Traefik tourne déjà (par exemple pour Hermes), passe à l'annexe A à l'étape 3.

## 1. DNS

Chez ton registraire, crée deux enregistrements **A** qui pointent vers l'IP du VPS :

| Nom | Type | Valeur |
| --- | --- | --- |
| `metricove` | A | IP du VPS |
| `postiz` | A | IP du VPS |

Pour vérifier : `dig +short metricove.antoinequarroz.ch` doit renvoyer l'IP.

## 2. Installer Postiz et connecter les réseaux

Tout est expliqué dans [POSTIZ.md](POSTIZ.md) : Postiz Cloud ou Postiz sur ton propre serveur, avec les apps développeur réseau par réseau.

## 3. Installer Metricove

```bash
git clone https://github.com/antoinequarroz/metricove_v2 ~/metricove
cd ~/metricove
cp .env.example .env
nano .env
```

Remplis :

```env
APP_PASSWORD=<ton mot de passe>
API_TOKEN=<openssl rand -hex 32>
PUBLISHER=postiz
POSTIZ_URL=https://postiz.antoinequarroz.ch/api/public/v1
POSTIZ_API_KEY=<la clé copiée dans Postiz>
SEED_DEMO=false
```

Puis :

```bash
cd deploy
cp .env.example .env      # domaines et dossier des vidéos, à ajuster si besoin
mkdir -p /home/antoine/metricove-inbox
docker compose up -d --build
```

Caddy obtient les certificats HTTPS tout seul, en moins d'une minute.

## 4. Vérifier que tout marche

1. Ouvre https://metricove.antoinequarroz.ch et connecte-toi.
2. Va dans **Comptes**, puis clique sur **Synchroniser** : tes comptes Postiz apparaissent.
3. Crée un post de test sur X, puis clique sur **Publier maintenant**.
4. Au bout de quelques secondes, le post passe en « Publié ». S'il passe en « Échec », ouvre-le pour lire le message d'erreur.

Si la synchronisation échoue, teste l'API de Postiz directement :

```bash
curl -H "Authorization: <clé>" https://postiz.antoinequarroz.ch/api/public/v1/integrations
```

Si tu obtiens une 404, essaie sans `/api` (`https://postiz.antoinequarroz.ch/public/v1/integrations`), puis corrige `POSTIZ_URL`.

## Mettre à jour

```bash
cd ~/metricove && git pull && cd deploy && docker compose up -d --build
```

## Sauvegarder

Toutes les données (base et vidéos) sont dans le volume `deploy_metricove-data` :

```bash
docker run --rm -v deploy_metricove-data:/d -v "$PWD":/b alpine tar czf /b/metricove-$(date +%F).tgz -C /d .
```

## Logs

```bash
cd ~/metricove/deploy
docker compose logs -f metricove   # le planificateur écrit « [scheduler] … » à chaque publication
```

---

## Annexe A : un reverse proxy tourne déjà sur le VPS

Retire le service `caddy` de `deploy/docker-compose.yml`, et publie Metricove sur l'hôte uniquement :

```yaml
  metricove:
    ports:
      - "127.0.0.1:3000:3000"
```

Exemple nginx (avec certbot pour HTTPS) :

```nginx
server {
  server_name metricove.antoinequarroz.ch;
  client_max_body_size 500m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
server {
  server_name postiz.antoinequarroz.ch;
  client_max_body_size 500m;
  location / {
    proxy_pass http://127.0.0.1:4007;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

Puis : `sudo certbot --nginx -d metricove.antoinequarroz.ch -d postiz.antoinequarroz.ch`.
