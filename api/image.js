// Création (ou retouche) d'images : ChatGPT (OpenAI) et Gemini (Nano Banana).
// Reçoit { ai: "openai" | "gemini", prompt, format: "square" | "portrait" | "landscape", image?: { mime, data } }
// Renvoie { mime, data } (image en base64).
const { readBody, checkPassword } = require("../lib/auth");

const SIZES = { square: "1024x1024", portrait: "1024x1536", landscape: "1536x1024" };
const RATIOS = { square: "1:1", portrait: "9:16", landscape: "16:9" };
const BUSY = [429, 500, 503, 529];
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function openai({ prompt, format, image }) {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("Clé manquante : ajoute OPENAI_API_KEY dans Vercel.");
  const models = [process.env.OPENAI_IMAGE_MODEL || "gpt-image-2", "gpt-image-1"];
  let last = "Erreur ChatGPT";
  for (const model of [...new Set(models)]) {
    for (let i = 0; i < 2; i++) {
      let r;
      if (image) {
        // Retouche d'une photo envoyée
        const fd = new FormData();
        fd.append("model", model);
        fd.append("prompt", prompt);
        fd.append("size", SIZES[format] || "1024x1024");
        fd.append("quality", "medium");
        fd.append("output_format", "jpeg");
        fd.append("image", new Blob([Buffer.from(image.data, "base64")], { type: image.mime || "image/jpeg" }), "photo.jpg");
        r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: fd });
      } else {
        r = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, prompt, size: SIZES[format] || "1024x1024", quality: "medium", output_format: "jpeg", n: 1 }),
        });
      }
      const d = await r.json().catch(() => ({}));
      const b64 = d?.data?.[0]?.b64_json;
      if (r.ok && b64) return { mime: "image/jpeg", data: b64 };
      last = d?.error?.message || `Erreur ChatGPT (${r.status})`;
      if (!BUSY.includes(r.status)) break; // modèle refusé ou autre : on essaie le modèle suivant
      await wait(2000 * (i + 1));
    }
  }
  throw new Error(last);
}

async function gemini({ prompt, format, image }) {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) throw new Error("Clé manquante : ajoute GEMINI_API_KEY dans Vercel.");
  const models = [process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image"];
  const parts = [{ text: `${prompt}\n\n(Format de l'image : ${RATIOS[format] || "1:1"})` }];
  if (image) parts.push({ inlineData: { mimeType: image.mime || "image/jpeg", data: image.data } });
  let last = "Erreur Gemini";
  for (const model of [...new Set(models)]) {
    for (let i = 0; i < 2; i++) {
      for (const withRatio of [true, false]) {
        const generationConfig = { responseModalities: ["TEXT", "IMAGE"] };
        if (withRatio) generationConfig.imageConfig = { aspectRatio: RATIOS[format] || "1:1" };
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
        });
        const d = await r.json().catch(() => ({}));
        const img = (d?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData || p.inline_data);
        if (r.ok && img) {
          const x = img.inlineData || img.inline_data;
          return { mime: x.mimeType || x.mime_type || "image/png", data: x.data };
        }
        last = d?.error?.message || (r.ok ? "Gemini n'a pas renvoyé d'image (demande refusée ?)" : `Erreur Gemini (${r.status})`);
        if (r.status === 400 && withRatio) continue; // réglage de format refusé : on réessaie sans
        break;
      }
      if (!/high demand|overloaded|unavailable|429|503/i.test(last)) break;
      await wait(1500 * (i + 1));
    }
  }
  throw new Error(last);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = readBody(req);
  if (!checkPassword(body, res)) return;
  const prompt = String(body.prompt || "").slice(0, 4000);
  if (!prompt) return res.status(400).json({ error: "Décris l'image à créer." });
  const args = { prompt, format: body.format, image: body.image && body.image.data ? body.image : null };
  try {
    const out = body.ai === "gemini" ? await gemini(args) : await openai(args);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
