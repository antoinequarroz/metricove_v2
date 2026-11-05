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
| Instagram | Reel (vidéo et légende) | Compte professionnel. Instagram télécharge la vidéo depuis un lien signé de Metricove, valable 24 h. 100 posts par 24 h. |
| Facebook | Vidéo ou texte sur la Page | La Page est celle choisie dans la connexion treg. |
| LinkedIn | Texte et vidéo sur ton profil | Pas encore de page entreprise. |
| YouTube | Vidéo ou Short (#Shorts ajouté) | Environ 6 envois par jour (quota Google). |
| TikTok | Vidéo envoyée dans **l'app TikTok** | Tant que TikTok n'a pas validé l'app treg, la vidéo arrive dans ta boîte de réception TikTok : tu colles la légende (bouton « Copier la légende » dans Metricove) et tu publies, dans les 24 h. |
| X | Texte seul | Les vidéos ne passent pas encore par treg sur X. |

Les vidéos sont envoyées à l'heure prévue. Instagram et TikTok demandent quelques minutes de traitement.
