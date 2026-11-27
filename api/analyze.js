// Analyse d'une vidéo de danse : reçoit une image par compte + les points du corps,
// demande à Gemini le décryptage compte par compte en français, anglais et espagnol.
const { readBody, checkPassword } = require("../lib/auth");

const METHODE = `Tu es l'assistant pédagogique de Hamidine Thiam, professeur de salsa depuis 1998 (méthode Hamidine : Observe, Décompose, Reproduis, Danse en musique, Relève le défi).
Règles de la méthode, à respecter absolument :
- Salsa on1. On compte 1 2 3, pause, 5 6 7, pause. Les comptes 4 et 8 ne se comptent pas : ce sont des pauses.
- Le cavalier (leader) et la cavalière (follower) font des pas EN MIROIR :
  - Cavalier : pied GAUCHE en AVANT sur le 1, pied droit en arrière sur le 5.
  - Cavalière : pied DROIT en ARRIÈRE sur le 1, pied gauche en avant sur le 5.
- Ne donne JAMAIS à la cavalière une consigne du cavalier, ni l'inverse. Chaque phrase doit dire clairement à qui elle s'adresse.
- Sois concret : quel pied, quelle direction (avant, arrière, côté, sur place), quel bras est en haut ou en bas, quelle main pousse ou tire, qui tourne et dans quel sens. Ce qui intéresse l'élève, ce sont les ACTIONS des bras, des mains et les tours, pas la posture.
- Phrases courtes, simples, pour des élèves débutants à intermédiaires.
- Si tu n'es pas sûr de ce que tu vois (danseurs cachés, image floue, pied hors champ), dis-le au lieu d'inventer.`;

const FORMAT_TPL = `Réponds UNIQUEMENT avec un JSON valide, sans texte autour, de cette forme exacte :
{
  "figure_principale": {"LG": "..."},
  "comptes": [
    {
      "i": 0,
      "figure": {"LG": "..."},
      "pieds":  {"LG": "..."},
      "mains":  {"LG": "..."},
      "corps":  {"LG": "..."}
    }
  ],

  "incertain": {"LG": "..."}
}
- "comptes" contient exactement une entrée par image reçue, avec le même "i".
- "pieds" : quel pied, quelle direction, transfert de poids, déplacement sur la piste (max 15 mots par danseur).
- "mains" : position de CHAQUE bras et ce que fait chaque main, à la première personne (« je ») si un seul rôle est demandé, à la troisième personne (« il », « elle ») si c'est pour les deux. Exemples du style attendu : « Bras droit en bas, bras gauche levé au-dessus de sa tête », « Je pousse avec la main gauche pour la faire tourner », « Je lâche la main droite », « Elle passe sous mon bras gauche ». (max 18 mots par danseur)
- "corps" : CE QUI SE PASSE entre les deux danseurs : qui tourne, dans quel sens (à droite / à gauche), qui passe devant ou derrière, qui tourne autour de qui, changement de place, ouverture ou fermeture. Exemples : « Elle tourne à droite, je tourne à gauche », « Je tourne autour d'elle », « On change de place ». (max 15 mots par danseur)
- INTERDIT : les remarques de posture ou de style qui n'apprennent rien (« buste droit », « regard », « ancrage au sol », « bras souples », « corps stable »). Ne décris que les actions.
- Si le rôle demandé est « les deux danseurs », écris "pieds", "mains" et "corps" en deux parties : « Cavalier : … / Cavalière : … » (en anglais « Leader: … / Follower: … », en espagnol « Chico: … / Chica: … »).
- On ne t'envoie pas les comptes 4 et 8 (pauses) : le passage du 3 au 5 inclut la pause.
- "figure" : nom de la figure en cours (pas de base, tour à droite, cross body, enchufla, etc.).
- "incertain" : ce qui n'a pas pu être vu clairement, ou une chaîne vide dans les 3 langues si tout est clair.
- Pas de conseils généraux : seulement la description des actions, compte par compte.`;

