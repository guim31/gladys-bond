# Bond Bridge

Pilotez depuis Gladys les ventilateurs de plafond, stores, lumières et autres appareils à télécommande d'un
[Bond Bridge](https://bondhome.io/), d'un Bond Bridge Pro ou d'un appareil Smart by Bond, sur le **réseau local** :
pas de cloud, pas de compte Bond nécessaire à Gladys.

> **Développée sans le matériel : vos retours sont les bienvenus.** Cette intégration suit l'API locale officielle
> Bond v2 et le comportement de l'intégration Home Assistant `bond`, et elle est testée contre un bridge simulé. Si
> votre bridge se comporte autrement, ouvrez une issue sur le dépôt GitHub. Sans lien avec Bond ni Olibra.

## Présentation

Un Bond Bridge apprend les télécommandes radio (RF) de vos ventilateurs de plafond, stores, foyers et lumières, et
les rejoue à la demande. Cette intégration parle au bridge sur votre réseau et crée un appareil Gladys par appareil
Bond :

- **ventilateurs de plafond** : marche/arrêt, vitesse, sens de rotation, mode brise, lumière et luminosité,
  lumières haute et basse ;
- **stores, volets, bannes** : ouvrir, fermer, stop, position ;
- **lumières** : marche/arrêt, luminosité, température de couleur ;
- **appareils génériques** : marche/arrêt ;
- **foyers** : masqués par défaut, en lecture seule quand ils sont affichés (voir plus bas).

Un **widget** de tableau de bord pilote un ventilateur de plafond comme sa télécommande murale, deux
**déclencheurs** de scène signalent qu'un bridge ne répond plus puis revient, et une **action** de scène corrige ce
que Bond croit d'un appareil.

## Prérequis

- Gladys Assistant 5.1 ou plus récent.
- Un Bond Bridge, Bond Bridge Pro ou appareil Smart by Bond, **installé d'abord dans l'application Bond** (Wi-Fi,
  appareils ajoutés).
- Le bridge et Gladys sur le même réseau local. Donnez au bridge une adresse IP fixe dans votre box (bail DHCP
  réservé) : Gladys le joint par son adresse.
- Le **jeton local** du bridge (16 caractères), lu une fois — voir plus bas.

## Configuration

Dans Gladys, ouvrez **Intégrations**, installez **Bond Bridge**, puis son onglet **Configuration**.

### Trouver le bridge

Appuyez sur **Trouver les bridges** : Gladys cherche les bridges Bond de votre réseau (mDNS) et remplit les adresses
vides. Si rien n'est trouvé (autre sous-réseau, mDNS bloqué), saisissez vous-même l'adresse IP du bridge, par
exemple `192.168.1.20`. Vous pouvez configurer jusqu'à trois bridges.

### Récupérer le jeton local

Chaque requête au bridge porte son jeton local. Deux façons de l'obtenir :

1. **Depuis Gladys** : débranchez le bridge, rebranchez-le, attendez que son voyant revienne, puis dans les
   **10 minutes** appuyez sur **Récupérer le jeton local**. Le bridge donne son jeton pendant les 10 minutes qui
   suivent son démarrage ; Gladys l'enregistre dans la configuration.
2. **Depuis l'application Bond** : ouvrez le bridge (ou l'appareil Smart by Bond), **Settings**, **Advanced**,
   **Local token**, et copiez-le dans le champ **Jeton local**.

Appuyez ensuite sur **Tester la connexion** : chaque bridge répond avec son firmware, le nombre d'appareils pour
Gladys et l'état des mises à jour en direct.

### Options

- **Foyers** : `Masqués` (par défaut) ou `Affichés, en lecture seule`.
- **Langue des noms de fonctionnalités** : les noms donnés aux fonctionnalités à l'ajout d'un appareil dans Gladys
  (français par défaut). Ils ne changent plus ensuite.

Allez ensuite dans l'onglet **Découverte** et ajoutez les appareils voulus.

## Appareils

Un appareil n'a une fonctionnalité que si sa télécommande, telle que configurée dans l'application Bond, a l'action
correspondante : une télécommande de ventilateur sans bouton de lumière n'a pas de lumière.

### Ventilateurs de plafond

