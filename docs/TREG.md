# Publier avec treg

[treg](https://treg.to) relaie les publications vers chaque réseau avec ses propres apps : **tu n'as aucune app développeur à créer**. Publier est gratuit sur Instagram, Facebook, LinkedIn, YouTube et TikTok. Sur X, chaque post coûte environ 0,015 $ (0,20 $ s'il contient un lien), pris sur le solde de l'équipe treg.

## Une équipe treg par jeu de comptes

treg garde **un seul compte par réseau dans chaque équipe**. Pour 6 comptes Instagram, il faut donc 6 équipes. Par exemple :

| Équipe | Comptes |
| --- | --- |
| perso | Instagram 1, TikTok 1, LinkedIn, YouTube, X 1 |
| ig2 | Instagram 2, TikTok 2, X 2 |
| ig3 | Instagram 3, TikTok 3, X 3 |
| ig4 à ig6 | Instagram 4 à 6, TikTok 4 à 6 |

Dans chaque équipe :

```bash
treg connections connect --provider instagram --capability post   # idem tiktok, youtube, facebook
treg connections connect --provider linkedin --capability write    # idem x
treg org agent-new metricove                                       # affiche le jeton une seule fois
```

⚠️ Avant de cliquer sur « Autoriser », le navigateur doit être connecté **au bon compte** : treg branche celui qui est ouvert.

## Brancher Metricove

Dans le `.env` de Metricove :

```env
PUBLISHER=treg
PUBLIC_URL=https://social.antoinequarroz.ch
TREG_TOKENS=perso:<jeton>,ig2:<jeton>,ig3:<jeton>
```

Puis recrée le conteneur. Dans **Comptes**, clique sur « Synchroniser » : Metricove lit chaque équipe et importe ses comptes.

## Ce que fait chaque réseau

| Réseau | Ce qui part | Remarque |
| --- | --- | --- |
| Instagram | Reel (vidéo et légende), post photo, carrousel (2 à 10 photos ou vidéos), story photo ou vidéo | Compte professionnel relié à une Page Facebook. Instagram télécharge le fichier depuis un lien signé de Metricove, valable 24 h. Photos en JPEG, entre 4:5 et 1,91:1 dans le fil. Story vidéo : 60 s au plus. 100 posts par 24 h. |
| Facebook | Vidéo, photo ou texte sur la Page, carrousel de photos (2 à 10), story photo ou vidéo | La Page est celle choisie dans la connexion treg. Un carrousel Facebook ne prend que des photos. La story vidéo demande un réglage de plus (voir plus bas). |
| LinkedIn | Texte et vidéo sur ton profil | Pas encore de page entreprise. |
| YouTube | Vidéo ou Short (#Shorts ajouté) | Environ 6 envois par jour (quota Google). |
| TikTok | Vidéo envoyée dans **l'app TikTok** | Tant que TikTok n'a pas validé l'app treg, la vidéo arrive dans ta boîte de réception TikTok : tu colles la légende (bouton « Copier la légende » dans Metricove) et tu publies, dans les 24 h. |
| X | Texte seul | Les vidéos ne passent pas encore par treg sur X. |

Les photos importées dans Metricove sont converties en JPEG et remises droites automatiquement.

Les vidéos sont envoyées à l'heure prévue. Instagram et TikTok demandent quelques minutes de traitement.

## Instagram : la connexion « via la Page »

Meta ne laisse pas encore l'app « Instagram Login » de treg publier. Metricove passe donc par la Page Facebook reliée au compte Instagram. Dans chaque équipe qui a un Instagram :

1. Dans l'app Instagram : Modifier le profil → Page → choisis la Page Facebook de cette équipe.
2. Connecte la méthode Page :

```bash
treg connections connect --provider instagram --capability page-tools
```

Cette connexion utilise aussi Facebook. Metricove appelle donc la Page par le nom de son outil treg (`facebook`), pour que treg ne confonde pas les deux.

## Stories vidéo sur Facebook

Facebook reçoit les vidéos de story sur un autre serveur (`rupload.facebook.com`), que treg ne connaît pas par défaut. Une commande par équipe l'ajoute, avec la clé de la Page déjà connectée :

```bash
treg connections ls          # note le numéro (secret) de la connexion Facebook
treg tool add facebook-rupload --base-url https://rupload.facebook.com --injector oauth \
  --secret-field page_access_token --bind 'secret=<numéro>,name=Authorization,format=OAuth {secret}'
```

Sans cet outil, les stories photo marchent, et une story vidéo Facebook échoue avec un message qui renvoie ici. Si tu reconnectes Facebook dans treg, le numéro change : supprime l'outil (`treg tool rm`) et recrée-le.
