# Madrador TV

Plateforme de streaming Node.js + Express avec films, séries, lecteur multi-sources et télévision en direct.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Madrador60/film)

## Lancer en local

```bash
npm install
npm start
```

Puis ouvrir :

```txt
http://localhost:3000
```

## Version publique

La version Render est disponible ici :

```txt
https://madrador.onrender.com/
```

Pages principales : accueil, catalogue films/séries, recherche, bibliothèque, lecteur, Direct, paramètres et administration.

## Deploy gratuit sur Render

Render peut heberger un Web Service Node.js gratuitement avec des limites.

Configuration :

- Runtime : Node
- Build Command : `npm ci`
- Start Command : `npm start`
- Plan : Free

Le serveur utilise automatiquement la variable `PORT` fournie par Render.

## Notes

Le plan gratuit peut se mettre en veille apres inactivite. Le premier chargement apres une pause peut donc prendre quelques secondes.
