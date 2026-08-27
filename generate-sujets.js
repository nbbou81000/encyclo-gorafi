// generate-sujets.js — Encyclopédie Gorafi — alimentation du registre maître
// Équivalent de buildTermList.js pour Geek Almanac : génère de NOUVEAUX sujets
// (pas les articles eux-mêmes) via LLM, filtrés par le contrôle anti-doublon,
// et les ajoute au registre en statut "Idée" pour que generate-articles.js
// les rédige ensuite.
//
// Même pattern de sécurité que generate-articles.js :
// - Timeout 12s par appel réseau, arrêt interne à 5h, commits périodiques,
//   reprenable (relance simplement le workflow).
// - Répartit les nouveaux sujets sur le domaine le moins fourni à chaque
//   passe, pour respecter le pilier "diversité".

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MISTRAL_MODEL = 'mistral-small-latest';
const GEMINI_MODEL = 'gemini-flash-latest';

const REGISTRE_PATH = path.join(__dirname, 'registre-maitre.json');

const OBJECTIF_TOTAL = parseInt(process.env.OBJECTIF_TOTAL || '10000', 10);
const SUJETS_PAR_LOT = 8;
const MAX_RUNTIME_MS = 5 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20000; // plus long que generate-articles.js : génération JSON de 8 sujets d'un coup
const COMMIT_EVERY_N_LOTS = 5;
const COMMIT_EVERY_MS = 4 * 60 * 1000;
const SEUIL_DOUBLON = 0.4;
const SEUIL_SURUSAGE = 0.15;

const DOMAINES = [
  'Histoire',
  'Sciences & Technologies',
  'Société',
  'Politique Institutionnelle',
  'Économie',
  'Culture & Arts',
  'Santé & Biologie',
  'Sports',
  'Géographie',
  'Philosophie & Concepts',
];

const STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'd', 'l', 'à', 'au', 'aux',
  'et', 'ou', 'en', 'sur', 'dans', 'avec', 'pour', 'par', 'qui', 'que', 'son',
  'sa', 'ses', 'ce', 'cet', 'cette', 'ces', 'se', 's', 'n', 'ne', 'pas',
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normaliser(texte) {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((mot) => mot.length > 1 && !STOPWORDS.has(mot));
}

