// generate-sujets.js — Encyclopédie Gorafi — alimentation du registre maître
// Uniquement Mistral (pay-as-you-go). Pas de fallback Gemini — simplifié
// après plusieurs allers-retours infructueux sur les quotas/modèles Gemini.
//
// - Timeout 20s par appel réseau, arrêt interne à 5h, commits périodiques,
//   reprenable (relance simplement le workflow).
// - Répartit les nouveaux sujets sur le domaine le moins fourni, MAIS met
//   temporairement de côté (pour ce run) tout domaine qui échoue plusieurs
//   fois d'affilée, pour ne jamais rester bloqué dessus pendant des heures.
// - Les erreurs Mistral sont TOUJOURS loguées en détail (code + corps de
//   réponse), plus de cas où l'erreur reste muette.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_MODEL = 'mistral-small-latest';

const REGISTRE_PATH = path.join(__dirname, 'registre-maitre.json');

const OBJECTIF_TOTAL = parseInt(process.env.OBJECTIF_TOTAL || '10000', 10);
const SUJETS_PAR_LOT = 5; // réduit de 8 à 5 pour rester confortablement sous max_tokens
const MAX_RUNTIME_MS = 5 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20000;
const COMMIT_EVERY_N_LOTS = 5;
const COMMIT_EVERY_MS = 4 * 60 * 1000;
const SEUIL_DOUBLON = 0.4;
const SEUIL_SURUSAGE = 0.15;
const ECHECS_AVANT_MISE_DE_COTE = 3; // après N échecs d'affilée sur un domaine, on le met de côté pour ce run

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

