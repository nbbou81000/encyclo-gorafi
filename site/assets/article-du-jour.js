// article-du-jour.js — sélectionne un article "du jour" côté client, déterministe
// à partir de la date du visiteur. Change chaque jour sans nécessiter de rebuild.

(function () {
  function hashDeterministe(texte) {
    let h = 5381;
    for (let i = 0; i < texte.length; i++) {
      h = (h * 33) ^ texte.charCodeAt(i);
    }
    return Math.abs(h);
  }

  async function init() {
    const conteneur = document.getElementById('article-du-jour-conteneur');
    if (!conteneur) return;

    try {
      const base = document.body.dataset.base || '';
      const res = await fetch(`${base}search-index.json`);
      const data = await res.json();
      if (!data.length) return;

      const aujourdhui = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const index = hashDeterministe(aujourdhui) % data.length;
      const choix = data[index];

      conteneur.innerHTML = `
        <div class="article-du-jour">
          <div class="article-du-jour-label">Article du jour</div>
          <a href="${base}articles/${choix.id}.html" class="article-du-jour-titre">${choix.titre}</a>
          <p class="article-du-jour-extrait">${choix.extrait || ''}…</p>
        </div>
      `;
    } catch (e) {
      // Échec silencieux — le bloc reste vide, pas d'impact sur le reste de la page.
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