const PRECISION = `Règles de précision (c'est le plus important) :
- Gauche et droite sont TOUJOURS celles du danseur lui-même, jamais celles de l'image. Si un danseur est face à la caméra, sa main droite est à gauche de l'image.
- Dis à chaque moment :
  - les prises de mains : quelle main du cavalier tient quelle main de la cavalière (ex. « main gauche du cavalier dans la main droite de la cavalière »), prise simple ou croisée, mains lâchées ;
  - la hauteur et la place de CHAQUE bras : le long du corps, à la taille, à hauteur d'épaule, au-dessus de la tête, derrière la nuque, derrière le dos, tendu, plié ;
  - les rotations : qui tourne, sens (vers sa droite / vers sa gauche), combien (quart de tour, demi-tour, tour complet), sous quel bras ;
  - les déplacements et les places : face à face, côte à côte, elle à sa droite, elle passe derrière lui, changement de place, orientation par rapport à la caméra ;
  - les pieds : pied d'appui, pas en avant / arrière / côté / sur place.
- Suis toujours le MÊME couple (le plus grand et le plus net à l'image), ignore les autres personnes.
- Si une image ne permet pas de voir (mains cachées, flou), dis-le clairement au lieu d'inventer.`;

const DETAIL_FORMAT = `Mission : décrire ce morceau de passage de façon EXTRÊMEMENT PRÉCISE, temps par temps.
${PRECISION}

Réponds UNIQUEMENT avec un JSON valide, sans texte autour :
{
  "figure": "nom probable de la figure en français, ou chaîne vide",
  "lignes": "une ligne par temps (et entre deux temps quand il se passe quelque chose), commençant par l'instant et le compte, ex. « 0,00 s · 1 : … ». Pour ROLE. Écris « Cavalier : … / Cavalière : … » quand les deux font quelque chose de différent. Retours à la ligne avec \\n. 40 mots maximum par ligne."
}`;

const PROMPT_FORMAT = `Mission : à partir de ce décryptage très précis, écris une description pour une IA qui génère des vidéos, afin qu'elle refasse exactement la même chorégraphie avec d'AUTRES danseurs.

Réponds UNIQUEMENT avec un JSON valide, sans texte autour :
{
  "figure": "nom de la figure en français (ex. Setenta), ou « Enchaînement » si incertain",
  "prompt": "la description en anglais"
}

Règles pour "prompt" (en anglais, 300 à 600 mots) :
- Commence par : « Photorealistic video, real people, not animated. » Puis la scène : un couple de danseurs de salsa, des personnes inventées (vêtements simples et neutres, ne décris jamais le visage de vraies personnes), une salle de danse lumineuse, caméra fixe en plan large, corps entiers visibles, pas de coupure, pas de zoom.
- Indique la musique (salsa à X BPM) et que chaque pas tombe sur le temps.
- Puis la chorégraphie sous forme de chronologie avec les secondes : « 0.0–0.9 s (counts 1-2-3): … ». Garde TOUS les détails du décryptage : prises de mains, hauteur des bras, sens et nombre de tours, places des danseurs. Utilise « the man's left hand », « the woman's right hand », « turns clockwise to her right », etc. Ne reprends pas les passages marqués incertains comme des certitudes : choisis le mouvement le plus logique pour cette figure.
- Termine par : « Smooth continuous movement, realistic hands and arms, correct anatomy, hands never merge or disappear. »`;
const LANGS = { fr: "français", en: "anglais", es: "espagnol" };
function formatFor(lg){
  return FORMAT_TPL.replace(/"LG"/g, `"${lg}"`) + `\n- Écris tous les textes en ${LANGS[lg]}, uniquement dans la clé "${lg}".`;
}


