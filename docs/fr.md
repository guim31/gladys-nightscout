# Nightscout

**PAS UN DISPOSITIF MÉDICAL.** Cette intégration est un confort pour la
maison : elle recopie dans Gladys ce que montre votre site Nightscout. Ne vous
en servez jamais pour décider d'un traitement ou d'une dose. Ses valeurs et
ses alertes peuvent être en retard, fausses ou manquer (réseau, téléphone,
capteur, redémarrage de Gladys…). Gardez les alarmes de votre capteur, de
votre pompe ou de votre application de suivi : ce sont elles qui font foi.

[Nightscout](https://nightscout.github.io/) est le site libre et
auto-hébergé où un capteur de glycémie en continu (Dexcom, FreeStyle Libre,
Medtronic… via xDrip+, AndroidAPS, Loop, Spike et d'autres) envoie ses
valeurs. Cette intégration lit votre site et apporte dans Gladys la glycémie
actuelle, sa tendance et l'âge de la dernière valeur, des déclencheurs de
scène pour les hypers, les hypos, les variations rapides et les données
manquantes, une action de scène pour mettre la glycémie dans un message, et un
widget de tableau de bord avec la courbe des trois dernières heures.

Lecture seule : Gladys n'écrit jamais dans Nightscout. Votre site peut tourner
à la maison ou chez un hébergeur (le badge de l'appareil indique « local » ou
« cloud »).

Testée contre un vrai Nightscout dans Docker (15.0.8, avec MongoDB), alimenté
de valeurs simulées : une chute rapide, des hypers, des hypos, des données
manquantes, avec un jeton d'accès, avec l'API_SECRET et sur un site public.
Développée sans le matériel : vos retours sont les bienvenus sur
[les issues](https://github.com/guim31/gladys-nightscout/issues).

## Ce qu'il faut

- Gladys Assistant 5.1.0 ou plus récent.
- Un site Nightscout joignable depuis Gladys (version 14 ou 15), qui reçoit
  les valeurs d'un capteur.
- Pour le lire : un jeton d'accès au rôle `readable` (recommandé), ou
  l'API_SECRET du site, ou rien si le site est public.

## Mise en route

### 1. Créer un jeton d'accès en lecture

Dans Nightscout, ouvrez le menu, **Outils d'administration**, puis **Ajouter
un sujet** : donnez-lui un nom (`gladys`) et le rôle `readable`, enregistrez.
Copiez le jeton affiché dans la liste (`gladys-0123456789abcdef`). Un jeton ne
fait que lire, contrairement à l'API_SECRET, qui permet aussi d'écrire.

### 2. Configurer l'intégration

Dans Gladys, **Intégrations → Nightscout → Configuration** :

- **Adresse de Nightscout** : l'adresse de votre site, comme dans le
  navigateur (`https://mon-site.example.org`, ou `http://192.168.1.20:1337` à
  la maison). Une adresse copiée avec `?token=…` marche aussi.
- **Jeton d'accès (recommandé)** : le jeton de l'étape 1. Vide pour un site
  public.
- **API_SECRET (sans jeton)** : seulement si vous n'avez pas de jeton. Il est
  envoyé haché, jamais écrit dans les journaux.
- **Unité de glycémie** : comme dans Nightscout (par défaut), mg/dL ou mmol/L.
- **Intervalle de rafraîchissement** : 1 minute (par défaut), 2 ou 5 minutes.
- **Une valeur est à jour pendant** : 15 minutes par défaut. Au-delà, la
  glycémie n'est plus publiée comme actuelle et aucun déclencheur de glycémie
  ne part.
- **Langue des noms** : la langue des noms de fonctionnalités et des phrases
  envoyées aux scènes.

Enregistrez, puis **Tester la connexion** : Gladys répond avec la version du
site, sa cible et la dernière glycémie.

### 3. Ajouter l'appareil

Dans l'onglet **Découverte**, ajoutez l'appareil Nightscout. Les déclencheurs,
l'action de scène et le widget marchent même sans l'ajouter.

## L'appareil

Un appareil pour le site, avec ces fonctionnalités :

| Fonctionnalité                                              | Valeur                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| Glycémie (mg/dL) ou Glycémie (mmol/L)                       | la dernière valeur à jour                                      |
| Variation sur 5 min (mg/dL) ou Variation sur 5 min (mmol/L) | l'écart avec la valeur précédente, ramené à 5 minutes          |
| Tendance (1 ↑↑, 4 →, 7 ↓↓)                                  | 1 hausse rapide … 4 stable … 7 baisse rapide, 8-9 inconnue     |
| Flèche de tendance                                          | ↑↑ ↑ ↗ → ↘ ↓ ↓↓                                                |
| Âge de la mesure                                            | minutes depuis la dernière valeur                              |
| Hors de la cible                                            | 1 quand la valeur sort de la cible du site                     |
| Batterie de l'uploader                                      | la batterie du téléphone ou de l'uploader, si le site la donne |

Les numéros de tendance sont ceux des intégrations Dexcom et LibreLinkUp : vos
scènes se lisent de la même façon. Changer d'unité ajoute une fonctionnalité
dans la nouvelle unité : mettez l'appareil à jour depuis l'onglet Découverte,
l'ancienne garde son historique.

Données de santé : aucun historique n'est gardé par défaut. Vous pouvez
l'activer fonctionnalité par fonctionnalité dans Gladys.

## Tableau de bord

Le widget **Glycémie** montre la glycémie colorée selon la cible du site (vert
dans la cible, orange bas ou haut, rouge urgent), la flèche et la variation,
l'âge de la valeur, et la courbe des trois dernières heures. Quand aucune
valeur n'est à jour, une ligne le dit. **Actualiser** relit Nightscout tout de
suite.

## Scènes

### Déclencheurs

Chaque déclencheur a un champ **Appareil** facultatif (vide : tous). Les
déclencheurs de glycémie ne partent que sur une valeur à jour, lue au rythme du
rafraîchissement choisi.

- **Glycémie basse** : sous la cible basse de Nightscout, 70 ou 80 mg/dL. Une
  fois par passage ; de nouveau après une valeur 5 mg/dL au-dessus, ou après un
  trou dans les données.
- **Glycémie très basse** : sous le bas urgent de Nightscout ou 54 mg/dL.
- **Glycémie haute** : au-dessus de la cible haute de Nightscout, de son haut
  urgent, de 180, 250 ou 300 mg/dL. Une fois par passage ; de nouveau après une
  valeur 5 mg/dL en dessous.
- **Glycémie revenue dans la cible** : retour dans la cible du site (5 mg/dL
  à l'intérieur) après une valeur en dehors.
- **Glycémie en hausse rapide** / **Glycémie en baisse rapide** : la tendance
  atteint ↑ ou ↑↑ (ou ↑↑ seulement), ↓ ou ↓↓ (ou ↓↓ seulement). Une fois,
  jusqu'à ce que la tendance redevienne stable.
- **Mesure trop ancienne** : aucune nouvelle valeur depuis 15 minutes,
  30 minutes, 1, 2 ou 4 heures (capteur, téléphone, uploader, ou Nightscout qui
  ne répond pas).

Variables : le nom de l'appareil, la glycémie et son unité, le numéro et la
flèche de tendance, la variation sur 5 minutes, l'heure de la valeur (UTC) ;
pour « trop ancienne », les minutes sans valeur.

Les seuils de Nightscout sont ceux de ses réglages (`BG_TARGET_BOTTOM`,
`BG_TARGET_TOP`, `BG_LOW`, `BG_HIGH`), relus à chaque rafraîchissement.

### Actions

- **Lire la glycémie** : lit Nightscout et donne aux actions suivantes la
  glycémie, son unité, la tendance, la flèche, la variation, l'âge en minutes,
  si elle est à jour, si elle est hors de la cible, l'heure de la valeur et une
  phrase toute prête : `Glycémie 142 mg/dL → +3, il y a 4 min`.

### Idées de scènes

- La nuit, **Glycémie très basse** → allumer la chambre à 30 % et envoyer un
  message Telegram aux parents avec `{{triggerEvent.data.glucose}}`.
- **Mesure trop ancienne** (30 minutes) → une notification « vérifier le
  capteur et le téléphone ».
- Un bouton du tableau de bord → **Lire la glycémie** → dire la phrase sur
  l'enceinte du salon.

## Dépannage

- **Accès refusé** : le jeton est faux ou son rôle ne permet pas de lire ;
  avec l'API_SECRET, vérifiez que c'est celui du site (12 caractères au moins).
- **Aucun Nightscout à cette adresse** : vérifiez l'adresse dans un
  navigateur ; un site dans un sous-dossier a besoin de son chemin
  (`https://example.org/ns`).
- **L'adresse redirige** : saisissez l'adresse en `https://`.
- **Nightscout répond en erreur** : sa base de données (MongoDB) est arrêtée ou
  pleine.
- **Pas de valeur à jour** : le capteur, le téléphone ou l'application d'envoi
  n'envoie plus ; Nightscout montre la même chose.
- Plus de détails : réglez `LOG_LEVEL=debug` sur l'intégration. Les journaux
  ne montrent jamais le jeton, le secret ni aucune glycémie.

## Limites

- **PAS UN DISPOSITIF MÉDICAL** : aucune garantie de délai ni de remise.
- Un seul site Nightscout par intégration.
- Lu au rythme du rafraîchissement (1 minute au mieux) : un déclencheur peut
  arriver une minute ou plus après l'alarme de Nightscout.
- Pas lus : insuline active, glucides actifs, détails de la pompe et de la
  boucle, traitements.
- Les seuils proposés en mg/dL sont des choix fixes ; ceux de Nightscout
  suivent votre site.
- Intégration non officielle, sans lien avec le projet Nightscout.