| Fonctionnalité        | Type Gladys             | Ce qu'elle fait                                               |
| --------------------- | ----------------------- | ------------------------------------------------------------- |
| Marche / arrêt        | interrupteur            | allumé / éteint                                               |
| Vitesse               | vitesse de ventilation  | de 1 au nombre de vitesses de la télécommande, 0 l'éteint     |
| Sens de rotation      | direction du flux d'air | normal (été) / inversé (hiver)                                |
| Mode brise            | interrupteur            | le mode « brise naturelle » de Bond, si le ventilateur l'a    |
| Lumière               | lumière                 | la lumière du ventilateur                                     |
| Luminosité            | luminosité              | de 1 à 100 %, 0 éteint la lumière                             |
| Lumière haute / basse | interrupteur            | les lumières haute et basse séparées de certains ventilateurs |

Quand le ventilateur est éteint, sa vitesse affiche 0 : le bridge garde la dernière vitesse, reprise au prochain
« marche ». Une télécommande qui n'a que des boutons bascule (un seul bouton pour marche et arrêt) n'est actionnée
que si l'état que Bond croit diffère de celui demandé.

### Stores

**Ouverture / fermeture** (ouvrir, fermer, stop) et **Position** (0 % fermé, 100 % ouvert) quand le moteur gère une
position. Bond compte dans l'autre sens (0 ouvert, 100 fermé) : l'intégration convertit.

### Lumières

**Lumière** (marche/arrêt), **Luminosité** (1 à 100 %) et **Température de couleur** (en kelvins, dans la plage de
la lumière), selon la télécommande.

### Foyers

Un foyer n'est **jamais piloté depuis Gladys**. Allumer une flamme de gaz par erreur — une scène, un assistant
vocal, un enfant sur le tableau de bord — n'est pas anodin. Par défaut les foyers sont masqués ; avec **Affichés, en
lecture seule** ils apparaissent avec leur **Marche / arrêt** et leur **Flamme** en lecture seule, pour l'affichage
et les conditions de scène. Continuez d'utiliser l'application Bond ou la télécommande du foyer pour l'allumer.

### Appareils génériques

Un appareil de type « Generic » dans l'application Bond reçoit un interrupteur **Marche / arrêt**. Ne l'utilisez pas
pour du chauffage.

### Non pris en charge

Les portes de garage (une porte ouverte par erreur est un problème de sécurité), les climatiseurs et les bidets ne
sont pas publiés. Les groupes de l'application Bond non plus : mettez plutôt les appareils dans une scène Gladys.

## Ce que Bond croit

Une télécommande radio envoie mais ne répond jamais : **Bond ne connaît pas l'état réel d'un appareil**, il retient
ce qu'il a envoyé en dernier. L'état dans Gladys est cette croyance. Il devient faux quand l'appareil est utilisé
avec sa propre télécommande (le Bond Bridge Pro entend certaines télécommandes et les suit), un interrupteur mural ou
une coupure de courant.

Pour le corriger sans rien envoyer, utilisez **Corriger l'état Bond** (dans l'onglet Configuration, ou comme action
de scène) : choisissez l'appareil et son état réel (allumé, éteint, lumière allumée, lumière éteinte, ouvert,
fermé). Bond l'enregistre, aucun signal n'est envoyé, et la prochaine commande de Gladys part du bon état.
L'application Bond propose la même correction pour chaque appareil.

## Widget

Le widget **Ventilateur de plafond** montre un ventilateur, choisi dans ses réglages :

- la vitesse (et la luminosité de sa lumière) en tuiles en direct ;
- si le ventilateur et sa lumière sont allumés, son sens, le mode brise ;
- quatre boutons : **Moins vite**, **Plus vite**, **Lumière** (marche/arrêt) et **Allumer / Éteindre**.

« Moins vite » à la vitesse 1 éteint le ventilateur ; « Plus vite » sur un ventilateur éteint le démarre en
vitesse 1. Si le bridge ne répond plus, le widget l'indique.

## Déclencheurs et actions de scène

| Genre       | Nom                     | Variables                                 |
| ----------- | ----------------------- | ----------------------------------------- |
| Déclencheur | Bridge Bond injoignable | nom du bridge, Bond ID                    |
| Déclencheur | Bridge Bond de retour   | nom du bridge, Bond ID, minutes d'absence |
| Action      | Corriger l'état Bond    | appareil, état réel                       |

