// build-site.js — génère le site statique complet à partir de registre-maitre.json + articles/*.json.
// Zéro dépendance externe. Sortie dans /docs (compatible GitHub Pages sans config supplémentaire).
//
// Structure façon Wikipédia : barre latérale, onglets Article/Discussion/Historique,
// sommaire, bandeaux de maintenance, pages d'homonymie, vue impression.
// Historique/discussion/bandeaux sont des simulations déterministes (générées par template,
// pas par IA) — stables d'un build à l'autre pour un même article, sans coût ni aléa réel.

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

function formaterNombre(n) {
  return n.toLocaleString('fr-FR');
}

// Hash simple et déterministe (type djb2)
function hashDeterministe(texte) {
  let h = 5381;
  for (let i = 0; i < texte.length; i++) {
    h = (h * 33) ^ texte.charCodeAt(i);
  }
  return Math.abs(h);
}

// PRNG déterministe (mulberry32) — même graine = même séquence à chaque build,
// pour que l'historique/la discussion d'un article donné restent stables.
function creerPRNG(graine) {
  let a = graine >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function choisir(rng, liste) {
  return liste[Math.floor(rng() * liste.length)];
}

function compteurVuesFactice(id) {
  return 300 + (hashDeterministe(id) % 47700);
}

// --- Données factices pour l'historique / la discussion / les bandeaux ---

const FAUX_CONTRIBUTEURS = [
  'Marcel1974', 'JeanMichelDuBerry', 'WikiGardien_Local', 'Sophie.Correctrice', 'BotDeRelecture',
  'HistorienDuDimanche', 'Passant77', 'ModérateurBénévole12', 'FactCheckeuse_38', 'CuriosumMaximus',
  'RelecteurAnonyme', 'GardienDuTemple', 'IP-92.184.203.x (non connecté)', 'AgentAdministratifRetraité',
  'TontonWiki',
];

const RESUMES_MODIFICATION = [
  "Correction orthographe", "Ajout d'une source manquante", "Neutralisation du point de vue",
  "Reformulation de l'introduction", "Suppression d'un passage non sourcé", "Mise à jour des chiffres",
  "Wikification des liens internes", "Ajout de la catégorie manquante",
  "Corrections mineures de mise en forme", "Clarification d'une ambiguïté", "Typo",
];

const RESUMES_GUERRE_EDITION = (autre) => [
  `Annulation de la modification par ${autre} (non pertinent)`,
  `Restauration — voir page de discussion avant de modifier`,
  `Cessez de retirer cette information, elle est sourcée`,
  `Version neutre rétablie, merci de ne pas passer en force`,
  `Protection de la page suite à une guerre d'édition (durée : 3 jours)`,
];

const OUVERTURES_DISCUSSION = [
  "Cet article me semble manquer cruellement de sources primaires.",
  "Je propose la suppression de cet article, sujet non-admissible selon les critères habituels.",
  "Quelqu'un peut confirmer que cette information est vérifiée ?",
  "Le ton de cet article me paraît orienté, il faudrait neutraliser certains passages.",
  "Pourquoi cet article n'est-il toujours pas labellisé « Article de qualité » ?",
  "Je trouve la partie historique un peu courte, quelqu'un a des sources complémentaires ?",
];

const REPONSES_DISCUSSION = [
  "Je ne suis pas d'accord, le sujet est parfaitement admissible et bien documenté.",
  "Des sources existent, il suffit de chercher un peu avant de proposer une suppression.",
  "Pour ma part je trouve l'article tout à fait neutre, pas de souci ici.",
  "Discussion à archiver, aucun consensus ne se dégage après plusieurs mois.",
  "Entièrement d'accord avec le commentaire précédent.",
  "Je maintiens ma position, ce sujet manque clairement de notoriété encyclopédique.",
  "Ce genre de remarque revient à chaque fois, on ferme le débat ?",
];

const BANDEAUX_MAINTENANCE = [
  { titre: "Cet article ne cite pas suffisamment ses sources", icone: "⚠" },
  { titre: "Cet article est à recycler selon les conventions de style", icone: "♻" },
  { titre: "Cet article pourrait nécessiter des vérifications supplémentaires", icone: "❓" },
  { titre: "Cet article contient peut-être un travail inédit", icone: "📝" },
];

function genererHistorique(entree) {
  const rng = creerPRNG(hashDeterministe(entree.id + ':historique'));
  const nb = 4 + Math.floor(rng() * 6);
  const dateFinale = entree._dateGeneration ? new Date(entree._dateGeneration) : new Date();

  const revisions = [];
  let date = new Date(dateFinale);
  const guerreEdition = rng() < 0.35;
  const contribA = choisir(rng, FAUX_CONTRIBUTEURS);
  let contribB = choisir(rng, FAUX_CONTRIBUTEURS);
  while (contribB === contribA) contribB = choisir(rng, FAUX_CONTRIBUTEURS);

  for (let i = 0; i < nb; i++) {
    date = new Date(date.getTime() - (1 + Math.floor(rng() * 20)) * 86400000);
    const enGuerre = guerreEdition && i < 3;
    const contributeur = enGuerre ? (i % 2 === 0 ? contribA : contribB) : choisir(rng, FAUX_CONTRIBUTEURS);
    const resume = enGuerre
      ? choisir(rng, RESUMES_GUERRE_EDITION(i % 2 === 0 ? contribB : contribA))
      : choisir(rng, RESUMES_MODIFICATION);
    const delta = Math.floor(rng() * 300) - 100;
    revisions.push({ date, contributeur, resume, delta });
  }

  return revisions; // du plus récent au plus ancien (ordre naturel de construction ici, déjà décroissant)
}

function genererDiscussion(entree) {
  const rng = creerPRNG(hashDeterministe(entree.id + ':discussion'));
  const nb = 2 + Math.floor(rng() * 4);
  const dateFinale = entree._dateGeneration ? new Date(entree._dateGeneration) : new Date();

  const messages = [];
  let date = new Date(dateFinale.getTime() - 5 * 86400000);
  messages.push({
    auteur: choisir(rng, FAUX_CONTRIBUTEURS),
    date: new Date(date),
    texte: choisir(rng, OUVERTURES_DISCUSSION),
    niveau: 0,
  });

  for (let i = 1; i < nb; i++) {
    date = new Date(date.getTime() + (1 + Math.floor(rng() * 4)) * 86400000);
    messages.push({
      auteur: choisir(rng, FAUX_CONTRIBUTEURS),
      date: new Date(date),
      texte: choisir(rng, REPONSES_DISCUSSION),
      niveau: Math.min(i, 3),
    });
  }

  return messages;
}

function choisirBandeau(entree) {
  const rng = creerPRNG(hashDeterministe(entree.id + ':bandeau'));
  if (rng() < 0.3) return choisir(rng, BANDEAUX_MAINTENANCE);
  return null;
}

function motCleHomonymie(titre) {
  const stop = new Set([
    'le', 'la', 'les', 'l', 'un', 'une', 'des', 'de', 'du', 'd', 'et', 'ou', 'en',
    'sur', 'dans', 'avec', 'pour', 'par', 'au', 'aux', 'se', 'son', 'sa', 'ses',
  ]);
  const mots = titre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (const m of mots) {
    if (!stop.has(m) && m.length > 3) return m;
  }
  return null;
}

// --- Layout commun ---

function genererSidebar(base, parDomaine) {
  const portails = Object.keys(parDomaine)
    .sort()
    .map((d) => `<a href="${base}categories/${slugify(d)}.html">${echapperHTML(d)}</a>`)
    .join('\n');

  return `
  <aside class="sidebar" id="sidebar">
    <a class="site-logo" href="${base}index.html">${echapperHTML(SITE_NOM)}<span>${echapperHTML(SITE_SLOGAN)}</span></a>
    <nav class="sidebar-nav">
      <div class="sidebar-section">
        <div class="sidebar-section-titre">Navigation</div>
        <a href="${base}index.html">Accueil</a>
        <a href="${base}recent.html">Modifications récentes</a>
        <a href="#" data-action="article-hasard">Article au hasard</a>
        <a href="${base}statistiques.html">Statistiques</a>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-titre">Portails</div>
        ${portails}
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-titre">Outils</div>
        <button id="theme-toggle-btn" type="button">🎨 Style : Wikipédia</button>
        <a href="#" data-action="imprimer">🖨 Version imprimable</a>
      </div>
    </nav>
  </aside>
  <div class="sidebar-overlay" id="sidebar-overlay"></div>`;
}

function layout({ titre, base, contenu, classePage = '', description = '', parDomaine = {} }) {
  const desc = echapperHTML(description || SITE_SLOGAN);
  const imgOG = SITE_URL ? SITE_URL + 'assets/og-image.png' : base + 'assets/og-image.png';
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
  <meta property="og:image" content="${imgOG}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${imgOG}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&display=swap">
  <link rel="stylesheet" href="${base}assets/style.css">
  <link rel="stylesheet" href="${base}assets/style-cellia.css">
  <script>
    try {
      var t = localStorage.getItem('gorafi-theme-site');
      if (t === 'cellia') document.documentElement.setAttribute('data-theme-site', 'cellia');
    } catch (e) {}
  </script>
</head>
<body data-base="${base}" class="${classePage}">
  <div class="wiki-layout">
    ${genererSidebar(base, parDomaine)}
    <div class="contenu-zone">
      <div class="top-bar">
        <button class="sidebar-toggle-mobile" id="sidebar-toggle-mobile" type="button" aria-label="Menu">☰</button>
        <div class="site-search">
          <input id="recherche-input" type="text" placeholder="Rechercher un article inventé…" autocomplete="off">
          <div id="recherche-resultats" class="search-results"></div>
        </div>
      </div>
      <div class="page-wrap">
        <main class="contenu-principal">
          ${contenu}
        </main>
      </div>
      <footer class="site-footer">
        ${echapperHTML(SITE_NOM)} — tous les articles sont fictifs et générés à des fins satiriques. Aucune information ici n'est vraie, y compris probablement cette phrase.
      </footer>
    </div>
  </div>
  <script src="${base}assets/search.js"></script>
  <script src="${base}assets/theme-toggle.js"></script>
  ${classePage === 'page-accueil' ? `<script src="${base}assets/article-du-jour.js"></script>` : ''}
</body>
</html>`;
}

// --- Onglets Article / Discussion / Historique ---

function genererOnglets(entree, actif) {
  const b = '../';
  return `<div class="onglets-page">
    <a class="${actif === 'article' ? 'onglet-actif' : ''}" href="${b}articles/${entree.id}.html">Article</a>
    <a class="${actif === 'discussion' ? 'onglet-actif' : ''}" href="${b}discussion/${entree.id}.html">Discussion</a>
    <a class="${actif === 'historique' ? 'onglet-actif' : ''}" href="${b}historique/${entree.id}.html">Historique</a>
  </div>`;
}

// --- Page article ---

function pageArticle(entree, article, voirAussi, hatnote, parDomaine) {
  const slugDomaine = slugify(entree.domaine);
  const dateAffichee = new Date(article.date_generation || Date.now()).toLocaleDateString('fr-FR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const vues = compteurVuesFactice(entree.id);

  const paragraphes = article.texte
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => `<p>${echapperHTML(p)}</p>`)
    .join('\n');

  const institutionsListe = (entree.institutions_fictives || [])
    .map((inst) => `<a href="../institutions/${slugify(inst)}.html">${echapperHTML(inst)}</a>`)
    .join(', ');

  const voirAussiHTML = voirAussi.length
    ? `<div class="voir-aussi" id="voir-aussi">
        <div class="voir-aussi-titre">Voir aussi</div>
        <ul>
          ${voirAussi.map((v) => `<li><a href="../articles/${v.id}.html">${echapperHTML(v.titre)}</a></li>`).join('\n')}
        </ul>
      </div>`
    : '';

  const bandeau = choisirBandeau(entree);
  const bandeauHTML = bandeau
    ? `<div class="bandeau-maintenance"><span class="bandeau-icone">${bandeau.icone}</span> ${echapperHTML(bandeau.titre)}. <a href="../discussion/${entree.id}.html">Voir la discussion</a>.</div>`
    : '';

  const sommaireHTML = `
    <div class="sommaire">
      <div class="sommaire-titre">Sommaire</div>
      <ol>
        <li><a href="#resume">Résumé</a></li>
        ${institutionsListe ? '<li><a href="#institutions-citees">Institutions citées</a></li>' : ''}
        ${voirAussi.length ? '<li><a href="#voir-aussi">Voir aussi</a></li>' : ''}
        <li><a href="../discussion/${entree.id}.html">Discussion</a></li>
        <li><a href="../historique/${entree.id}.html">Historique des versions</a></li>
      </ol>
    </div>`;

  const description = article.texte.slice(0, 160).trim() + '…';

  const contenu = `
    ${genererOnglets(entree, 'article')}
    <div class="fil-ariane">
      <a href="../index.html">Accueil</a> &rsaquo;
      <a href="../categories/${slugDomaine}.html">Portail : ${echapperHTML(entree.domaine)}</a> &rsaquo;
      ${echapperHTML(entree.titre)}
    </div>

    ${hatnote || ''}
    ${bandeauHTML}

    <div class="infobox">
      <div class="infobox-titre">Fiche</div>
      <table>
        <tr><td class="cle">Domaine</td><td><a href="../categories/${slugDomaine}.html">${echapperHTML(entree.domaine)}</a></td></tr>
        <tr><td class="cle">Statut</td><td>Vérifié par nos services</td></tr>
        <tr><td class="cle">Dernière mise à jour</td><td>${dateAffichee}</td></tr>
        <tr><td class="cle">Longueur</td><td>${article.nombre_mots} mots</td></tr>
        <tr><td class="cle">Consultations</td><td>${formaterNombre(vues)}</td></tr>
        ${institutionsListe ? `<tr id="institutions-citees"><td class="cle">Institutions citées</td><td>${institutionsListe}</td></tr>` : ''}
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

    ${sommaireHTML}

    <div class="corps-article" id="resume">
      ${paragraphes}
    </div>

    <div class="categories-footer">
      Catégories :
      <a class="etiquette" href="../categories/${slugDomaine}.html">${echapperHTML(entree.domaine)}</a>
    </div>

    ${voirAussiHTML}
  `;

  return layout({ titre: entree.titre, base: '../', contenu, classePage: 'page-article', description, parDomaine });
}

// --- Page historique ---

function pageHistorique(entree, revisions, parDomaine) {
  const lignes = revisions
    .map((r) => {
      const date = r.date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const signe = r.delta >= 0 ? '+' : '';
      const classeDelta = r.delta >= 0 ? 'delta-positif' : 'delta-negatif';
      return `<li>
        <span class="hist-date">${date}</span>
        <span class="hist-contributeur">${echapperHTML(r.contributeur)}</span>
        <span class="hist-delta ${classeDelta}">(${signe}${r.delta} octets)</span>
        <span class="hist-resume">${echapperHTML(r.resume)}</span>
      </li>`;
    })
    .join('\n');

  const contenu = `
    ${genererOnglets(entree, 'historique')}
    <div class="fil-ariane">
      <a href="../index.html">Accueil</a> &rsaquo;
      <a href="../articles/${entree.id}.html">${echapperHTML(entree.titre)}</a> &rsaquo; Historique
    </div>
    <h1 class="titre-article">Historique des versions</h1>
    <div class="sous-titre-portail">« ${echapperHTML(entree.titre)} » — ${revisions.length} modification(s) répertoriée(s).</div>
    <ul class="liste-historique">
      ${lignes}
    </ul>
  `;

  return layout({ titre: `Historique : ${entree.titre}`, base: '../', contenu, classePage: 'page-historique', parDomaine });
}

// --- Page discussion ---

function pageDiscussion(entree, messages, parDomaine) {
  const lignes = messages
    .map((m) => {
      const date = m.date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
      return `<div class="message-discussion" style="margin-left:${m.niveau * 24}px;">
        <p>${echapperHTML(m.texte)}</p>
        <div class="signature-discussion">— ${echapperHTML(m.auteur)}, le ${date}</div>
      </div>`;
    })
    .join('\n');

  const contenu = `
    ${genererOnglets(entree, 'discussion')}
    <div class="fil-ariane">
      <a href="../index.html">Accueil</a> &rsaquo;
      <a href="../articles/${entree.id}.html">${echapperHTML(entree.titre)}</a> &rsaquo; Discussion
    </div>
    <h1 class="titre-article">Discussion : ${echapperHTML(entree.titre)}</h1>
    <div class="sous-titre-portail">Cette page est destinée aux discussions concernant l'amélioration de l'article.</div>
    <div class="fil-discussion">
      ${lignes}
    </div>
  `;

  return layout({ titre: `Discussion : ${entree.titre}`, base: '../', contenu, classePage: 'page-discussion', parDomaine });
}

// --- Page portail (catégorie) ---

function pageCategorie(domaine, entrees, parDomaine) {
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

  return layout({ titre: `Portail : ${domaine}`, base: '../', contenu, classePage: 'page-categorie', parDomaine });
}

// --- Page institution ---

function pageInstitution(nomInstitution, entrees, parDomaine) {
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

  return layout({ titre: nomInstitution, base: '../', contenu, classePage: 'page-institution', parDomaine });
}

// --- Page homonymie ---

function pageHomonymie(motCle, entrees, parDomaine) {
  const items = entrees
    .map((e) => `<li><a href="../articles/${e.id}.html">${echapperHTML(e.titre)}</a> — <span class="extrait">${echapperHTML(e.domaine)}</span></li>`)
    .join('\n');

  const contenu = `
    <div class="fil-ariane"><a href="../index.html">Accueil</a> &rsaquo; ${echapperHTML(motCle)} (homonymie)</div>
    <h1 class="titre-article">${echapperHTML(motCle)} (homonymie)</h1>
    <div class="sous-titre-portail">Cette page liste les articles associés à un titre similaire.</div>
    <ul class="liste-articles">
      ${items}
    </ul>
  `;

  return layout({ titre: `${motCle} (homonymie)`, base: '../', contenu, classePage: 'page-homonymie', parDomaine });
}

// --- Page statistiques ---

function pageStatistiques(registre, rediges, parDomaine, compteurMecanismes, compteurInstitutions) {
  const objectif = 10000;
  const pourcentage = Math.min(100, (rediges.length / objectif) * 100).toFixed(1);

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
    .map(([inst, n]) => `<tr><td><a href="institutions/${slugify(inst)}.html">${echapperHTML(inst)}</a></td><td>${n}</td></tr>`)
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

  return layout({ titre: 'Statistiques', base: '', contenu, classePage: 'page-statistiques', parDomaine });
}

// --- Page modifications récentes ---

function pageRecent(rediges, parDomaine) {
  const tries = [...rediges]
    .filter((e) => e._dateGeneration)
    .sort((a, b) => new Date(b._dateGeneration) - new Date(a._dateGeneration))
    .slice(0, 100);

  const items = tries
    .map((e) => {
      const date = new Date(e._dateGeneration).toLocaleDateString('fr-FR', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
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

  return layout({ titre: 'Modifications récentes', base: '', contenu, classePage: 'page-recent', parDomaine });
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

  return layout({ titre: 'Accueil', base: '', contenu, classePage: 'page-accueil', parDomaine });
}

// --- Build ---

function main() {
  const registre = chargerJSON(REGISTRE_PATH, []);
  const rediges = registre.filter((e) => e.statut === 'Rédigé');

  console.log(`Registre : ${registre.length} entrée(s), dont ${rediges.length} rédigée(s).`);

  viderEtCreerDossier(OUTPUT_DIR);
  for (const dossier of ['articles', 'categories', 'institutions', 'historique', 'discussion', 'homonymie']) {
    fs.mkdirSync(path.join(OUTPUT_DIR, dossier), { recursive: true });
  }
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

  // Groupes d'homonymie : sujets dont le titre partage le même mot-clé principal
  const groupesHomonymie = {};
  for (const { entree } of entreesAvecArticle) {
    const cle = motCleHomonymie(entree.titre);
    if (!cle) continue;
    (groupesHomonymie[cle] = groupesHomonymie[cle] || []).push(entree);
  }
  const hatnotesParId = {};
  for (const [cle, entrees] of Object.entries(groupesHomonymie)) {
    if (entrees.length < 2 || entrees.length > 8) continue; // trop peu ou trop générique
    const slug = slugify(cle);
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'homonymie', `${slug}.html`),
      pageHomonymie(cle, entrees, parDomaine),
      'utf-8'
    );
    for (const e of entrees) {
      hatnotesParId[e.id] = `<div class="hatnote">Cet article concerne un sujet partageant un titre proche d'autres articles. Pour les autres significations, voir <a href="../homonymie/${slug}.html">${echapperHTML(cle)} (homonymie)</a>.</div>`;
    }
  }

  // Pages articles + historique + discussion
  for (const { entree, article } of entreesAvecArticle) {
    const memeCategorieAutres = (parDomaine[entree.domaine] || []).filter((e) => e.id !== entree.id);
    const voirAussi = [];
    const depart = hashDeterministe(entree.id) % Math.max(1, memeCategorieAutres.length);
    for (let i = 0; i < Math.min(3, memeCategorieAutres.length); i++) {
      voirAussi.push(memeCategorieAutres[(depart + i) % memeCategorieAutres.length]);
    }

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'articles', `${entree.id}.html`),
      pageArticle(entree, article, voirAussi, hatnotesParId[entree.id], parDomaine),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'historique', `${entree.id}.html`),
      pageHistorique(entree, genererHistorique(entree), parDomaine),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'discussion', `${entree.id}.html`),
      pageDiscussion(entree, genererDiscussion(entree), parDomaine),
      'utf-8'
    );
  }

  for (const [domaine, entrees] of Object.entries(parDomaine)) {
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'categories', `${slugify(domaine)}.html`),
      pageCategorie(domaine, entrees, parDomaine),
      'utf-8'
    );
  }

  for (const [institution, entrees] of Object.entries(parInstitution)) {
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'institutions', `${slugify(institution)}.html`),
      pageInstitution(institution, entrees, parDomaine),
      'utf-8'
    );
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), pageAccueil(parDomaine, rediges.length, registre.length), 'utf-8');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'statistiques.html'), pageStatistiques(registre, rediges, parDomaine, compteurMecanismes, compteurInstitutions), 'utf-8');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'recent.html'), pageRecent(rediges, parDomaine), 'utf-8');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'search-index.json'), JSON.stringify(indexRecherche), 'utf-8');

  console.log(`\n✅ Site généré dans ${OUTPUT_DIR}`);
  console.log(`   ${rediges.length} article(s), ${Object.keys(parDomaine).length} portail(s), ${Object.keys(parInstitution).length} institution(s), ${Object.keys(groupesHomonymie).filter(k => groupesHomonymie[k].length >= 2 && groupesHomonymie[k].length <= 8).length} page(s) d'homonymie.`);
}

main();
