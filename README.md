# Qlik en VR

Une pièce WebXR (Meta Quest 3) où l'on est **dans** ses données Qlik Cloud. Le moteur associatif de Qlik calcule tout :
chaque sélection, faite d'un coup de gâchette sur une valeur, une barre, une tour ou un point, se propage à toute la pièce.
Les couleurs d'état sont celles de Qlik Sense : vert = sélectionné, blanc = possible, gris clair = alternatif, gris = exclu.

## La pièce (vous êtes au centre)

| Où | Quoi | Pourquoi en VR |
|---|---|---|
| Devant, en haut | Barre de sélections (retour / avancer / tout effacer, une puce par champ) et KPI | Les KPI « roulent » jusqu'à leur nouvelle valeur après chaque sélection |
| Devant | **Ville de barres** : dimension 1 × dimension 2 sur une table (ex. Category × Year) | On tourne autour, on se penche ; les onglets de la table changent la dimension des colonnes |
| À gauche | Volets de filtres en arc | Défilement au joystick |
| À droite | **Globe** : chaque ville est une tour (hauteur = CA, couleur = marge %) | On l'attrape au grip pour le faire tourner |
| Derrière | **Nuage 3D** : chaque client placé selon 3 mesures (X, Y, Z) | On marche dedans ; lignes de chute et ombres au sol pour lire la profondeur |
| Tout autour | **Anneau du temps** : une tour par mois, en cercle autour de vous | Le temps vous entoure ; une période garde toujours sa place |

## Commandes

- **Gâchette** : sélectionner (cliquer à nouveau pour désélectionner). Pincer avec les mains marche aussi.
- **Joystick** en visant un volet : défiler. En visant le globe ou le nuage : le faire tourner.
- **Grip** sur le globe ou le nuage : l'attraper et le faire tourner.
- Joystick gauche : marcher. Joystick droit : pivoter de 30°.
- **B** retour, **A** avancer, **Y** tout effacer, **X** revenir au centre.
- Sur écran (aperçu) : glisser pour regarder, ZQSD/WASD pour se déplacer, clic pour sélectionner, molette pour défiler, ⌫ pour revenir en arrière.

## En ligne : https://mge-agilos.github.io/VRSales/

La pièce est publiée sur GitHub Pages à chaque push sur `main` (`.github/workflows/pages.yml`, build `vite.pages.config.js`).
Une page statique n'a pas de serveur : pas de proxy ni de clé API. **Chaque visiteur se connecte avec son propre compte
Qlik Cloud** (OAuth « single-page app » + PKCE, `src/qlik-oauth.js`). Il a donc sa propre session moteur et ses propres
sélections, et ne voit que les apps auxquelles il a accès. La présence (avatars, Suivre) n'existe qu'avec le serveur local.

Le client OAuth « Qlik en VR (GitHub Pages VRSales) » est déclaré sur le tenant (Administration → OAuth). Il n'accepte que
les adresses https://mge-agilos.github.io/VRSales/ et https://localhost:5173/dataviz/ : si l'adresse de publication change,
il faut l'ajouter dans ce client. `?app=demo` fonctionne sans connexion.

## À plusieurs : casque, PC et téléphone dans la même pièce

Ouvrez la même adresse (`https://<IP-du-PC>:5173/dataviz/`) sur chaque appareil connecté au même Wi-Fi, en acceptant
l'avertissement de certificat sur chacun.

- **Sélections partagées en direct.** Tous les appareils passent par la même clé, donc par la même session du moteur Qlik :
  une sélection faite n'importe où (casque, PC, téléphone, et même Qlik Sense ouvert sur l'app) recalcule la pièce partout.
- **Présence.** Chaque personne apparaît sous la forme d'une tête colorée, avec son nom, son appareil et un rayon vers ce
  qu'elle vise. Ses actions s'affichent en notification (« Maxime → Germany (Country) ») : sur la page à l'écran, et devant
  les yeux dans le casque. Le nom se règle dans le panneau.
- **Suivre.** Depuis la liste « Dans la pièce », le bouton *Suivre* montre ce que voit une autre personne, par exemple celle
  qui porte le casque.
