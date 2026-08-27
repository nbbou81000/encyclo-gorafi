// build-site.js — génère le site statique (accueil, portails, articles, index de recherche)
// à partir de registre-maitre.json + articles/*.json.
// Zéro dépendance externe. Sortie dans /docs (compatible GitHub Pages sans config supplémentaire).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REGISTRE_PATH = path.join(ROOT, 'registre-maitre.json');
const ARTICLES_DIR = path.join(ROOT, 'articles');
const OUTPUT_DIR = path.join(ROOT, 'docs');
const ASSETS_DIR = path.join(__dirname, 'assets');

const SITE_NOM = "L'Encyclopédie Sérieuse"; // placeholder — change ici si tu veux un autre nom
const SITE_SLOGAN = "10 000 articles. Zéro exactitude.";

function slugify(texte) {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function echapperHTML(texte) {
  return String(texte)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function chargerJSON(p, defaut) {
  if (!fs.existsSync(p)) return defaut;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function viderEtCreerDossier(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  fs.mkdirSync(p, { recursive: true });
}

function copierDossier(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const fichier of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, fichier), path.join(dest, fichier));
  }
}

// --- Layout commun ---

function layout({ titre, base, contenu, classePage = '' }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${echapperHTML(titre)} — ${echapperHTML(SITE_NOM)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&display=swap">
  <link rel="stylesheet" href="${base}assets/style.css">
  <link rel="stylesheet" href="${base}assets/style-cellia.css">
  <script>
    // Applique le thème choisi AVANT le rendu, pour éviter le flash visuel au chargement.
    try {
      var t = localStorage.getItem('gorafi-theme-site');
      if (t === 'cellia') document.documentElement.setAttribute('data-theme-site', 'cellia');
    } catch (e) {}
  </script>
</head>
<body data-base="${base}" class="${classePage}">
  <header class="site-header">
    <div class="site-header-inner">
      <a class="site-logo" href="${base}index.html">${echapperHTML(SITE_NOM)}<span>${echapperHTML(SITE_SLOGAN)}</span></a>
      <div class="site-search">
        <input id="recherche-input" type="text" placeholder="Rechercher un article inventé…" autocomplete="off">
        <div id="recherche-resultats" class="search-results"></div>
      </div>
      <nav class="site-nav">
        <a href="#" data-action="article-hasard">Article au hasard</a>
        <button id="theme-toggle-btn" type="button">🎨 Style : Wikipédia</button>
      </nav>
    </div>
  </header>
  <div class="page-wrap">
    <main class="contenu-principal">
      ${contenu}
    </main>
  </div>
  <footer class="site-footer">
    ${echapperHTML(SITE_NOM)} — tous les articles sont fictifs et générés à des fins satiriques. Aucune information ici n'est vraie, y compris probablement cette phrase.
  </footer>
  <script src="${base}assets/search.js"></script>
  <script src="${base}assets/theme-toggle.js"></script>
</body>
</html>`;
}

// --- Page article ---

function pageArticle(entree, article) {
  const slugDomaine = slugify(entree.domaine);
  const dateAffichee = new Date(article.date_generation || Date.now()).toLocaleDateString('fr-FR', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const paragraphes = article.texte
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => `<p>${echapperHTML(p)}</p>`)
    .join('\n');

  const contenu = `
    <div class="fil-ariane">
      <a href="../index.html">Accueil</a> &rsaquo;
      <a href="../categories/${slugDomaine}.html">Portail : ${echapperHTML(entree.domaine)}</a> &rsaquo;
      ${echapperHTML(entree.titre)}
    </div>

    <div class="infobox">
      <div class="infobox-titre">Fiche</div>
      <table>
        <tr><td class="cle">Domaine</td><td><a href="../categories/${slugDomaine}.html">${echapperHTML(entree.domaine)}</a></td></tr>
        <tr><td class="cle">Statut</td><td>Vérifié par nos services</td></tr>
        <tr><td class="cle">Dernière mise à jour</td><td>${dateAffichee}</td></tr>
        <tr><td class="cle">Longueur</td><td>${article.nombre_mots} mots</td></tr>
      </table>
    </div>

    <h1 class="titre-article">${echapperHTML(entree.titre)}</h1>
    <div class="sous-titre-portail">Extrait de ${echapperHTML(SITE_NOM)}, l'encyclopédie qui n'a jamais menti puisqu'elle n'a jamais dit vrai.</div>

    <div class="badge-certification">
      <span class="sceau">🏛️</span>
      <span><strong>Article certifié 100% inventé.</strong> Conforme aux exigences de rigueur académique de la rédaction, ce contenu ne repose sur aucun fait vérifiable.</span>
    </div>

    <div class="corps-article">
      ${paragraphes}
    </div>

    <div class="categories-footer">
      Catégories :
      <a class="etiquette" href="../categories/${slugDomaine}.html">${echapperHTML(entree.domaine)}</a>
    </div>
  `;

  return layout({ titre: entree.titre, base: '../', contenu, classePage: 'page-article' });
}

// --- Page portail (catégorie) ---

function pageCategorie(domaine, entrees) {
  const items = entrees
    .map((e) => {
      const article = chargerJSON(path.join(ARTICLES_DIR, `${e.id}.json`), null);
      const extrait = article ? article.texte.slice(0, 120).trim() + '…' : '';
      return `<li>
        <a href="../articles/${e.id}.html">${echapperHTML(e.titre)}</a>
        <span class="extrait">${echapperHTML(extrait)}</span>
      </li>`;
    })
    .join('\n');

  const contenu = `
    <div class="fil-ariane"><a href="../index.html">Accueil</a> &rsaquo; Portail : ${echapperHTML(domaine)}</div>
    <h1 class="titre-article">Portail : ${echapperHTML(domaine)}</h1>
    <div class="sous-titre-portail">${entrees.length} article(s) publié(s) dans ce domaine.</div>
    <ul class="liste-articles">
      ${items}
    </ul>
  `;

  return layout({ titre: `Portail : ${domaine}`, base: '../', contenu, classePage: 'page-categorie' });
}

// --- Page d'accueil ---

function pageAccueil(parDomaine, totalRedige, totalRegistre) {
  const cartes = Object.entries(parDomaine)
    .map(([domaine, entrees]) => {
      const slug = slugify(domaine);
      return `<a class="carte-portail" href="categories/${slug}.html">
        <div class="nom-portail">${echapperHTML(domaine)}</div>
        <div class="nb-articles">${entrees.length} article(s)</div>
      </a>`;
    })
    .join('\n');

  const contenu = `
    <div class="hero-accueil">
      <h1>${echapperHTML(SITE_NOM)}</h1>
      <p>${echapperHTML(SITE_SLOGAN)}</p>
      <a href="#" class="bouton-hasard" data-action="article-hasard">Article au hasard</a>
    </div>
    <div class="compteur-articles">${totalRedige} article(s) publié(s) sur ${totalRegistre} prévus au registre.</div>
    <div class="grille-portails">
      ${cartes}
    </div>
  `;

  return layout({ titre: 'Accueil', base: '', contenu, classePage: 'page-accueil' });
}

// --- Build ---

function main() {
  const registre = chargerJSON(REGISTRE_PATH, []);
  const rediges = registre.filter((e) => e.statut === 'Rédigé');

  console.log(`Registre : ${registre.length} entrée(s), dont ${rediges.length} rédigée(s).`);

  viderEtCreerDossier(OUTPUT_DIR);
  fs.mkdirSync(path.join(OUTPUT_DIR, 'articles'), { recursive: true });
  fs.mkdirSync(path.join(OUTPUT_DIR, 'categories'), { recursive: true });
  copierDossier(ASSETS_DIR, path.join(OUTPUT_DIR, 'assets'));

  const parDomaine = {};
  const indexRecherche = [];

  for (const entree of rediges) {
    const article = chargerJSON(path.join(ARTICLES_DIR, `${entree.id}.json`), null);
    if (!article) {
      console.warn(`  ⚠️  ${entree.id} marqué "Rédigé" mais fichier article introuvable, ignoré.`);
      continue;
    }

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'articles', `${entree.id}.html`),
      pageArticle(entree, article),
      'utf-8'
    );

    (parDomaine[entree.domaine] = parDomaine[entree.domaine] || []).push(entree);
    indexRecherche.push({ id: entree.id, titre: entree.titre, domaine: entree.domaine });
  }

  for (const [domaine, entrees] of Object.entries(parDomaine)) {
    const slug = slugify(domaine);
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'categories', `${slug}.html`),
      pageCategorie(domaine, entrees),
      'utf-8'
    );
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'index.html'),
    pageAccueil(parDomaine, rediges.length, registre.length),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'search-index.json'),
    JSON.stringify(indexRecherche),
    'utf-8'
  );

  console.log(`\n✅ Site généré dans ${OUTPUT_DIR}`);
  console.log(`   ${rediges.length} page(s) article, ${Object.keys(parDomaine).length} portail(s).`);
}

main();
