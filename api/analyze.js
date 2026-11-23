// Analyse d'une vidéo de danse : reçoit une image par compte + les points du corps,
// demande à Gemini le décryptage compte par compte en français, anglais et espagnol.
const { readBody, checkPassword } = require("../lib/auth");

const METHODE = `Tu es l'assistant pédagogique de Hamidine Thiam, professeur de salsa depuis 1998 (méthode Hamidine : Observe, Décompose, Reproduis, Danse en musique, Relève le défi).
Règles de la méthode, à respecter absolument :
- Salsa on1, comptes 1 2 3 (pause sur 4) 5 6 7 (pause sur 8).
- Cavalier (leader) : pied gauche en avant sur le 1. Cavalière (follower) : pied droit en arrière sur le 1.
- Phrases courtes, simples, pour des élèves débutants à intermédiaires.
- Si tu n'es pas sûr de ce que tu vois (danseurs cachés, image floue, pied hors champ), dis-le au lieu d'inventer.`;

const FORMAT = `Réponds UNIQUEMENT avec un JSON valide, sans texte autour, de cette forme exacte :
{
  "figure_principale": {"fr": "...", "en": "...", "es": "..."},
  "comptes": [
    {
      "i": 0,
      "figure": {"fr": "...", "en": "...", "es": "..."},
      "pieds":  {"fr": "...", "en": "...", "es": "..."},
      "mains":  {"fr": "...", "en": "...", "es": "..."},
      "corps":  {"fr": "...", "en": "...", "es": "..."}
    }
  ],
  "conseils": {
    "bien":     {"fr": "...", "en": "...", "es": "..."},
    "erreur":   {"fr": "...", "en": "...", "es": "..."},
    "exercice": {"fr": "...", "en": "...", "es": "..."}
  },
  "incertain": {"fr": "...", "en": "...", "es": "..."}
}
- "comptes" contient exactement une entrée par image reçue, avec le même "i".
- "pieds" : quel pied, quelle direction, transfert de poids, déplacement sur la piste (max 15 mots).
- "mains" : bras, mains, guidage ou réponse au guidage (max 15 mots).
- "corps" : hanches, épaules, rotation, placement sur le temps (max 12 mots). Sur les comptes 4 et 8, rappelle la pause si c'est le cas.
- "figure" : nom de la figure en cours (pas de base, tour à droite, cross body, enchufla, etc.).
- "incertain" : ce qui n'a pas pu être vu clairement, ou une chaîne vide dans les 3 langues si tout est clair.
- Les conseils visent la personne du rôle demandé.`;

function extractJson(text) {
  const t = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = readBody(req);
  if (!checkPassword(body, res)) return;

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
  parts.push({ text: FORMAT });

  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: METHODE }] },
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json" },
  });
  // Gemini est parfois saturé : on réessaie, puis on passe au modèle de secours
  const main = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const backup = process.env.GEMINI_FALLBACK || "gemini-flash-lite-latest";
  const plan = [[main, 3], ...(backup !== main ? [[backup, 2]] : [])];
  let last = "Erreur Gemini";
  for (const [model, tries] of plan) {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": (process.env.GEMINI_API_KEY || "").trim() },
          body: payload,
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok) {
          const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
          return res.status(200).json(extractJson(text));
        }
        last = data?.error?.message || `Erreur Gemini (${r.status})`;
        if (![429, 500, 503, 529].includes(r.status)) return res.status(500).json({ error: last });
      } catch (e) {
        last = e.message;
      }
      await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
    }
  }
  return res.status(503).json({ error: "Gemini est très demandé en ce moment. Réessaie dans quelques minutes. (" + last + ")" });
};

module.exports.extractJson = extractJson;
