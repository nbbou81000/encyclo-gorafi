// generate-articles.js — Encyclopédie Gorafi — rédaction des articles
// Uniquement Mistral (pay-as-you-go). Pas de fallback Gemini — simplifié
// après plusieurs allers-retours infructueux sur les quotas/modèles Gemini.
//
// - Timeout 20s par appel réseau, arrêt interne à 5h, commits périodiques,
//   reprenable (le registre maître fait office de manifest via "statut").
// - Toute erreur Mistral est loguée en détail (code + corps de réponse).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_MODEL = 'mistral-small-latest';

const REGISTRE_PATH = path.join(__dirname, 'registre-maitre.json');
const ARTICLES_DIR = path.join(__dirname, 'articles');

const MAX_RUNTIME_MS = 5 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20000;
const COMMIT_EVERY_N = 15;
const COMMIT_EVERY_MS = 4 * 60 * 1000;
const ECHECS_AVANT_REPORT = 3; // après N échecs d'affilée, on laisse cet article de côté et on passe au suivant

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function chargerJSON(p, defaut) {
  if (!fs.existsSync(p)) return defaut;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function sauvegarderJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

function reconstruireSite() {
  try {
    execSync('node site/build-site.js', { stdio: 'inherit' });
    return true;
  } catch (err) {
    console.warn(`  ⚠️  Reconstruction du site échouée (on continue, le prochain commit réessaiera) : ${err.message}`);
    return false;
  }
}

function commitProgress(message) {
  reconstruireSite();
  try {
    execSync('git config user.name "github-actions[bot]"');
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
    execSync('git add registre-maitre.json articles/ docs/');
    execSync(`git diff --staged --quiet || git commit -m "${message}"`, { shell: '/bin/bash' });
    execSync('git push');
  } catch (err) {
    console.warn(`  ⚠️  Commit/push échoué (on continue, rien n'est perdu localement) : ${err.message}`);
  }
}

function construirePrompts(entree) {
  const institutions = (entree.institutions_fictives || []).join(', ');
  const systemPrompt =
    "Tu es rédacteur pour une encyclopédie satirique en ligne, dans le ton pince-sans-rire du Gorafi. " +
    "La forme doit être ultra-sérieuse et académique (dates précises, institutions, chiffres, citations d'experts fictifs), " +
    "le fond complètement absurde ou d'une banalité du quotidien traitée avec une gravité exagérée. " +
    "RÈGLE ABSOLUE : n'utilise JAMAIS le nom d'une personnalité publique réelle, ni ne lui attribue de citation, action ou prise de position, " +
    "même fictive. Utilise uniquement des experts, institutions et personnages entièrement inventés. " +
    "Format exigé : un seul bloc de texte dense (pas de sous-titres, pas de listes), environ 150 mots, " +
    "commençant directement par une phrase de définition encyclopédique. Réponds uniquement avec le texte de l'article.";

  const userPrompt =
    `Titre : ${entree.titre}\n` +
    `Domaine : ${entree.domaine}\n` +
    `Objet de la moquerie : ${entree.objet_moquerie}\n` +
    `Mécanisme comique attendu : ${entree.mecanisme_comique}\n` +
    `Échelle temporelle : ${entree.echelle_temporelle}\n` +
    `Institutions fictives à mobiliser (ou t'en inspirer) : ${institutions || 'à inventer'}`;

  return { systemPrompt, userPrompt };
}

async function callMistral(systemPrompt, userPrompt) {
  try {
    const res = await fetchWithTimeout('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        temperature: 0.9,
        max_tokens: 400,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn(`  Mistral error ${res.status} : ${detail.slice(0, 300)}`);
      return { ok: false, raison: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const texte = data.choices?.[0]?.message?.content?.trim();
    if (!texte) {
      console.warn(`  Mistral a répondu mais le texte est vide : ${JSON.stringify(data).slice(0, 300)}`);
      return { ok: false, raison: 'réponse vide' };
    }
    return { ok: true, texte };
  } catch (err) {
    console.warn(`  Mistral timeout/erreur réseau : ${err.message}`);
    return { ok: false, raison: err.message };
  }
}

function compterMots(texte) {
  return texte.split(/\s+/).filter(Boolean).length;
}

async function main() {
  if (!MISTRAL_API_KEY) {
    console.error('Aucune clé API disponible (MISTRAL_API_KEY manquante).');
    process.exit(1);
  }

  const registre = chargerJSON(REGISTRE_PATH, []);
  if (!fs.existsSync(ARTICLES_DIR)) fs.mkdirSync(ARTICLES_DIR, { recursive: true });

  const aTraiter = registre.filter((e) => e.statut === 'Idée');
  console.log(`${aTraiter.length} article(s) en attente sur ${registre.length} au total.\n`);

  if (aTraiter.length === 0) {
    console.log('Rien à générer — tous les articles du registre sont déjà rédigés.');
    return;
  }

  const startTime = Date.now();
  let lastCommitTime = Date.now();
  let sinceLastCommit = 0;
  let genere = 0;
  let echecsSuite = 0;
  let echecs = 0;

  for (const [i, entree] of aTraiter.entries()) {
    if (Date.now() - startTime > MAX_RUNTIME_MS) {
      console.log('\n⏰ Limite de temps interne atteinte (5h), arrêt propre pour ce run.');
      break;
    }

    if (echecsSuite >= ECHECS_AVANT_REPORT) {
      console.log(`\n⚠️  ${ECHECS_AVANT_REPORT} échecs d'affilée — pause de 30s avant de continuer, au cas où c'est un problème transitoire.`);
      await sleep(30000);
      echecsSuite = 0;
    }

    console.log(`[${i + 1}/${aTraiter.length}] ${entree.id} — "${entree.titre}"`);

    const { systemPrompt, userPrompt } = construirePrompts(entree);
    const resultat = await callMistral(systemPrompt, userPrompt);

    if (!resultat.ok) {
      console.log(`  ✗ échec (${resultat.raison}), on retentera au prochain run`);
      echecs++;
      echecsSuite++;
    } else {
      const nbMots = compterMots(resultat.texte);
      sauvegarderJSON(path.join(ARTICLES_DIR, `${entree.id}.json`), {
        id: entree.id,
        titre: entree.titre,
        domaine: entree.domaine,
        texte: resultat.texte,
        nombre_mots: nbMots,
        modele_utilise: `mistral:${MISTRAL_MODEL}`,
        date_generation: new Date().toISOString(),
      });
      entree.statut = 'Rédigé';
      entree.nombre_mots = nbMots;
      console.log(`  ✓ généré (${nbMots} mots)`);
      genere++;
      echecsSuite = 0;
    }

    sauvegarderJSON(REGISTRE_PATH, registre);

    const timeToCommit = Date.now() - lastCommitTime > COMMIT_EVERY_MS;
    if (resultat.ok) sinceLastCommit++;
    if (sinceLastCommit >= COMMIT_EVERY_N || timeToCommit) {
      commitProgress(`Génération encyclopédie — ${genere} article(s) au total`);
      lastCommitTime = Date.now();
      sinceLastCommit = 0;
    }

    await sleep(1200);
  }

  commitProgress(`Run terminé — ${genere} article(s) générés`);

  console.log(`\n✅ Run terminé. ${genere} article(s) généré(s), ${echecs} échec(s)/report(s).`);
  const restants = registre.filter((e) => e.statut === 'Idée').length;
  console.log(
    restants > 0
      ? `Il reste ${restants} article(s) à générer — relance le workflow pour continuer.`
      : 'Tous les articles du registre sont générés.'
  );
}

main();
