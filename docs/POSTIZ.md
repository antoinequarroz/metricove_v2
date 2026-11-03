# Publier pour de vrai avec Postiz

Metricove programme les posts. À l'heure prévue, il les confie à **Postiz**, qui publie sur X, LinkedIn, Facebook, Instagram et YouTube.

## Deux façons de faire

- **Postiz Cloud** (postiz.com, payant). C'est le plus rapide : rien à installer, et pas d'apps développeur à créer, puisque Postiz utilise les siennes. Tu connectes tes comptes, tu crées une clé API, puis tu passes directement à l'étape 4, avec `POSTIZ_URL=https://api.postiz.com/public/v1`.
- **Postiz chez toi**, sur ton propre serveur. C'est gratuit, mais il faut un serveur et tes propres apps développeur. Ça demande les 4 étapes ci-dessous.

Pour Postiz chez toi, il faut 4 étapes :

1. un serveur ;
2. Postiz ;
3. les apps développeur ;
4. le branchement de Metricove.

## 1. Le serveur

Postiz fait tourner 6 conteneurs : Postiz, deux PostgreSQL, Redis, Temporal et Elasticsearch.

- **Minimum** : 2 vCPU, **4 Go de RAM**, 20 Go de disque.
- Le VPS actuel (antoine-vps) est trop plein. Prends un petit VPS séparé, par exemple Hostinger KVM 2 ou Infomaniak VPS Lite, sous Ubuntu 24.04, avec Docker installé.
- Chez Infomaniak, crée l'enregistrement DNS **A `postiz` → IP du nouveau serveur**.

## 2. Installer Postiz

Sur le nouveau serveur :

```bash
git clone https://github.com/antoinequarroz/metricove_v2.git
cd metricove_v2/deploy/postiz
./setup.sh
```

`setup.sh` crée `.env` avec des mots de passe aléatoires, puis démarre Postiz. Au bout de 2 à 3 minutes :

1. Ouvre https://postiz.antoinequarroz.ch et **crée ton compte**.
2. Dans `.env`, passe `DISABLE_REGISTRATION=true`, puis lance `docker compose up -d`. Plus personne d'autre ne pourra créer de compte.

## 3. Les apps développeur

Chaque réseau exige une « app » à ton nom. Tu crées l'app, tu colles ses deux clés dans `deploy/postiz/.env`, puis tu lances `docker compose up -d`.

Dans chaque app, l'adresse de retour (redirect URI, callback) suit ce modèle : `https://postiz.antoinequarroz.ch/integrations/social/<réseau>`

### X (Twitter)

1. https://developer.x.com → Projects & Apps → crée une app.
2. User authentication settings :
   - App permissions : **Read and write**.
   - Type of App : **Native App**. ⚠️ Avec « Web App », la connexion échoue (erreur 32).
   - Callback URI : `https://postiz.antoinequarroz.ch/integrations/social/x`
   - Website : `https://antoinequarroz.ch`
3. Keys and tokens → Consumer Keys : copie **API Key** et **API Key Secret**.
4. Dans `.env` : `X_API_KEY=…` et `X_API_SECRET=…`

### LinkedIn (profil et page)

1. https://www.linkedin.com/developers/apps → Create app. Il faut une page LinkedIn à associer : ta page entreprise convient.
2. Onglet **Products** : ajoute
   - « Share on LinkedIn »,
   - « Sign In with LinkedIn using OpenID Connect »,
   - « Advertising API ». ⚠️ Remplis le formulaire : sans lui, la connexion expire après 2 mois.
3. Onglet **Auth** → Authorized redirect URLs : ajoute
   - `https://postiz.antoinequarroz.ch/integrations/social/linkedin`
   - `https://postiz.antoinequarroz.ch/integrations/social/linkedin-page`
4. Dans **Settings**, vérifie l'app auprès de ta page. C'est nécessaire pour publier sur la page.
5. Dans `.env` : `LINKEDIN_CLIENT_ID=…` et `LINKEDIN_CLIENT_SECRET=…`

### Facebook et Instagram (une seule app Meta)

Prérequis : une **page Facebook**, et des comptes Instagram **professionnels** (Business ou Créateur) reliés à cette page.

1. https://developers.facebook.com/apps → Create app → type **Business**.
2. Ajoute le produit **Facebook Login for Business**. Dans Valid OAuth Redirect URIs, mets :
   - `https://postiz.antoinequarroz.ch/integrations/social/facebook`
   - `https://postiz.antoinequarroz.ch/integrations/social/instagram`
3. Ajoute le produit **Instagram**, version « API setup with Facebook login ».
4. App roles → Roles : ajoute tes comptes comme testeurs. Sur Instagram, accepte ensuite l'invitation dans Paramètres → Apps et sites web.
5. Passe l'app en mode **Live** (en haut). Sinon tes posts ne sont visibles que par toi.
6. Settings → Basic : copie **App ID** et **App Secret**.
7. Dans `.env` : `FACEBOOK_APP_ID=…` et `FACEBOOK_APP_SECRET=…`

Pour ton usage personnel, la vérification d'entreprise Meta n'est pas nécessaire.

### YouTube (vidéos et Shorts)

1. https://console.cloud.google.com → crée un projet « Metricove ».
2. APIs & Services → Library : active **YouTube Data API v3**, **YouTube Analytics API** et **YouTube Reporting API**.
3. OAuth consent screen :
   - type **External** ;
   - ajoute ton adresse Gmail dans **Test users**.
4. Credentials → Create credentials → **OAuth client ID** → type **Web application** :
   - Authorized redirect URI : `https://postiz.antoinequarroz.ch/integrations/social/youtube`
5. Dans `.env` : `YOUTUBE_CLIENT_ID=…` et `YOUTUBE_CLIENT_SECRET=…`

Pour une chaîne de marque (Brand Account), la propagation peut prendre jusqu'à 5 heures.

### Ensuite

1. Lance `docker compose up -d` pour que Postiz relise `.env`.
2. Dans Postiz, ajoute chaque compte avec « Add channel ». Tu peux en connecter plusieurs par réseau.
3. Dans Postiz, va dans **Settings → Public API** et copie la clé API.

## 4. Brancher Metricove

Dans le `.env` de Metricove, sur antoine-vps (`~/metricove-v2/.env`) :

```env
PUBLISHER=postiz
POSTIZ_URL=https://postiz.antoinequarroz.ch/api/public/v1
POSTIZ_API_KEY=<clé de Settings → Public API>
```

Puis recrée le conteneur Metricove. Dans Metricove, page **Comptes**, clique sur « Synchroniser avec Postiz » : tes comptes apparaissent, et tu peux programmer.

## En cas de problème

| Symptôme | Cause probable |
|---|---|
| X : erreur 32 à la connexion | L'app X n'est pas en « Native App » |
| LinkedIn : `NotEnoughScopes` | Il manque un produit, souvent Advertising API |
| Instagram : « Insufficient developer role » | Le compte n'est pas testeur de l'app Meta |
| Post Facebook invisible pour les autres | L'app Meta est encore en mode Development |
| Metricove : « Postiz 429 » | Trop de posts en une heure : augmente `API_LIMIT` |

Sources : https://docs.postiz.com/self-host et https://docs.postiz.com/public-api.
