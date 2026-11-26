// Musique avec Eleven Music (ElevenLabs) : renvoie directement le fichier MP3.
const { readBody, checkPassword } = require("../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = readBody(req);
  if (!checkPassword(body, res)) return;

  const seconds = Math.min(Math.max(Number(body.seconds) || 30, 10), 120);
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "content-type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY },
      body: JSON.stringify({
        prompt: String(body.prompt || "").slice(0, 4000),
        music_length_ms: seconds * 1000,
        model_id: process.env.ELEVEN_MUSIC_MODEL || "music_v1",
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      let msg = `Erreur Eleven Music (${r.status})`;
      try { const j = JSON.parse(t); msg = j?.detail?.message || j?.detail || msg; } catch {}
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("content-type", "audio/mpeg");
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
