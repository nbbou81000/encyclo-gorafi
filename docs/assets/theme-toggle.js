// theme-toggle.js — bascule entre le thème "Wikipédia" (par défaut) et le thème "CelliA"
// Persisté en localStorage, appliqué le plus tôt possible pour éviter le flash.

(function () {
  const CLE_STOCKAGE = 'gorafi-theme-site';

  function libelleBouton(theme) {
    return theme === 'cellia' ? '🎨 Style : CelliA' : '🎨 Style : Wikipédia';
  }

  function appliquerTheme(theme) {
    document.documentElement.setAttribute('data-theme-site', theme);
    const bouton = document.getElementById('theme-toggle-btn');
    if (bouton) bouton.textContent = libelleBouton(theme);
  }

  function initToggle() {
    const bouton = document.getElementById('theme-toggle-btn');
    if (!bouton) return;

    const actuel = document.documentElement.getAttribute('data-theme-site') || 'wiki';
    bouton.textContent = libelleBouton(actuel);

    bouton.addEventListener('click', () => {
      const courant = document.documentElement.getAttribute('data-theme-site') || 'wiki';
      const suivant = courant === 'cellia' ? 'wiki' : 'cellia';
      appliquerTheme(suivant);
      try {
        localStorage.setItem(CLE_STOCKAGE, suivant);
      } catch (e) {
        // localStorage indisponible (navigation privée) — le choix ne sera juste pas mémorisé
      }
    });
  }

  document.addEventListener('DOMContentLoaded', initToggle);
})();
