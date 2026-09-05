<img src="brand/radar-logo.svg" width="220" alt="RADAR">

Veille et qualification des appels d'offres publics BTP en Île-de-France.

Outil **interne**, mono-utilisateur. Il collecte les avis du BOAMP deux fois par
jour, les classe par métier, les score, les rapproche du réseau d'artisans, et
envoie un digest chaque matin. Il ne dépose aucune candidature et n'écrit jamais
à un acheteur public.

## Mise en route

1. **Créer le projet Supabase**, puis appliquer `supabase/migrations/0001_init.sql`.
2. **Remplir la table `artisans`** — prérequis n°1. Modèle : `supabase/seed_artisans.example.sql`.
   Sans réseau renseigné, le scoring plafonne et le matching ne rend rien.
3. `cp .env.example .env` et renseigner les clés.
4. `npm ci && npm test`
5. Vérifier à sec avant d'écrire quoi que ce soit :
   ```
   npm run ingest -- --dry-run --since 2026-08-05
   npm run digest -- --dry-run
   ```
6. Planifier : pousser le dépôt et renseigner les secrets du workflow
   `.github/workflows/radar.yml` (06h00 / 07h30 / 18h00, heure de Paris).

## Commandes

| Commande | Rôle |
|---|---|
| `npm run ingest` | Collecte incrémentale depuis `config.last_run_boamp` |
| `npm run ingest -- --since AAAA-MM-JJ` | Rejoue une période |
| `npm run ingest -- --dry-run` | N'écrit rien, affiche le bilan |
| `npm run digest` | Envoie le digest |
| `npm run expire` | Passe à `expire` les avis dépassés |
| `npm run capture-fixtures` | Rafraîchit les fixtures de test |
| `npm test` | Tests hors ligne sur avis réels |

## Ce que la validation de l'API a appris

Ces points ne sont pas des détails d'implémentation : ils invalident plusieurs
hypothèses naturelles sur le BOAMP.

- **`descripteur_code` n'est pas le CPV.** C'est le thésaurus interne du BOAMP ;
  le code `45` y signifie « Cd, DVD ». Le vrai CPV est enfoui dans le blob texte
  `donnees`, à un chemin qui dépend du dialecte. On ne filtre donc **jamais** le
  CPV côté serveur : on récupère toute l'Île-de-France par date (~54 avis/jour)
  et on classe en local.
- **`donnees` contient trois dialectes incompatibles**, choisis par `perimetre` :
  eForms/UBL (`DIRECTIVE-*`, ~68 %), BOAMP natif (`FNSimple`), et `MAPA`.
  Un parser par dialecte, dans `src/parsers/`.
- **Les MAPA n'ont pas de CPV** (2 % seulement). Ils sont classés par mots-clés
  et marqués `classification_source = 'mots_cles'` pour audit.
- **`code_departement` est le département de _publication_**, pas d'exécution :
  un chantier à Compiègne est publié aussi à Paris. Le département vient du lieu
  d'exécution extrait du blob ; la publication n'est qu'un repli.
- **`nature` est le vrai discriminant**, pas la date limite : 100 % des
  rectificatifs et des attributions n'ont pas de `datelimitereponse`. Filtrer sur
  la présence de la date aurait éliminé toutes les prolongations de délai.
- **Les rectificatifs se rattachent par `annonce_lie`** (l'`idweb` de l'avis
  initial) — rattachement exact, aucun rapprochement flou nécessaire.
- **`EstimatedOverallContractAmount` vaut souvent `"0.00"`** = montant non
  divulgué. Le traiter comme 0 € éliminerait l'avis à tort.
- **`EndpointID`** est le lien profond vers la consultation ; `BuyerProfileURI`
  n'est que l'accueil de la plateforme.
- **En eForms, la première organisation du blob est le prestataire de
  publication**, pas l'acheteur. L'acheteur se résout par référence `ORG-xxxx`.

TED n'est pas ingéré : les avis `DIRECTIVE-*` du BOAMP **sont** les eForms
envoyés à TED, et le `place-of-performance` de TED est inexploitable pour filtrer
l'Île-de-France.

## Limites assumées

- Les marchés sous 90 000 € HT ne sont pas tous publiés au BOAMP. Angle mort
  connu, réévalué après trois mois de données réelles.
- Le DCE n'est pas téléchargé : seul le lien est stocké.
- Aucun scraping de plateforme privée, aucune source hors Licence Ouverte.

## Garde-fous

Les fixtures de test sont des avis réels, mais `npm run capture-fixtures`
anonymise systématiquement noms, emails et téléphones des contacts acheteurs
avant écriture : ce dépôt ne republie aucune donnée personnelle.

`src/notify.ts` est le seul point d'envoi du logiciel et n'a qu'un destinataire
possible, lu dans `RADAR_DIGEST_TO`. Il ne lit jamais les colonnes `contact_*`.
Aucune fonction permettant d'écrire à un acheteur public n'existe dans le dépôt —
ne pas en ajouter.

## Critère d'arrêt

Si au bout de trois mois moins de 5 avis vraiment exploitables remontent par
mois, ou qu'aucun artisan n'a répondu à un seul appel d'offres, le problème n'est
pas le logiciel : c'est le périmètre ou l'appétence du réseau. Le développement
s'arrête et on traite la vraie cause.
