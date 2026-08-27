// Encyclopédie Gorafi — génération des articles
// Mistral en primaire, Gemini en secours.
// Pattern repris de generateEncyclopedia.js (Geek Almanac) :
// - Timeout de 12s sur CHAQUE appel réseau
// - Arrêt interne à 5h (buffer d'1h avant la limite dure de 6h GitHub)
// - Commits automatiques périodiques (tous les 15 articles ET toutes les ~4 minutes)
// - REPRENABLE : relance simplement le workflow, il continue là où il s'est arrêté
//   (le registre maître fait déjà office de manifest via le champ "statut")

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MISTRAL_MODEL = 'mistral-small-latest';
const GEMINI_MODEL = 'gemini-flash-latest';

const REGISTRE_PATH = path.join(__dirname, 'registre-maitre.json');
const ARTICLES_DIR = path.join(__dirname, 'articles');

const MAX_RUNTIME_MS = 5 * 60 * 60 * 1000; // 5h — buffer de sécurité avant la limite dure de 6h
const FETCH_TIMEOUT_MS = 12000; // aucun appel réseau ne peut bloquer plus de 12s
const COMMIT_EVERY_N = 15;
const COMMIT_EVERY_MS = 4 * 60 * 1000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Wrapper fetch avec timeout — sécurité anti-blocage
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

function commitProgress(message) {
  try {
    execSync('git config user.name "github-actions[bot]"');
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
    execSync('git add registre-maitre.json articles/');
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
      if (res.status !== 429) console.warn(`  Mistral error ${res.status}`);
      return { ok: false };
    }
    const data = await res.json();
    const texte = data.choices?.[0]?.message?.content?.trim();
    if (!texte) return { ok: false };
    return { ok: true, texte };
  } catch (err) {
    console.warn(`  Mistral timeout/erreur : ${err.message}`);
    return { ok: false };
  }
}

async function callGemini(systemPrompt, userPrompt) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.9 },
      }),
    });
    if (!res.ok) {
      if (res.status !== 429) console.warn(`  Gemini error ${res.status}`);
      return { ok: false };
    }
    const data = await res.json();
    const texte = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!texte) return { ok: false };
    return { ok: true, texte };
  } catch (err) {
    console.warn(`  Gemini timeout/erreur : ${err.message}`);
    return { ok: false };
  }
}

async function genererArticle(entree) {
  const { systemPrompt, userPrompt } = construirePrompts(entree);

  const viaMistral = await callMistral(systemPrompt, userPrompt);
  if (viaMistral.ok) return { texte: viaMistral.texte, provider: 'mistral' };

  console.warn('  ⚠️  Mistral indisponible, bascule sur Gemini...');
  const viaGemini = await callGemini(systemPrompt, userPrompt);
  if (viaGemini.ok) return { texte: viaGemini.texte, provider: 'gemini' };

  return { texte: null, provider: 'skip' };
}

function compterMots(texte) {
  return texte.split(/\s+/).filter(Boolean).length;
}

async function main() {
  if (!MISTRAL_API_KEY && !GEMINI_API_KEY) {
    console.error('Aucune clé API disponible (ni MISTRAL_API_KEY ni GEMINI_API_KEY).');
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
  let echecs = 0;

  for (const [i, entree] of aTraiter.entries()) {
    if (Date.now() - startTime > MAX_RUNTIME_MS) {
      console.log('\n⏰ Limite de temps interne atteinte (5h), arrêt propre pour ce run.');
      break;
    }

    console.log(`[${i + 1}/${aTraiter.length}] ${entree.id} — "${entree.titre}"`);

    let provider = 'skip';
    try {
      const { texte, provider: usedProvider } = await genererArticle(entree);
      provider = usedProvider;

      if (!texte) {
        console.log('  ✗ échec Mistral ET Gemini, on retentera au prochain run');
        echecs++;
      } else {
        const nbMots = compterMots(texte);
        sauvegarderJSON(path.join(ARTICLES_DIR, `${entree.id}.json`), {
          id: entree.id,
          titre: entree.titre,
          domaine: entree.domaine,
          texte,
          nombre_mots: nbMots,
          modele_utilise: provider,
          date_generation: new Date().toISOString(),
        });
        entree.statut = 'Rédigé';
        entree.nombre_mots = nbMots;
        console.log(`  ✓ généré via ${provider} (${nbMots} mots)`);
        genere++;
        sinceLastCommit++;
      }
    } catch (err) {
      console.error(`  ✗ erreur : ${err.message}`);
      echecs++;
    }

    sauvegarderJSON(REGISTRE_PATH, registre);

    const timeToCommit = Date.now() - lastCommitTime > COMMIT_EVERY_MS;
    if (sinceLastCommit >= COMMIT_EVERY_N || timeToCommit) {
      commitProgress(`Génération encyclopédie — ${genere} article(s) au total`);
      lastCommitTime = Date.now();
      sinceLastCommit = 0;
    }

    // Throttle adapté au provider réellement utilisé (repris du pattern Geek Almanac) :
    // Mistral (primaire) → pause courte ; Gemini (secours) → pause plus longue
    if (provider === 'mistral') await sleep(1200);
    else if (provider === 'gemini') await sleep(4500);
    else await sleep(300);
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