function domaineLeMoinsFourni(registre, domainesExclus) {
  const counts = Object.fromEntries(DOMAINES.map((d) => [d, 0]));
  for (const e of registre) {
    if (counts[e.domaine] !== undefined) counts[e.domaine]++;
  }
  const candidats = DOMAINES.filter((d) => !domainesExclus.has(d));
  if (candidats.length === 0) return null; // tous les domaines sont mis de côté
  return candidats.reduce((min, d) => (counts[d] < counts[min] ? d : min), candidats[0]);
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
    "Tu es un journaliste et encyclopédiste satirique expert, spécialisé dans l'humour absurde, institutionnel et pince-sans-rire (dans la lignée du site français \"Le Gorafi\"). Ton rôle est de générer des propositions de sujets pour une encyclopédie en ligne satirique.\n\n" +
    "Tu dois proposer des idées d'articles présentées avec un sérieux clinique et factuel face au ridicule absolu des situations.\n\n" +
    "RÈGLES D'OR INCONTOURNABLES (HARD CONSTRAINTS) :\n\n" +
    "1. ANCRAGE DANS LE RÉEL : Tu as l'autorisation absolue et l'obligation d'utiliser des noms de personnalités publiques réelles (politiques, acteurs, chanteurs), des marques existantes et de véritables institutions (ministères, entreprises célèbres, etc.). Le comique doit naître du décalage entre ces éléments réels et les situations absurdes dans lesquelles tu les places.\n" +
    "2. FORMAT DU TITRE (15 MOTS MAX) : Le titre doit être percutant et contenir UNE SEULE idée. BANNIS DÉFINITIVEMENT le format académique \"Titre : sous-titre à rallonge\". Utilise une phrase unique (souvent Sujet + Verbe + Chute).\n" +
    "3. INTERDICTION DES ACRONYMES INVENTÉS : N'ajoute JAMAIS de faux acronymes entre parenthèses après le nom d'une institution. Si tu utilises une vraie institution (ex: SNCF, OMS), tu peux utiliser son acronyme réel.\n" +
    "4. AUCUN FUTUR : L'échelle temporelle est strictement ancrée dans le présent ou le passé récent. Interdiction d'utiliser des dates dans le futur lointain ou des thèmes de science-fiction.\n" +
    "5. JARGON : N'utilise pas de vrais concepts pointus de philosophie universitaire ou de médecine réelle de manière hors-sujet. Le jargon doit être soit inventé et absurde, soit du langage bureaucratique/corporate réel détourné de son usage.\n" +
    "6. CONTRAINTES DE PARSING JSON :\n" +
    "   - \"objet_moquerie\" : DOIT être un groupe nominal très court en minuscules (ex: \"le retard des trains\"). JAMAIS de phrase complète.\n" +
    "   - \"mecanisme_comique\" et \"echelle_temporelle\" : Choisis EXACTEMENT UNE SEULE VALEUR issue de la liste fournie. Interdiction de combiner les valeurs.\n" +
    "   - \"institutions_fictives\" : ATTENTION, bien que cette clé s'appelle \"fictives\" pour des raisons techniques, tu dois y insérer les VRAIES institutions, marques ou organismes que tu as utilisés dans le titre (1 à 2 maximum).\n\n" +
    "EXEMPLES DE BONS TITRES POUR CALIBRER LE TON :\n" +
    "- \"Emmanuel Macron annonce un grand plan écologique pour planter au moins douze arbres\"\n" +
    "- \"La SNCF justifie ses retards de l'été par un alignement défavorable de Jupiter\"\n" +
    "- \"Le ministère de l'Intérieur lance un numéro vert pour les personnes ayant perdu le fil de la conversation\"\n" +
    "- \"Élection triomphale d'un lampadaire aux élections municipales de Tourcoing (2014)\"\n" +
    "- \"Apple rappelle des dizaines de milliers de petits amis défectueux\"\n\n" +
    "FORMAT DE SORTIE ATTENDU :\n" +
    "Tu dois répondre UNIQUEMENT par un objet JSON valide, sans aucun texte avant ou après.\n\n" +
    '{"sujets": [{"titre": "[Titre de l\'article, 15 mots maximum, pas de deux points \':\']", "objet_moquerie": "[Groupe nominal court en minuscules. 5 à 6 mots max. Pas de phrase]", "mecanisme_comique": "[CHOISIR EXACTEMENT UNE VALEUR PARMI : gravité déplacée sur du banal | logique absurde poussée à l\'extrême | jargon technique détourné | conflit disproportionné]", "echelle_temporelle": "[CHOISIR EXACTEMENT UNE VALEUR PARMI : événement daté ponctuel | phénomène de société durable | découverte scientifique | institution pérenne]", "institutions_fictives": ["[Nom de la 1ère institution (réelle ou absurde)]", "[Optionnel : Nom de la 2ème institution (réelle ou absurde)]"]}]}';

  const userPrompt =
    `Domaine : ${domaine}\n` +
    `Propose ${SUJETS_PAR_LOT} nouveaux sujets pour ce domaine.\n` +
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
        max_tokens: 3000, // relevé après troncature observée à 1200 (JSON coupé en plein milieu)
        response_format: { type: 'json_object' },
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
    const choix = data.choices?.[0];
    const parsed = parseJsonSafe(choix?.message?.content || '');
    if (!parsed?.sujets) {
      const tronque = choix?.finish_reason === 'length';
      console.warn(
        `  Mistral a répondu mais le JSON est invalide/vide${tronque ? ' (réponse TRONQUÉE — max_tokens trop bas)' : ''} : ${JSON.stringify(data).slice(0, 300)}`
      );
      return { ok: false, raison: tronque ? 'réponse tronquée (max_tokens)' : 'JSON invalide' };
    }
    return { ok: true, sujets: parsed.sujets };
  } catch (err) {
    console.warn(`  Mistral timeout/erreur réseau : ${err.message}`);
    return { ok: false, raison: err.message };
  }
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
  if (!MISTRAL_API_KEY) {
    console.error('Aucune clé API disponible (MISTRAL_API_KEY manquante).');
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

  const echecsConsecutifsParDomaine = Object.fromEntries(DOMAINES.map((d) => [d, 0]));
  const domainesMisDeCote = new Set();

  while (registre.length < OBJECTIF_TOTAL) {
    if (Date.now() - startTime > MAX_RUNTIME_MS) {
      console.log('\n⏰ Limite de temps interne atteinte (5h), arrêt propre pour ce run.');
      break;
    }

    const domaine = domaineLeMoinsFourni(registre, domainesMisDeCote);
    if (!domaine) {
      console.log('\n⚠️  Tous les domaines ont été mis de côté après échecs répétés — arrêt de ce run.');
      console.log('   Regarde le détail des erreurs ci-dessus pour comprendre pourquoi Mistral refuse ces requêtes.');
      break;
    }

    lot++;
    console.log(`[Lot ${lot}] Domaine le moins fourni (hors mis de côté) : ${domaine} (${registre.length} sujets au total)`);

    const { systemPrompt, userPrompt } = construirePrompts(domaine, registre);
    const resultat = await callMistral(systemPrompt, userPrompt);

    if (!resultat.ok) {
      echecsConsecutifsParDomaine[domaine]++;
      console.log(`  ✗ échec (${resultat.raison}) — ${echecsConsecutifsParDomaine[domaine]}/${ECHECS_AVANT_MISE_DE_COTE} sur ce domaine`);

      if (echecsConsecutifsParDomaine[domaine] >= ECHECS_AVANT_MISE_DE_COTE) {
        domainesMisDeCote.add(domaine);
        console.log(`  ⏸ "${domaine}" mis de côté pour le reste de ce run (${ECHECS_AVANT_MISE_DE_COTE} échecs d'affilée).`);
      }
    } else {
      echecsConsecutifsParDomaine[domaine] = 0; // reset le compteur d'échecs sur un succès
      const { ajoutes, rejetes } = filtrerEtAjouter(domaine, resultat.sujets, registre);
      console.log(`  ✓ ${ajoutes} sujet(s) ajouté(s), ${rejetes} rejeté(s) (doublon ou invalide)`);
      totalAjoutes += ajoutes;
      totalRejetes += rejetes;
    }

    sauvegarderJSON(REGISTRE_PATH, registre);
    lotsDepuisCommit++;

    const timeToCommit = Date.now() - lastCommitTime > COMMIT_EVERY_MS;
    if (lotsDepuisCommit >= COMMIT_EVERY_N_LOTS || timeToCommit) {
      commitProgress(`Registre — ${registre.length} sujets au total`);
      lastCommitTime = Date.now();
      lotsDepuisCommit = 0;
    }

    await sleep(1200);
  }

  commitProgress(`Run terminé — ${registre.length} sujets au total`);

  console.log(`\n✅ Run terminé. ${totalAjoutes} sujet(s) ajouté(s), ${totalRejetes} rejeté(s) sur ce run.`);
  if (domainesMisDeCote.size > 0) {
    console.log(`Domaines mis de côté ce run (à réinvestiguer) : ${[...domainesMisDeCote].join(', ')}`);
  }
  console.log(
    registre.length < OBJECTIF_TOTAL
      ? `${registre.length}/${OBJECTIF_TOTAL} — relance le workflow pour continuer.`
      : `Objectif de ${OBJECTIF_TOTAL} sujets atteint.`
  );
}

main();
