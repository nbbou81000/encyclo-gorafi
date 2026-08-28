// search.js — recherche côté client + "article au hasard"
// Aucune dépendance, aucun appel réseau hors du fichier search-index.json statique.

(function () {
  let index = null;

  async function chargerIndex() {
    if (index) return index;
    const base = document.body.dataset.base || "";
    const res = await fetch(`${base}search-index.json`);
    index = await res.json();
    return index;
  }

  function normaliser(texte) {
    return texte
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function initRecherche() {
    const input = document.getElementById("recherche-input");
    const resultats = document.getElementById("recherche-resultats");
    if (!input || !resultats) return;

    input.addEventListener("input", async () => {
      const requete = normaliser(input.value.trim());
      if (requete.length < 2) {
        resultats.classList.remove("actif");
        resultats.innerHTML = "";
        return;
      }

      const data = await chargerIndex();
      const base = document.body.dataset.base || "";
      // Priorité aux correspondances de titre, puis complète avec les correspondances
      // trouvées uniquement dans l'extrait du corps de texte.
      const matchTitre = [];
      const matchExtrait = [];
      for (const entree of data) {
        if (normaliser(entree.titre).includes(requete)) {
          matchTitre.push(entree);
        } else if (entree.extrait && normaliser(entree.extrait).includes(requete)) {
          matchExtrait.push(entree);
        }
      }
      const matches = [...matchTitre, ...matchExtrait].slice(0, 12);

      if (matches.length === 0) {
        resultats.innerHTML = '<div style="padding:10px;color:#54595d;">Aucun article trouvé.</div>';
      } else {
        resultats.innerHTML = matches
          .map(
            (m) =>
              `<a href="${base}articles/${m.id}.html">${m.titre}<span class="domaine-tag"> — ${m.domaine}</span></a>`
          )
          .join("");
      }
      resultats.classList.add("actif");
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".site-search")) {
        resultats.classList.remove("actif");
      }
    });
  }

  function initHasard() {
    const boutons = document.querySelectorAll("[data-action='article-hasard']");
    if (boutons.length === 0) return;

    boutons.forEach((bouton) => {
      bouton.addEventListener("click", async (e) => {
        e.preventDefault();
        const data = await chargerIndex();
        if (data.length === 0) return;
        const base = document.body.dataset.base || "";
        const choix = data[Math.floor(Math.random() * data.length)];
        window.location.href = `${base}articles/${choix.id}.html`;
      });
    });
  }

  function copierViaFallback(texte) {
    // Méthode de secours synchrone (fonctionne même sans permission Clipboard API async)
    const input = document.createElement('textarea');
    input.value = texte;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.focus();
    input.select();
    let succes = false;
    try {
      succes = document.execCommand('copy');
    } catch (e) {
      succes = false;
    }
    document.body.removeChild(input);
    return succes;
  }

  function initPartage() {    const boutons = document.querySelectorAll("[data-action='partager']");
    if (boutons.length === 0) return;

    boutons.forEach((bouton) => {
      bouton.addEventListener("click", async () => {
        const titre = bouton.dataset.titre || document.title;
        const texte = bouton.dataset.texte || "";
        const url = window.location.href;
        const libelleOriginal = bouton.innerHTML;

        const afficherCopie = () => {
          bouton.innerHTML = '<span class="icone-partage">✓</span> Lien copié !';
          setTimeout(() => {
            bouton.innerHTML = libelleOriginal;
          }, 2000);
        };

        // 1. Partage natif (mobile, Safari récent)
        if (navigator.share) {
          try {
            await navigator.share({ title: titre, text: texte, url });
            return;
          } catch (e) {
            if (e && e.name === 'AbortError') return; // l'utilisateur a annulé le partage, rien à faire
            // sinon on tente les méthodes de secours ci-dessous
          }
        }

        // 2. Clipboard API asynchrone
        if (navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(url);
            afficherCopie();
            return;
          } catch (e) {
            // on tente la méthode de secours suivante
          }
        }

        // 3. Fallback synchrone (execCommand), fonctionne dans quasiment tous les contextes
        if (copierViaFallback(url)) {
          afficherCopie();
          return;
        }

        // 4. Dernier recours garanti visible : une boîte de dialogue avec le lien pré-sélectionné
        window.prompt('Copie ce lien :', url);
      });
    });
  }

  function initSidebarMobile() {
    const bouton = document.getElementById("sidebar-toggle-mobile");
    const overlay = document.getElementById("sidebar-overlay");
    if (!bouton) return;

    const fermer = () => document.body.classList.remove("sidebar-ouverte");

    bouton.addEventListener("click", () => {
      document.body.classList.toggle("sidebar-ouverte");
    });
    if (overlay) overlay.addEventListener("click", fermer);

    // Ferme la sidebar après un clic sur un lien (mobile), pour ne pas la laisser ouverte
    // en arrivant sur la nouvelle page.
    document.querySelectorAll(".sidebar-nav a").forEach((lien) => {
      lien.addEventListener("click", fermer);
    });
  }

  function initImpression() {
    document.querySelectorAll("[data-action='imprimer']").forEach((lien) => {
      lien.addEventListener("click", (e) => {
        e.preventDefault();
        window.print();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initRecherche();
    initHasard();
    initPartage();
    initSidebarMobile();
    initImpression();
  });
})();