function extractJson(text) {
  const t = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = readBody(req);
  if (!checkPassword(body, res)) return;

  const lg = LANGS[body.lang] ? body.lang : "fr";

  // Traduction d'une analyse déjà faite (texte seulement : rapide et peu coûteux)
  if (body.action === "translate") {
    const from = LANGS[body.from] ? body.from : "fr";
    const data = body.data || {};
    const prompt = `Traduis du ${LANGS[from]} vers le ${LANGS[lg]} ce JSON d'explications de danse (salsa). Garde exactement la même structure et les mêmes "i". Pour chaque objet de texte, remplace la clé "${from}" par la clé "${lg}" avec la traduction. Termes : cavalier = ${lg === "en" ? "leader" : lg === "es" ? "chico" : "cavalier"}, cavalière = ${lg === "en" ? "follower" : lg === "es" ? "chica" : "cavalière"}. Réponds UNIQUEMENT avec le JSON.\n\n` + JSON.stringify(data);
    return runAI([{ text: prompt }], res);
  }


  // Recréer en vidéo IA, étape 1 : décryptage très précis d'un morceau (envoyé en parallèle par l'appli)
  if (body.action === "vpdetail") {
    const frames = Array.isArray(body.frames) ? body.frames.slice(0, 40) : [];
    if (!frames.length) return res.status(400).json({ error: "Aucune image reçue" });
    const roleTxt = body.role === "follower" ? "la cavalière" : body.role === "leader" ? "le cavalier" : "les deux danseurs";
    const parts = [{ text: `Danse : ${body.danse || "salsa on1"}. Tempo : ${Number(body.bpm) || 180} BPM.
Tu reçois ${frames.length} images dans l'ordre, plusieurs par temps : « 1 » = sur le temps 1, « 1 +1/3 » = un tiers du temps après le 1, etc. Chaque image a l'instant t en secondes depuis le début du passage. Les comptes 4 et 8 sont des pauses.
Regarde les images une par une ET l'enchaînement entre elles pour reconstituer le mouvement exact.` }];
    if (Array.isArray(body.hints) && body.hints.length)
      parts.push({ text: "Première analyse rapide (peut contenir des erreurs, vérifie avec les images) :\n" + body.hints.slice(0, 20).join("\n") });
    for (const f of frames) {
      parts.push({ text: `t=${Number(f.t).toFixed(2)} s · compte ${String(f.label || "").slice(0, 20)}` });
      if (f.image) parts.push({ inlineData: { mimeType: "image/jpeg", data: String(f.image).replace(/^data:image\/\w+;base64,/, "") } });
    }
    parts.push({ text: DETAIL_FORMAT.replace("ROLE", roleTxt) });
    return runAI(parts, res, 5000);
  }
  // Étape 2 : la description pour l'IA vidéo, à partir du texte (rapide)
  if (body.action === "vpprompt") {
    const txt = String(body.decryptage || "").slice(0, 20000);
    if (!txt) return res.status(400).json({ error: "Décryptage vide" });
    const parts = [{ text: `Danse : ${body.danse || "salsa on1"}. Tempo : ${Number(body.bpm) || 180} BPM. Durée : ${Number(body.duree) || 8} s. Figures repérées : ${String(body.figures || "").slice(0, 300)}.\n\nDécryptage :\n${txt}` },
      { text: PROMPT_FORMAT }];
    return runAI(parts, res, 4000);
  }

  const { role, danse, comptes } = body;
  if (!Array.isArray(comptes) || comptes.length === 0) return res.status(400).json({ error: "Aucune image reçue" });
  if (comptes.length > 48) return res.status(400).json({ error: "48 comptes maximum" });

  const roleTxt = role === "follower" ? "la cavalière (follower)" : role === "leader" ? "le cavalier (leader)" : "les deux danseurs";
  const parts = [{
    text: `Danse : ${danse || "salsa on1"}. Rôle à expliquer en priorité : ${roleTxt}.
Tu reçois ${comptes.length} images, une par compte, dans l'ordre. Pour chaque image : son index i, son numéro de compte (1 à 8), le numéro de mesure, l'instant dans la vidéo, et les positions des chevilles, poignets et hanches détectées (x et y de 0 à 1, x vers la droite, y vers le bas ; danseur A = le plus à gauche de l'image, danseur B = le plus à droite).
Utilise l'enchaînement des images pour comprendre les mouvements entre deux comptes.`,
  }];
  for (const c of comptes) {
    parts.push({ text: `i=${c.i} · compte ${c.n} · mesure ${c.m} · t=${Number(c.t).toFixed(2)} s · points=${JSON.stringify(c.points || {})}` });
    if (c.image) parts.push({ inlineData: { mimeType: "image/jpeg", data: String(c.image).replace(/^data:image\/\w+;base64,/, "") } });
  }
  parts.push({ text: formatFor(lg) });

  return runAI(parts, res);
};

