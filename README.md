# Andalousie en famille

Appli web de suivi du séjour familial du 24 au 28 février 2027 (Serranía de Ronda) : décisions à prendre, fil des nouvelles, hébergements, prestataires, participants et plan d'action.

## Fonctionnement

Site statique (HTML, CSS, JavaScript, sans build) hébergé sur GitHub Pages. Les données ne sont pas dans ce dépôt : la page les lit en direct dans une feuille Google Sheets partagée en lecture, dont l'identifiant arrive par le lien d'accès (`?k=<identifiant>`, mémorisé ensuite dans le navigateur).

Onglets lus dans la feuille : `Infos`, `Fil`, `Décisions`, `À faire`, `Hébergements`, `Prestataires`, `Vols`, `Point du jour`, `Plan (fichier de Noé)`, `Participants (fichier de Noé)`. Les deux derniers recopient le fichier de suivi de Noé par `IMPORTRANGE`, sans les colonnes santé et régimes.

## Chat avec Claude

Le bouton « Demander à Claude » envoie la question et les données du séjour à un relais Cloudflare Worker (`relais-cloudflare.js`), qui appelle l'API Claude avec la clé Anthropic gardée en secret (`ANTHROPIC_API_KEY`). Le relais n'accepte que les appels venant de ce site avec la clé d'accès du lien partagé. Le bouton n'apparaît que si la ligne `chat` de l'onglet `Infos` contient l'adresse du relais.

## Lancer en local

```
python3 -m http.server 8000
```

puis ouvrir `http://localhost:8000/?k=<identifiant de la feuille>`.