function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const inter = new Set([...setA].filter((m) => setB.has(m)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : inter.size / union.size;
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

function commitProgress(message) {
  try {
    execSync('git config user.name "github-actions[bot]"');
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
    execSync('git add registre-maitre.json');
    execSync(`git diff --staged --quiet || git commit -m "${message}"`, { shell: '/bin/bash' });
    execSync('git push');
  } catch (err) {
    console.warn(`  ⚠️  Commit/push échoué (on continue) : ${err.message}`);
  }
}

function prochainId(registre) {
  const max = registre.reduce((acc, e) => {
    const n = parseInt(e.id.split('-')[1], 10);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return max;
}

function domaineLeMoinsFourni(registre) {
  const counts = Object.fromEntries(DOMAINES.map((d) => [d, 0]));
  for (const e of registre) {
    if (counts[e.domaine] !== undefined) counts[e.domaine]++;
  }
  return DOMAINES.reduce((min, d) => (counts[d] < counts[min] ? d : min), DOMAINES[0]);
}

function institutionsSurUtilisees(registre) {
  const compteur = {};
  registre.forEach((e) => {
    (e.institutions_fictives || []).forEach((i) => {
      compteur[i] = (compteur[i] || 0) + 1;
    });
  });
  const total = registre.length || 1;
  return new Set(
    Object.entries(compteur)
      .filter(([, n]) => n / total >= SEUIL_SURUSAGE)
      .map(([nom]) => nom)
  );
}

function construirePrompts(domaine, registre) {
  const exemplesRecents = registre
    .filter((e) => e.domaine === domaine)
    .slice(-15)
    .map((e) => `- ${e.objet_moquerie}`)
    .join('\n');

  const systemPrompt =
    "Tu es le comité éditorial d'une encyclopédie satirique en ligne, ton du Gorafi (forme ultra-sérieuse et académique, fond absurde ou banal traité avec gravité exagérée). " +
    "On te demande de PROPOSER de nouveaux sujets d'articles (pas de les rédiger). " +
    "RÈGLE ABSOLUE : aucun sujet ne doit nommer ou mettre en scène une personnalité publique réelle. Uniquement des institutions, experts et situations entièrement inventés, ancrés dans des micro-agacements ou rituels sociaux français reconnaissables (comme le ferait Le Gorafi), pas de l'absurde totalement déconnecté du réel. " +
    "Réponds UNIQUEMENT en JSON valide, sans texte avant/après, sous la forme exacte : " +
    '{"sujets": [{"titre": "...", "objet_moquerie": "...", "mecanisme_comique": "gravité déplacée sur du banal | logique absurde poussée à l\'extrême | jargon technique détourné | conflit disproportionné", "echelle_temporelle": "événement daté ponctuel | phénomène de société durable | découverte scientifique | institution pérenne", "institutions_fictives": ["..."]}]}';

  const userPrompt =
    `Domaine : ${domaine}\n` +
    `Propose ${SUJETS_PAR_LOT} nouveaux sujets pour ce domaine.\n` +
    `"objet_moquerie" doit être précis et granulaire (pas "les transports" mais "l'attente sur le quai RER un jour de grève").\n` +
    (exemplesRecents
      ? `Sujets déjà utilisés dans ce domaine, À NE PAS RÉPÉTER ni reformuler :\n${exemplesRecents}\n`
      : '');

  return { systemPrompt, userPrompt };
}

function parseJsonSafe(texte) {
  try {
    const nettoye = texte.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
    return JSON.parse(nettoye);
  } catch {
    return null;
  }
}

async function callMistral(systemPrompt, userPrompt) {
  try {
    const res = await fetchWithTimeout('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MISTRAL_API_KEY}` },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        temperature: 1.0,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
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
    const parsed = parseJsonSafe(data.choices?.[0]?.message?.content || '');
    if (!parsed?.sujets) return { ok: false };
    return { ok: true, sujets: parsed.sujets };
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
        generationConfig: { responseMimeType: 'application/json', temperature: 1.0, maxOutputTokens: 1200 },
      }),
    });
    if (!res.ok) {
      if (res.status !== 429) console.warn(`  Gemini error ${res.status}`);
      return { ok: false };
    }
    const data = await res.json();
    const texte = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = parseJsonSafe(texte);
    if (!parsed?.sujets) return { ok: false };
    return { ok: true, sujets: parsed.sujets };
  } catch (err) {
    console.warn(`  Gemini timeout/erreur : ${err.message}`);
    return { ok: false };
  }
}

async function proposerSujets(domaine, registre) {
  const { systemPrompt, userPrompt } = construirePrompts(domaine, registre);

  const viaMistral = await callMistral(systemPrompt, userPrompt);
  if (viaMistral.ok) return { sujets: viaMistral.sujets, provider: 'mistral' };

  console.warn('  ⚠️  Mistral indisponible, bascule sur Gemini...');
  const viaGemini = await callGemini(systemPrompt, userPrompt);
  if (viaGemini.ok) return { sujets: viaGemini.sujets, provider: 'gemini' };

  return { sujets: [], provider: 'skip' };
}

function filtrerEtAjouter(domaine, propositions, registre) {
  const surUtilisees = institutionsSurUtilisees(registre);
  let prochainNum = prochainId(registre);
  let ajoutes = 0;
  let rejetes = 0;

  for (const prop of propositions) {
    if (!prop?.titre || !prop?.objet_moquerie) {
      rejetes++;
      continue;
    }

    const motsCandidat = normaliser(prop.objet_moquerie);
    const doublon = registre.some((e) => jaccard(motsCandidat, normaliser(e.objet_moquerie)) >= SEUIL_DOUBLON);
    if (doublon) {
      console.log(`    ⏭ doublon écarté : "${prop.objet_moquerie}"`);
      rejetes++;
      continue;
    }

    const institutions = (prop.institutions_fictives || []).filter((i) => !surUtilisees.has(i));
    const institutionsFinales = institutions.length > 0 ? institutions : prop.institutions_fictives || [];

    prochainNum++;
    const id = `GOR-${String(prochainNum).padStart(5, '0')}`;

    registre.push({
      id,
      titre: prop.titre,
      domaine,
      objet_moquerie: prop.objet_moquerie,
      mecanisme_comique: prop.mecanisme_comique || 'gravité déplacée sur du banal',
      echelle_temporelle: prop.echelle_temporelle || 'phénomène de société durable',
      institutions_fictives: institutionsFinales,
      statut: 'Idée',
      nombre_mots: 0,
    });
    ajoutes++;
  }

  return { ajoutes, rejetes };
}

async function main() {
  if (!MISTRAL_API_KEY && !GEMINI_API_KEY) {
    console.error('Aucune clé API disponible (ni MISTRAL_API_KEY ni GEMINI_API_KEY).');
    process.exit(1);
  }

  const registre = chargerJSON(REGISTRE_PATH, []);
  console.log(`Registre actuel : ${registre.length}/${OBJECTIF_TOTAL} sujets.\n`);

  if (registre.length >= OBJECTIF_TOTAL) {
    console.log('Objectif déjà atteint — rien à générer.');
    return;
  }

  const startTime = Date.now();
  let lastCommitTime = Date.now();
  let lotsDepuisCommit = 0;
  let totalAjoutes = 0;
  let totalRejetes = 0;
  let lot = 0;

  while (registre.length < OBJECTIF_TOTAL) {
    if (Date.now() - startTime > MAX_RUNTIME_MS) {
      console.log('\n⏰ Limite de temps interne atteinte (5h), arrêt propre pour ce run.');
      break;
    }

    lot++;
    const domaine = domaineLeMoinsFourni(registre);
    console.log(`[Lot ${lot}] Domaine le moins fourni : ${domaine} (${registre.length} sujets au total)`);

    let provider = 'skip';
    try {
      const { sujets, provider: usedProvider } = await proposerSujets(domaine, registre);
      provider = usedProvider;

      if (sujets.length === 0) {
        console.log('  ✗ aucune proposition reçue (échec Mistral et Gemini)');
      } else {
        const { ajoutes, rejetes } = filtrerEtAjouter(domaine, sujets, registre);
        console.log(`  ✓ ${ajoutes} sujet(s) ajouté(s) via ${provider}, ${rejetes} rejeté(s) (doublon ou invalide)`);
        totalAjoutes += ajoutes;
        totalRejetes += rejetes;
      }
    } catch (err) {
      console.error(`  ✗ erreur : ${err.message}`);
    }

    sauvegarderJSON(REGISTRE_PATH, registre);
    lotsDepuisCommit++;

    const timeToCommit = Date.now() - lastCommitTime > COMMIT_EVERY_MS;
    if (lotsDepuisCommit >= COMMIT_EVERY_N_LOTS || timeToCommit) {
      commitProgress(`Registre — ${registre.length} sujets au total`);
      lastCommitTime = Date.now();
      lotsDepuisCommit = 0;
    }

    if (provider === 'mistral') await sleep(1200);
    else if (provider === 'gemini') await sleep(4500);
    else await sleep(300);
  }

  commitProgress(`Run terminé — ${registre.length} sujets au total`);

  console.log(`\n✅ Run terminé. ${totalAjoutes} sujet(s) ajouté(s), ${totalRejetes} rejeté(s) sur ce run.`);
  console.log(
    registre.length < OBJECTIF_TOTAL
      ? `${registre.length}/${OBJECTIF_TOTAL} — relance le workflow pour continuer.`
      : `Objectif de ${OBJECTIF_TOTAL} sujets atteint.`
  );
}

main();
