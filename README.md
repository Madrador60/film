# Madrador TV

Plateforme de streaming locale en Node.js + Express avec interface HTML/CSS/JS.

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

