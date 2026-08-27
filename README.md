# Encyclopédie Gorafi

Encyclopédie satirique en ligne — 10 000 articles fictifs, forme Wikipédia, ton Gorafi.

## Structure du repo

```
/registre-maitre.json     → le registre maître (sujets, statut Idée/Rédigé, anti-doublon)
/articles/                → un fichier JSON par article rédigé (texte + métadonnées)
/check-doublon.js         → vérification manuelle d'un sujet avant ajout
/generate-sujets.js       → alimente le registre en nouveaux sujets (Mistral → Gemini)
/generate-articles.js     → rédige les articles en statut "Idée" (Mistral → Gemini)
/site/build-site.js       → génère le site statique dans /docs à partir du registre + articles
/site/assets/             → CSS (Wikipédia + CelliA) et JS (recherche, bascule de thème)
/.github/workflows/
  generate-sujets.yml     → workflow manuel : fait grossir le registre
  generate-gorafi.yml     → workflow manuel : rédige les articles + reconstruit le site
/docs/                    → site statique généré (à publier via GitHub Pages)
```

## Mise en route (une seule fois)

1. Crée le repo, place ces fichiers à la racine (les deux `.yml` dans `.github/workflows/`).
2. Dans Settings → Secrets and variables → Actions, ajoute `MISTRAL_API_KEY` et `GEMINI_API_KEY`.
3. Dans Settings → Pages, choisis "Deploy from a branch" → branche `main` → dossier `/docs`.

## Utilisation courante

Les deux workflows sont indépendants, à déclencher manuellement (bouton "Run workflow") autant de fois que nécessaire — chacun reprend automatiquement là où il s'est arrêté :

1. **`Generate Sujets Gorafi`** en premier, tant que le registre n'a pas atteint 10 000 sujets (ou l'objectif que tu passes en paramètre). Il équilibre les nouveaux sujets sur le domaine le moins fourni et rejette les doublons via similarité sur l'objet de moquerie.
2. **`Generate Encyclopedie Gorafi`** ensuite, pour rédiger les sujets en attente ("Idée" → "Rédigé") et reconstruire automatiquement le site dans `/docs`.

Tu peux aussi lancer `Generate Encyclopedie Gorafi` régulièrement même si le registre n'est pas complet : il rédige ce qui est disponible et republie le site à chaque run, donc le site grossit progressivement.

## Vérification manuelle d'un sujet

Avant d'ajouter un sujet à la main dans `registre-maitre.json` (plutôt que via le workflow) :

```
node check-doublon.js "objet de moquerie candidat" "Institution A" "Institution B"
```

## Site : bascule de design

Chaque page a un bouton "🎨 Style" qui bascule entre le rendu Wikipédia (par défaut) et le rendu CelliA (glassmorphism sombre). Le choix est mémorisé en local (localStorage) sur l'appareil du visiteur.

## Sécurité anti-tabassage API

Les deux scripts de génération partagent le même filet de sécurité :
- timeout de 12s par appel réseau
- arrêt interne à 5h (marge d'1h avant la limite dure de 6h de GitHub Actions)
- pause de 1,2s après un succès Mistral, 4,5s après un fallback Gemini
- commit + push automatiques tous les 15 éléments générés (articles) ou tous les 5 lots (sujets), ou toutes les 4 minutes — rien n'est perdu en cas de coupure
