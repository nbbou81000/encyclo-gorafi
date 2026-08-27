#!/usr/bin/env node
/**
 * check-doublon.js
 * Vérifie qu'un nouveau sujet ne recoupe pas un "objet de moquerie" déjà présent
 * dans le registre maître, et signale les institutions fictives sur-utilisées.
 *
 * Usage :
 *   node check-doublon.js "objet de moquerie candidat" ["Institution A" "Institution B"]
 *
 * Aucune dépendance externe — compatible zéro-install / GitHub Actions.
 */

const fs = require("fs");
const path = require("path");

const REGISTRE_PATH = path.join(__dirname, "registre-maitre.json");
const SEUIL_ALERTE = 0.4; // similarité Jaccard au-delà de laquelle on signale un risque de doublon
const SEUIL_SURUSAGE = 0.15; // une institution utilisée dans plus de 15% des articles est "sur-utilisée"

const STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du", "d", "l", "à", "au", "aux",
  "et", "ou", "en", "sur", "dans", "avec", "pour", "par", "qui", "que", "son",
  "sa", "ses", "ce", "cet", "cette", "ces", "se", "s", "n", "ne", "pas"
]);

function normaliser(texte) {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // retire les accents
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((mot) => mot.length > 1 && !STOPWORDS.has(mot));
}

function jaccard(setA, setB) {
  const a = new Set(setA);
  const b = new Set(setB);
  const intersection = new Set([...a].filter((mot) => b.has(mot)));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

function chargerRegistre() {
  if (!fs.existsSync(REGISTRE_PATH)) {
    console.error(`Registre introuvable : ${REGISTRE_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(REGISTRE_PATH, "utf-8"));
}

function verifierDoublon(objetCandidat, registre) {
  const motsCandidat = normaliser(objetCandidat);
  const risques = registre
    .map((entree) => {
      const motsExistant = normaliser(entree.objet_moquerie);
      const score = jaccard(motsCandidat, motsExistant);
      return { entree, score };
    })
    .filter((r) => r.score >= SEUIL_ALERTE)
    .sort((a, b) => b.score - a.score);

  return risques;
}

function analyserInstitutions(registre, institutionsCandidates) {
  const compteur = {};
  registre.forEach((entree) => {
    (entree.institutions_fictives || []).forEach((inst) => {
      compteur[inst] = (compteur[inst] || 0) + 1;
    });
  });

  const total = registre.length || 1;
  const surUtilisees = Object.entries(compteur)
    .filter(([, n]) => n / total >= SEUIL_SURUSAGE)
    .map(([nom, n]) => ({ nom, usage: `${n}/${total} articles (${((n / total) * 100).toFixed(1)}%)` }));

  const candidatesSurUtilisees = (institutionsCandidates || []).filter((inst) =>
    surUtilisees.some((s) => s.nom === inst)
  );

  return { surUtilisees, candidatesSurUtilisees };
}

function main() {
  const [, , objetCandidat, ...institutionsCandidates] = process.argv;

  if (!objetCandidat) {
    console.log('Usage : node check-doublon.js "objet de moquerie candidat" ["Institution A" "Institution B"]');
    process.exit(1);
  }

  const registre = chargerRegistre();

  console.log(`\nRegistre chargé : ${registre.length} articles.\n`);

  const risques = verifierDoublon(objetCandidat, registre);
  if (risques.length === 0) {
    console.log("✅ Aucun risque de doublon détecté sur l'objet de moquerie.");
  } else {
    console.log("⚠️  Risque de doublon détecté avec :");
    risques.forEach((r) => {
      console.log(
        `   - [${r.entree.id}] "${r.entree.titre}" (objet : "${r.entree.objet_moquerie}") — similarité ${(r.score * 100).toFixed(0)}%`
      );
    });
    console.log("\n→ Recommandation : reformuler l'objet de moquerie ou choisir un angle plus spécifique avant génération.");
  }

  const { surUtilisees, candidatesSurUtilisees } = analyserInstitutions(registre, institutionsCandidates);

  if (surUtilisees.length > 0) {
    console.log("\nInstitutions fictives déjà sur-utilisées dans le registre (à éviter de sur-solliciter) :");
    surUtilisees.forEach((s) => console.log(`   - ${s.nom} : ${s.usage}`));
  }

  if (candidatesSurUtilisees.length > 0) {
    console.log(`\n⚠️  Institution(s) proposée(s) déjà sur-utilisée(s) : ${candidatesSurUtilisees.join(", ")}`);
    console.log("→ Recommandation : privilégier une institution moins mobilisée pour cet article.");
  }

  console.log("");
  process.exit(risques.length > 0 ? 2 : 0);
}

main();