Un bridge est injoignable après deux lectures ratées de suite (environ une minute) ; un jeton faux n'est pas
« injoignable », il apparaît dans l'état de connexion. Les appareils eux-mêmes n'ont pas de déclencheur ici :
utilisez le déclencheur habituel « changement d'état d'un appareil » de Gladys sur leurs fonctionnalités.

## Exemples de scènes

- **Nuit d'été** : à 23 h, si la température de la chambre dépasse 26 °C, mettre le ventilateur de la chambre en
  vitesse 2 et éteindre sa lumière.
- **Coucher du soleil** : au coucher du soleil, fermer les stores de la terrasse (position 0 %), et les ouvrir à
  8 h en semaine.
- **Surveillance du bridge** : quand un bridge Bond est injoignable, envoyer le message « Le bridge Bond {{bridge}}
  ne répond plus ».
- **Interrupteur mural** : les ventilateurs des chambres sont coupés par un interrupteur mural chaque nuit à 1 h :
  une scène à 1 h 05 lance « Corriger l'état Bond : éteint » sur eux, pour que le prochain « marche » de Gladys ne
  les éteigne pas.

## Rafraîchissement et réseau

- **Mises à jour en direct** : le bridge pousse chaque changement d'état en UDP (BPUP, port 30007) aux clients qui
  gardent un abonnement ouvert ; l'intégration le renouvelle toutes les 60 secondes. Les changements faits dans
  l'application Bond (et sur un Bond Bridge Pro, avec les télécommandes qu'il entend) apparaissent dans Gladys en
  moins d'une seconde.
- **Lecture** : tant que les mises à jour en direct sont muettes, chaque appareil ajouté à Gladys est lu toutes les
  30 secondes ; quand elles fonctionnent, toutes les 10 minutes par sécurité. Seuls les appareils ajoutés à Gladys
  sont lus.
- **Charge du bridge** : deux requêtes à la fois au plus, une connexion neuve par requête, 5 secondes de délai. Une
  commande est suivie d'une lecture de l'appareil.
- Tout reste sur votre réseau : pas de cloud, pas de compte Bond, rien d'enregistré dans `/data`.

## Dépannage

- **« Jeton local refusé »** : le jeton a changé (une réinitialisation du bridge le change) ou a été mal saisi.
  Récupérez-le de nouveau (voir plus haut).
- **« Jeton local manquant »** : appuyez sur **Récupérer le jeton local** dans les 10 minutes qui suivent le
  rebranchement du bridge.
- **« Verrouillé » à la récupération du jeton** : plus de 10 minutes depuis le démarrage du bridge. Débranchez-le,
  rebranchez-le, recommencez ; ou copiez le jeton depuis l'application Bond.
- **« Ne répond pas »** : vérifiez l'adresse IP (fixez-la dans votre box), que le bridge est allumé (son voyant), et
  que Gladys et le bridge sont sur le même réseau.
- **« Trouver les bridges » ne trouve rien** : le mDNS ne traverse pas les routeurs ni certains réglages de Wi-Fi
  maillé. Saisissez l'adresse.
- **L'état dans Gladys est faux** : quelqu'un a utilisé la télécommande d'origine. Utilisez **Corriger l'état Bond**.
- **Tester la connexion indique « pas de mise à jour en direct »** : un pare-feu entre Gladys et le bridge bloque
  peut-être le port UDP 30007. Tout fonctionne, un peu moins vite (lecture toutes les 30 s).
- Plus de détails dans les logs de l'intégration (`LOG_LEVEL=debug` montre chaque lecture).

## Limites

- **Développée sans le matériel** : le comportement suit la documentation Bond, l'intégration Home Assistant et la
  bibliothèque `bond-async` ; il n'a pas été essayé sur un vrai bridge. Vos retours sont les bienvenus.
- L'état est ce que Bond croit, jamais une mesure (voir plus haut).
- Les foyers sont en lecture seule ; portes de garage, climatiseurs et bidets sont écartés.
- Pas d'inclinaison des stores, pas de minuteries, pas de groupes ni de scènes de l'application Bond.
- Jusqu'à trois bridges.
- Les mises à jour en direct traversent le réseau Docker du bac à sable de Gladys en unicast (renouvellement toutes
  les 60 s) ; ce n'a pas été vérifié sur du vrai matériel. Sans elles, la lecture toutes les 30 s prend le relais.
- Sans lien avec Bond ni Olibra. Bond, Bond Bridge et Smart by Bond sont des marques de leurs propriétaires.
