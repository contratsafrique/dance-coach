// Fonction serveur Vercel : relaie la conversation vers Claude, ChatGPT ou Gemini.
// Les clés API restent sur le serveur (variables d'environnement), jamais dans le navigateur.
// Avec "stream: true", la réponse arrive morceau par morceau (texte brut), pour l'écriture en direct.

const { readBody, checkPassword } = require("../lib/auth");

const SYSTEM =
  process.env.SYSTEM_PROMPT ||
  "Tu parles à Hamidine, entrepreneur et professeur de danse, qui n'est pas technicien. Réponds en français simple, sans jargon : si tu utilises un mot technique, explique-le en quelques mots. Sois court : 5 à 8 lignes maximum. Commence par ta recommandation claire en une phrase, puis 3 points maximum. Pas de longue introduction ni de conclusion. S'il veut plus de détails, il le demandera.";

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.busy = status === 429 || status === 500 || status === 503 || status === 529;
  }
}

async function failFrom(r, label) {
  const data = await r.json().catch(() => ({}));
  const msg = data?.error?.message || data?.message || `Erreur ${label} (${r.status})`;
  throw new ApiError(msg, r.status);
}

// Lit un flux "server-sent events" et renvoie chaque objet JSON reçu
async function* events(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let obj;
      try { obj = JSON.parse(payload); } catch { continue; }
      yield obj;
    }
  }
}
async function* sse(body, pick) {
  for await (const d of events(body)) {
    const t = pick(d);
    if (t) yield t;
  }
}

// ---------- Pièces jointes : chaque IA a son propre format ----------
// Un message reçu du navigateur : { role, content: "texte", files: [{ name, mime, data(base64) }] }
const isImg = (f) => /^image\/(png|jpe?g|webp|gif)$/.test(f.mime);
const isPdf = (f) => f.mime === "application/pdf";
const clean = (files) => (Array.isArray(files) ? files : []).filter((f) => f && f.data && (isImg(f) || isPdf(f)));

function forClaude(messages) {
  return messages.map((m) => {
    const files = clean(m.files);
    if (!files.length) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [
        ...files.map((f) =>
          isImg(f)
            ? { type: "image", source: { type: "base64", media_type: f.mime, data: f.data } }
            : { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
        ),
        { type: "text", text: m.content },
      ],
    };
  });
}
function forOpenAI(messages) {
  return messages.map((m) => {
    const files = clean(m.files);
    if (!files.length) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [
        { type: "text", text: m.content },
        ...files.map((f) =>
          isImg(f)
            ? { type: "image_url", image_url: { url: `data:${f.mime};base64,${f.data}` } }
            : { type: "file", file: { filename: f.name || "document.pdf", file_data: `data:application/pdf;base64,${f.data}` } }
        ),
      ],
    };
  });
}
function forGemini(messages) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }, ...clean(m.files).map((f) => ({ inlineData: { mimeType: f.mime, data: f.data } }))],
  }));
}
function textOnly(messages) {
  return messages.map((m) => {
    const files = clean(m.files);
    const note = files.length ? `\n\n(Pièces jointes non transmises à cette IA : ${files.map((f) => f.name).join(", ")})` : "";
    return { role: m.role, content: m.content + note };
  });
}

// ---------- Claude ----------
async function* claude(messages, system) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
      max_tokens: 4000,
      system,
      messages: forClaude(messages),
      stream: true,
    }),
  });
  if (!r.ok) await failFrom(r, "Claude");
  yield* sse(r.body, (d) => (d.type === "content_block_delta" && d.delta?.type === "text_delta" ? d.delta.text : ""));
}

// ---------- ChatGPT ----------
async function* openai(messages, system) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-6.1-terra",
      messages: [{ role: "system", content: system }, ...forOpenAI(messages)],
      stream: true,
    }),
  });
  if (!r.ok) await failFrom(r, "ChatGPT");
  yield* sse(r.body, (d) => d.choices?.[0]?.delta?.content || "");
}

// ---------- Gemini (nouvel essai si surchargé, puis modèle de secours) ----------
async function geminiOpen(model, messages, system) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: forGemini(messages),
      }),
    }
  );
  if (!r.ok) await failFrom(r, "Gemini");
  return r;
}
async function* gemini(messages, system) {
  const main = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const backup = process.env.GEMINI_FALLBACK || "gemini-flash-lite-latest";
  let r = null;
  outer: for (const [model, tries] of [[main, 3], [backup, 2]]) {
    for (let i = 0; i < tries; i++) {
      try {
        r = await geminiOpen(model, messages, system);
        break outer;
      } catch (e) {
        if (!e.busy) throw e;
        await wait(1500 * (i + 1));
      }
    }
  }
  if (!r) throw new Error("Gemini est surchargé en ce moment, réessaie dans quelques minutes.");
  yield* sse(r.body, (d) => (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(""));
}

// ---------- Perplexity (recherche sur Internet, avec sources) ----------
async function* perplexity(messages, system) {
  const r = await fetch("https://api.perplexity.ai/v1/agent", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
    },
    body: JSON.stringify({
      effort: process.env.PERPLEXITY_EFFORT || "fast",
      instructions: system + " Cite tes sources avec des numéros [1], [2]…",
      input: textOnly(messages).map((m) => ({ type: "message", role: m.role, content: m.content })),
      tools: [{ type: "web_search" }],
      stream: true,
    }),
  });
  if (!r.ok) await failFrom(r, "Perplexity");
  let sources = [];
  const grab = (item) => {
    if (item && item.type === "search_results" && Array.isArray(item.results) && !sources.length) sources = item.results;
  };
  for await (const d of events(r.body)) {
    if (d.type === "response.output_text.delta" && d.delta) yield d.delta;
    else if (typeof d.type === "string" && d.type.startsWith("response.output_item")) grab(d.item);
    else if (d.type === "response.completed") (d.response?.output || []).forEach(grab);
  }
  const list = sources.filter((x) => x && x.url).slice(0, 6);
  if (list.length) {
    yield "\n\n**Sources :**\n" + list.map((x, i) => `${x.id ?? i + 1}. [${(x.title || x.url).replace(/[\[\]]/g, "")}](${x.url})`).join("\n");
  }
}

const PROVIDERS = { claude, openai, gemini, perplexity };
const KEYS = { claude: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", perplexity: "PERPLEXITY_API_KEY" };

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = readBody(req);
  if (!checkPassword(body, res)) return;
  const { ai, messages, stream } = body;
  const run = PROVIDERS[ai];
  if (!run) return res.status(400).json({ error: "IA inconnue" });
  if (!process.env[KEYS[ai]]) return res.status(500).json({ error: `Clé manquante : ajoute ${KEYS[ai]} dans Vercel.` });
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: "Aucun message" });
  const system = typeof body.system === "string" && body.system ? `${SYSTEM}\n\n${body.system}` : SYSTEM;

  const gen = run(messages, system);
  let first;
  try {
    first = await gen.next(); // les erreurs (clé, quota…) arrivent ici, avant tout envoi
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  if (!stream) {
    let text = first.done ? "" : first.value;
    try {
      for await (const t of gen) text += t;
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    return res.status(200).json({ text });
  }

  res.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
  });
  if (!first.done) res.write(first.value);
  try {
    for await (const t of gen) res.write(t);
  } catch (e) {
    res.write(`\n\n⚠️ ${e.message}`);
  }
  res.end();
};
