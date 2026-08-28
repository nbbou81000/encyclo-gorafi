// build-site.js — génère le site statique (accueil, portails, articles, institutions,
// statistiques, modifications récentes, index de recherche) à partir de
// registre-maitre.json + articles/*.json.
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
const SITE_URL = 'https://nbbou81000.github.io/encyclo-gorafi/';

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

// Hash simple et déterministe (type djb2) — sert au compteur de vues factice,
// stable d'un build à l'autre pour un même article, sans backend ni tracking réel.
function hashDeterministe(texte) {
  let h = 5381;
  for (let i = 0; i < texte.length; i++) {
    h = (h * 33) ^ texte.charCodeAt(i);
  }
  return Math.abs(h);
}

function compteurVuesFactice(id) {
  // Étale les vues entre ~300 et ~48000, façon "certains articles inventés
  // intéressent visiblement plus de monde que d'autres".
  return 300 + (hashDeterministe(id) % 47700);
}

function formaterNombre(n) {
  return n.toLocaleString('fr-FR');
}

// --- Layout commun ---

function layout({ titre, base, contenu, classePage = '', description = '' }) {
  const desc = echapperHTML(description || SITE_SLOGAN);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${echapperHTML(titre)} — ${echapperHTML(SITE_NOM)}</title>
  <meta name="description" content="${desc}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${echapperHTML(titre)} — ${echapperHTML(SITE_NOM)}">
  <meta property="og:description" content="${desc}">
  <meta property="og:image" content="${SITE_URL ? SITE_URL + 'assets/og-image.png' : base + 'assets/og-image.png'}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${SITE_URL ? SITE_URL + 'assets/og-image.png' : base + 'assets/og-image.png'}">
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
        <a href="${base}recent.html">Modifications récentes</a>
        <a href="${base}statistiques.html">Statistiques</a>
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
  ${classePage === 'page-accueil' ? `<script src="${base}assets/article-du-jour.js"></script>` : ''}
</body>
</html>`;
}

// --- Page article ---

function pageArticle(entree, article, voirAussi, institutionsIndex) {
  const slugDomaine = slugify(entree.domaine);
  const dateAffichee = new Date(article.date_generation || Date.now()).toLocaleDateString('fr-FR', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  const vues = compteurVuesFactice(entree.id);

  const paragraphes = article.texte
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => `<p>${echapperHTML(p)}</p>`)
    .join('\n');

  const institutionsListe = (entree.institutions_fictives || [])
    .map((inst) => {
      const slug = slugify(inst);
      return `<a href="../institutions/${slug}.html">${echapperHTML(inst)}</a>`;
    })
    .join(', ');

  const voirAussiHTML = voirAussi.length
    ? `<div class="voir-aussi">
        <div class="voir-aussi-titre">Voir aussi</div>
        <ul>
          ${voirAussi.map((v) => `<li><a href="../articles/${v.id}.html">${echapperHTML(v.titre)}</a></li>`).join('\n')}
        </ul>
      </div>`
    : '';

  const description = article.texte.slice(0, 160).trim() + '…';

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
        <tr><td class="cle">Consultations</td><td>${formaterNombre(vues)}</td></tr>
        ${institutionsListe ? `<tr><td class="cle">Institutions citées</td><td>${institutionsListe}</td></tr>` : ''}
      </table>
    </div>

    <h1 class="titre-article">${echapperHTML(entree.titre)}</h1>
    <div class="sous-titre-portail">Extrait de ${echapperHTML(SITE_NOM)}, l'encyclopédie qui n'a jamais menti puisqu'elle n'a jamais dit vrai.</div>

    <div class="badge-certification">
      <span class="sceau">🏛️</span>
      <span><strong>Article certifié 100% inventé.</strong> Conforme aux exigences de rigueur académique de la rédaction, ce contenu ne repose sur aucun fait vérifiable.</span>
    </div>

    <button class="bouton-partager" type="button" data-action="partager" data-titre="${echapperHTML(entree.titre)}" data-texte="${echapperHTML(description)}">
      <span class="icone-partage">↗</span> Partager cet article
    </button>

    <div class="corps-article">
      ${paragraphes}
    </div>

    <div class="categories-footer">
      Catégories :
      <a class="etiquette" href="../categories/${slugDomaine}.html">${echapperHTML(entree.domaine)}</a>
    </div>

    ${voirAussiHTML}
  `;

  return layout({ titre: entree.titre, base: '../', contenu, classePage: 'page-article', description });
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

// --- Page institution ---

function pageInstitution(nomInstitution, entrees) {
  const items = entrees
    .map((e) => `<li>
        <a href="../articles/${e.id}.html">${echapperHTML(e.titre)}</a>
        <span class="extrait">${echapperHTML(e.domaine)}</span>
      </li>`)
    .join('\n');

  const contenu = `
    <div class="fil-ariane"><a href="../index.html">Accueil</a> &rsaquo; ${echapperHTML(nomInstitution)}</div>
    <h1 class="titre-article">${echapperHTML(nomInstitution)}</h1>
    <div class="sous-titre-portail">Institution fictive citée dans ${entrees.length} article(s).</div>
    <ul class="liste-articles">
      ${items}
    </ul>
  `;

  return layout({ titre: nomInstitution, base: '../', contenu, classePage: 'page-institution' });
}

// --- Page statistiques ---

function pageStatistiques(registre, rediges, parDomaine, compteurMecanismes, compteurInstitutions) {
  const objectif = 10000;
  const pourcentage = Math.min(100, ((rediges.length / objectif) * 100)).toFixed(1);

  const lignesDomaine = Object.entries(parDomaine)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([domaine, entrees]) => {
      const slug = slugify(domaine);
      const largeur = rediges.length ? ((entrees.length / rediges.length) * 100).toFixed(1) : 0;
      return `<tr>
        <td><a href="categories/${slug}.html">${echapperHTML(domaine)}</a></td>
        <td>${entrees.length}</td>
        <td><div class="barre-stat"><div class="barre-stat-remplie" style="width:${largeur}%"></div></div></td>
      </tr>`;
    })
    .join('\n');

  const lignesMecanisme = Object.entries(compteurMecanismes)
    .sort((a, b) => b[1] - a[1])
    .map(([mecanisme, n]) => `<tr><td>${echapperHTML(mecanisme)}</td><td>${n}</td></tr>`)
    .join('\n');

  const topInstitutions = Object.entries(compteurInstitutions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([inst, n]) => {
      const slug = slugify(inst);
      return `<tr><td><a href="institutions/${slug}.html">${echapperHTML(inst)}</a></td><td>${n}</td></tr>`;
    })
    .join('\n');

  const contenu = `
    <div class="fil-ariane"><a href="index.html">Accueil</a> &rsaquo; Statistiques</div>
    <h1 class="titre-article">Statistiques</h1>
    <div class="sous-titre-portail">Où en est ${echapperHTML(SITE_NOM)} dans sa quête d'exhaustivité fictive.</div>

    <p><strong>${formaterNombre(rediges.length)}</strong> articles publiés sur un objectif de <strong>${formaterNombre(objectif)}</strong> (${pourcentage}%).</p>
    <div class="barre-stat barre-stat-grande"><div class="barre-stat-remplie" style="width:${pourcentage}%"></div></div>
    <p style="color:var(--texte-discret,#666);font-size:0.85em;">${formaterNombre(registre.length - rediges.length)} sujet(s) en file d'attente de rédaction.</p>

    <h2 style="font-family:Georgia,serif;margin-top:2em;">Répartition par domaine</h2>
    <table class="table-stats">
      <thead><tr><th>Domaine</th><th>Articles</th><th></th></tr></thead>
      <tbody>${lignesDomaine}</tbody>
    </table>

    <h2 style="font-family:Georgia,serif;margin-top:2em;">Mécanismes comiques utilisés</h2>
    <table class="table-stats">
      <thead><tr><th>Mécanisme</th><th>Occurrences</th></tr></thead>
      <tbody>${lignesMecanisme}</tbody>
    </table>

    <h2 style="font-family:Georgia,serif;margin-top:2em;">Institutions fictives les plus citées</h2>
    <table class="table-stats">
      <thead><tr><th>Institution</th><th>Articles</th></tr></thead>
      <tbody>${topInstitutions}</tbody>
    </table>
  `;

  return layout({ titre: 'Statistiques', base: '', contenu, classePage: 'page-statistiques' });
}

