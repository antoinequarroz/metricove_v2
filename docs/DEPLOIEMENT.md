# Mettre Metricove en ligne sur le VPS

À la fin de ce guide, tu auras :

- **https://social.antoinequarroz.ch** : le calendrier, protégé par un mot de passe ;
- **https://postiz.antoinequarroz.ch** : Postiz, qui publie sur tes réseaux.

Il faut compter environ 45 minutes, dont la plus grande partie pour créer les applications développeur des réseaux sociaux (étape 3).

---

## 0. Prérequis

- Le VPS sous Ubuntu 22.04 ou 24.04, avec **au moins 2 Go de RAM** (c'est ce que Postiz demande).
- Docker et le plugin compose. Pour vérifier : `docker compose version`. S'il manque :
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- Les ports **80 et 443 libres**. Si un nginx ou un Traefik tourne déjà (par exemple pour Hermes), passe à l'annexe A à l'étape 4.

## 1. DNS

Chez ton registraire, crée deux enregistrements **A** qui pointent vers l'IP du VPS :

| Nom | Type | Valeur |
| --- | --- | --- |
| `metricove` | A | IP du VPS |
| `postiz` | A | IP du VPS |

Pour vérifier : `dig +short social.antoinequarroz.ch` doit renvoyer l'IP.

## 2. Installer Postiz

```bash
git clone https://github.com/gitroomhq/postiz-docker-compose ~/postiz
cd ~/postiz
nano docker-compose.yaml
```

Dans la partie `environment` du service `postiz`, mets :

```yaml
MAIN_URL: "https://postiz.antoinequarroz.ch"
FRONTEND_URL: "https://postiz.antoinequarroz.ch"
NEXT_PUBLIC_BACKEND_URL: "https://postiz.antoinequarroz.ch/api"
JWT_SECRET: "<une longue chaîne aléatoire : openssl rand -hex 32>"
```

Vérifie que le service `postiz` publie bien son port sur **4007** (ligne `ports:`, par exemple `"4007:5000"`). Si le port est différent, adapte `deploy/Caddyfile`.

```bash
docker compose up -d
```

## 3. Connecter les réseaux dans Postiz

Postiz a besoin d'une application développeur par réseau. Chaque page de la doc Postiz explique quelles clés copier et quelle URL de redirection déclarer :

| Réseau | Doc Postiz | Où créer l'app |
| --- | --- | --- |
| X | https://docs.postiz.com/providers/x | developer.x.com |
| LinkedIn | https://docs.postiz.com/providers/linkedin | linkedin.com/developers |
| Instagram et Facebook | https://docs.postiz.com/providers/instagram et /facebook | developers.facebook.com |
| YouTube | https://docs.postiz.com/providers/youtube | console.cloud.google.com |

Ajoute les clés dans le `docker-compose.yaml` de Postiz (`X_API_KEY`, `LINKEDIN_CLIENT_ID`, `FACEBOOK_APP_ID`, `YOUTUBE_CLIENT_ID`, etc.), puis :

```bash
docker compose down && docker compose up -d
```

Une fois Metricove en ligne (étape 4), ouvre https://postiz.antoinequarroz.ch, crée ton compte et connecte chaque compte social. Plusieurs comptes Instagram ou LinkedIn par réseau, c'est possible.

Pour finir :

- **Réglages → API publique** : copie la clé API, elle servira à l'étape 4 ;
- ajoute `DISABLE_REGISTRATION: "true"` dans la config de Postiz, pour que personne d'autre ne puisse créer de compte.

## 4. Installer Metricove

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

## 5. Vérifier que tout marche

1. Ouvre https://social.antoinequarroz.ch et connecte-toi.
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
  server_name social.antoinequarroz.ch;
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

Puis : `sudo certbot --nginx -d social.antoinequarroz.ch -d postiz.antoinequarroz.ch`.