- **Sur écran.** Les boutons du bas mènent à chaque visualisation (Centre, Tableau, Filtres, Globe, Nuage, Vue d'ensemble).
  Sur PC : ZQSD/WASD pour se déplacer, E/C pour monter et descendre. Sur téléphone : joystick, glisser pour regarder, tap
  pour sélectionner, glisser sur un volet pour le faire défiler, et *Gyroscope* pour regarder autour de soi en bougeant le
  téléphone.

La présence passe par le serveur Vite (`presence-server.js` : POST `/presence`, flux SSE `/presence/stream`), sans aucune
dépendance. En mode `?app=demo`, chaque appareil calcule ses données localement : la présence fonctionne, mais pas le
partage des sélections.

Le serveur n'est accessible qu'au réseau local, et c'est voulu : le proxy `/qlik/` agit avec la clé API. L'exposer sur
Internet (tunnel, redirection de port) donnerait à n'importe qui l'accès aux apps Qlik de ce compte. Pour des participants
à distance, utilisez un VPN (Tailscale, par exemple) ou ajoutez d'abord une authentification.

## Connexion à Qlik Cloud

Le serveur Vite sert de **proxy** : le casque parle à `https://<PC>:5173/qlik/…`, et le PC ajoute la clé API puis relaie
vers le tenant (REST et WebSocket du moteur). La clé ne quitte jamais le PC : il n'y a ni client OAuth ni origine autorisée
à configurer sur le tenant.

`../.env.local` (à la racine du projet VR, ignoré par git ; modèle dans `.env.example`) :

```
QLIK_TENANT=beyond-data-group-training.de.qlikcloud.com
QLIK_API_KEY=…
QLIK_APP_ID=771eef89-203b-47ab-a617-d5f9df6dccad
```

- `?app=<id>` ouvre une autre app (la liste déroulante de la page d'accueil affiche les apps du tenant).
- `?app=demo` lance des données d'exemple sur un petit moteur associatif local, sans connexion.
- La session moteur est celle de l'utilisateur de la clé : les sélections faites en VR apparaissent aussi dans Qlik Sense
  ouvert sur la même app, et inversement.

## Configurer ce qui est affiché

[`src/config.js`](src/config.js) contient un préréglage par app, construit sur ses éléments maîtres (`{ lib: '<id>' }`),
ses champs (`{ field: 'City' }`) ou ses expressions (`{ expr: 'Sum(Sales)' }`). Une app sans préréglage est configurée
automatiquement à partir de ses champs : peu de valeurs pour les filtres, `Sum()` des champs numériques comme mesures,
champs Latitude/Longitude pour le globe, champ « mois » pour l'anneau.

## Vidéo promo

`node dataviz/video/make-promo.mjs` → `video/qlik-vr-promo.mp4` (1080×1080, 1 min 51). Le script part de l'enregistrement du Quest
`video/source-quest-20261010-224827.mp4`, coupe le menu du Quest et ajoute des cartons d'ouverture et de fin. La voix off anglaise
(ElevenLabs, voix « Sarah », clé lue dans `film/unity/audio/.env`) est mise en cache dans `video/audio/`. La musique est
« Digital Lemonade » de Kevin MacLeod (incompetech.com), sous licence CC BY 4.0 : le crédit figure sur le carton de fin.
Les textes et leur minutage sont dans `LINES`, les plans gardés dans `CLIPS`.

`node dataviz/video/make-promo.mjs bdg` → `video/qlik-vr-promo-beyond-data.mp4`, aux couleurs de Beyond Data Group : fond bleu nuit
avec les arcs de la marque, police Urbanist, logo, séquence VR encadrée et sous-titres courts. Les éléments graphiques sont dessinés
dans `video/brand/cards.html` puis rendus image par image avec Chrome (`video/brand/render.mjs`) dans `video/brand/build/`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `qlik-proxy.js` | Plugin Vite : proxy `/qlik/…` vers le tenant avec la clé, et `/qlik-status` |
| `src/qlik.js` | Client JSON-RPC du moteur QIX : ListObject, HyperCube, sélections, Back/Forward/ClearAll |
| `src/demo.js` | Moteur associatif local et données d'exemple |
| `src/config.js` | Préréglages par app et configuration automatique |
| `src/viz.js` | Ville de barres, anneau du temps, globe, nuage 3D |
| `src/ui.js` | Volets de filtres, barre de sélections, KPI, info-bulle |
| `src/panel.js` | Panneaux dessinés sur canvas, avec zones cliquables, et étiquettes 3D |
| `src/main.js` | Scène, disposition de la pièce, manettes, souris et tactile, rafraîchissement après sélection |
| `src/screen.js` | Navigation sans casque : points de vue, joystick tactile, clavier, gyroscope, suivre quelqu'un |
| `src/presence.js` | Avatars des autres participants, publication de sa propre pose, notifications |
| `presence-server.js` | Plugin Vite : relais de présence (POST + flux SSE) |
| `assets/land-110m.json` | Contours des terres (world-atlas, Natural Earth), utilisés pour le globe |