// --- Page modifications récentes ---

function pageRecent(rediges) {
  const tries = [...rediges]
    .filter((e) => e._dateGeneration)
    .sort((a, b) => new Date(b._dateGeneration) - new Date(a._dateGeneration))
    .slice(0, 100);

  const items = tries
    .map((e) => {
      const date = new Date(e._dateGeneration).toLocaleDateString('fr-FR', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      return `<li>
        <span class="recent-date">${date}</span>
        <a href="articles/${e.id}.html">${echapperHTML(e.titre)}</a>
        <span class="extrait">${echapperHTML(e.domaine)}</span>
      </li>`;
    })
    .join('\n');

  const contenu = `
    <div class="fil-ariane"><a href="index.html">Accueil</a> &rsaquo; Modifications récentes</div>
    <h1 class="titre-article">Modifications récentes</h1>
    <div class="sous-titre-portail">Les ${tries.length} derniers articles publiés.</div>
    <ul class="liste-articles liste-recent">
      ${items}
    </ul>
  `;

  return layout({ titre: 'Modifications récentes', base: '', contenu, classePage: 'page-recent' });
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

    <div id="article-du-jour-conteneur"></div>

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
  fs.mkdirSync(path.join(OUTPUT_DIR, 'institutions'), { recursive: true });
  copierDossier(ASSETS_DIR, path.join(OUTPUT_DIR, 'assets'));

  const parDomaine = {};
  const parInstitution = {};
  const compteurMecanismes = {};
  const compteurInstitutions = {};
  const indexRecherche = [];
  const entreesAvecArticle = [];

  for (const entree of rediges) {
    const article = chargerJSON(path.join(ARTICLES_DIR, `${entree.id}.json`), null);
    if (!article) {
      console.warn(`  ⚠️  ${entree.id} marqué "Rédigé" mais fichier article introuvable, ignoré.`);
      continue;
    }

    entree._dateGeneration = article.date_generation || null;
    entreesAvecArticle.push({ entree, article });

    (parDomaine[entree.domaine] = parDomaine[entree.domaine] || []).push(entree);

    if (entree.mecanisme_comique) {
      compteurMecanismes[entree.mecanisme_comique] = (compteurMecanismes[entree.mecanisme_comique] || 0) + 1;
    }

    for (const inst of entree.institutions_fictives || []) {
      (parInstitution[inst] = parInstitution[inst] || []).push(entree);
      compteurInstitutions[inst] = (compteurInstitutions[inst] || 0) + 1;
    }

    indexRecherche.push({
      id: entree.id,
      titre: entree.titre,
      domaine: entree.domaine,
      extrait: article.texte.slice(0, 200),
    });
  }

  // Pages articles, avec "voir aussi" (3 autres articles du même domaine)
  for (const { entree, article } of entreesAvecArticle) {
    const memeCategorieAutres = (parDomaine[entree.domaine] || []).filter((e) => e.id !== entree.id);
    const voirAussi = [];
    const depart = hashDeterministe(entree.id) % Math.max(1, memeCategorieAutres.length);
    for (let i = 0; i < Math.min(3, memeCategorieAutres.length); i++) {
      voirAussi.push(memeCategorieAutres[(depart + i) % memeCategorieAutres.length]);
    }

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'articles', `${entree.id}.html`),
      pageArticle(entree, article, voirAussi),
      'utf-8'
    );
  }

  for (const [domaine, entrees] of Object.entries(parDomaine)) {
    const slug = slugify(domaine);
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'categories', `${slug}.html`),
      pageCategorie(domaine, entrees),
      'utf-8'
    );
  }

  for (const [institution, entrees] of Object.entries(parInstitution)) {
    const slug = slugify(institution);
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'institutions', `${slug}.html`),
      pageInstitution(institution, entrees),
      'utf-8'
    );
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'index.html'),
    pageAccueil(parDomaine, rediges.length, registre.length),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'statistiques.html'),
    pageStatistiques(registre, rediges, parDomaine, compteurMecanismes, compteurInstitutions),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'recent.html'),
    pageRecent(rediges),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'search-index.json'),
    JSON.stringify(indexRecherche),
    'utf-8'
  );

  console.log(`\n✅ Site généré dans ${OUTPUT_DIR}`);
  console.log(`   ${rediges.length} page(s) article, ${Object.keys(parDomaine).length} portail(s), ${Object.keys(parInstitution).length} institution(s).`);
}

main();
