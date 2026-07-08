# Acceder a Madrador TV depuis telephone, tablette ou autre appareil

Madrador TV tourne sur ton PC avec Node.js.

## Meme Wi-Fi

Quand ton telephone est sur le meme Wi-Fi que le PC :

```txt
http://192.168.1.101:3000
```

Si l'adresse du PC change, lance dans PowerShell :

```powershell
Get-NetIPAddress -AddressFamily IPv4
```

Cherche l'adresse qui ressemble a `192.168.x.x`, puis ouvre :

```txt
http://ADRESSE_DU_PC:3000
```

## Hors Wi-Fi, en prive

Pour ouvrir Madrador TV depuis la 4G/5G ou un autre reseau sans rendre ton PC public, utilise un VPN prive comme Tailscale.

Principe :

1. Installer Tailscale sur le PC.
2. Installer Tailscale sur le telephone.
3. Connecter les deux au meme compte Tailscale.
4. Recuperer l'adresse Tailscale du PC, souvent en `100.x.x.x`.
5. Ouvrir sur le telephone :

```txt
http://ADRESSE_TAILSCALE_DU_PC:3000
```

Exemple :

```txt
http://100.80.12.34:3000
```

Avantage : ca marche hors Wi-Fi, mais seulement sur tes appareils autorises.

## Internet public

Une URL publique ouverte a tout Internet demande soit :

- un VPS / hebergement ;
- un tunnel public ;
- une redirection de port sur la box.

Ce n'est pas active automatiquement, car cela expose ton PC et ton application. Pour une utilisation personnelle sur tes appareils, Tailscale est le choix recommande.

