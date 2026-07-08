# Creer une URL publique pour Madrador TV

Pour ouvrir Madrador TV depuis n'importe ou sans que le PC soit allume, il faut l'heberger sur un serveur en ligne.

Le projet est maintenant compatible hebergement cloud :

- le serveur utilise `process.env.PORT` si l'hebergeur fournit un port ;
- un `Dockerfile` est disponible ;
- les fichiers inutiles sont ignores par Docker ;
- le backend Express reste compatible avec les routes existantes.

## Solution gratuite recommandee : Render

Render permet de creer un Web Service Node.js gratuit avec une URL publique en `onrender.com`.

Bouton direct :

```txt
https://render.com/deploy?repo=https://github.com/Madrador60/film
```

Ou depuis le README GitHub, clique sur le bouton `Deploy to Render`.

Parametres :

```txt
Name: madrador-tv
Runtime: Node
Build Command: npm ci
Start Command: npm start
Plan: Free
```

Important : le plan gratuit peut dormir apres inactivite. Au premier clic, il peut mettre un peu de temps a se reveiller.

## Autres solutions

Utilise un hebergeur Node.js qui peut lancer :

```bash
npm start
```

Depot GitHub :

```txt
https://github.com/Madrador60/film.git
```

Commande de demarrage :

```bash
npm start
```

Port :

```txt
Automatique avec la variable PORT
```

## Important

Une URL publique sans PC allume ne peut pas etre creee uniquement avec du code local.
Il faut obligatoirement :

- un hebergement cloud ;
- ou un VPS ;
- ou un serveur qui reste allume.

GitHub Pages ne suffit pas, car Madrador TV utilise un backend Node.js avec scraping.

## Apres deploiement

L'hebergeur donnera une URL du type :

```txt
https://madrador-tv.example.app
```

C'est cette URL que tu pourras ouvrir sur telephone, tablette, PC, 4G/5G, ou n'importe quel autre reseau.