async function runAI(parts, res, maxTokens) {
  // Fournisseur d'IA : Claude ou Gemini (variable AI_PROVIDER), l'autre sert de secours s'il a une clé
  const hasClaude = !!(process.env.ANTHROPIC_API_KEY || "").trim();
  const hasGemini = !!(process.env.GEMINI_API_KEY || "").trim();
  const wanted = (process.env.AI_PROVIDER || (hasClaude ? "claude" : "gemini")).toLowerCase();
  const order = (wanted === "claude" ? ["claude", "gemini"] : ["gemini", "claude"])
    .filter((p) => (p === "claude" ? hasClaude : hasGemini));
  if (!order.length) return res.status(500).json({ error: "Clé manquante : ajoute ANTHROPIC_API_KEY ou GEMINI_API_KEY dans Vercel." });

  const errors = [];
  for (const provider of order) {
    try {
      const text = provider === "claude" ? await askClaude(parts, maxTokens) : await askGemini(parts);
      return res.status(200).json(extractJson(text));
    } catch (e) {
      errors.push(`${provider === "claude" ? "Claude" : "Gemini"} : ${e.message}`);
    }
  }
  return res.status(503).json({ error: "L'IA est très demandée en ce moment. Réessaie dans quelques minutes. (" + errors.join(" | ") + ")" });
}

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const BUSY = [429, 500, 503, 529];

async function askGemini(parts) {
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: METHODE }] },
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json" },
  });
  const main = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const backup = process.env.GEMINI_FALLBACK || "gemini-flash-lite-latest";
  const plan = [[main, 2], ...(backup !== main ? [[backup, 2]] : [])];
  let last = "erreur";
  for (const [model, tries] of plan) {
    for (let i = 0; i < tries; i++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": (process.env.GEMINI_API_KEY || "").trim() },
        body: payload,
      }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
      const data = await r.json().catch(() => ({}));
      if (r.ok) return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      last = data?.error?.message || `erreur ${r.status}`;
      if (r.status && !BUSY.includes(r.status)) { const e = new Error(last); e.fatal = true; throw e; }
      await wait(1500 * (i + 1));
    }
  }
  throw new Error(last);
}

async function askClaude(parts, maxTokens) {
  // Même contenu que pour Gemini, converti au format Claude
  const content = parts.map((p) => p.inlineData
    ? { type: "image", source: { type: "base64", media_type: p.inlineData.mimeType, data: p.inlineData.data } }
    : { type: "text", text: p.text });
  const body = JSON.stringify({
    model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
    max_tokens: maxTokens || 16000,
    system: METHODE,
    messages: [{ role: "user", content }],
  });
  let last = "erreur";
  for (let i = 0; i < 4; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": (process.env.ANTHROPIC_API_KEY || "").trim(),
        "anthropic-version": "2023-06-01",
      },
      body,
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
    const data = await r.json().catch(() => ({}));
    if (r.ok) return (data.content || []).map((b) => b.text || "").join("");
    last = data?.error?.message || `erreur ${r.status}`;
    if (r.status && !BUSY.includes(r.status)) { const e = new Error(last); e.fatal = true; throw e; }
    // limite de débit : on attend le temps demandé par Anthropic (30 s maximum)
    const ra = Number(r.headers?.get?.("retry-after")) || 0;
    await wait(Math.min(30000, Math.max(ra * 1000, 4000 * (i + 1))));
  }
  throw new Error(last);
}

module.exports.extractJson = extractJson;
