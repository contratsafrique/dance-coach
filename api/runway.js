// Vidéo avec Runway : action "create" lance la génération, action "status" suit son avancement.
const { readBody, checkPassword } = require("../lib/auth");

const BASE = "https://api.dev.runwayml.com/v1";
const headers = () => ({
  "content-type": "application/json",
  authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
  "X-Runway-Version": process.env.RUNWAY_VERSION || "2024-11-06",
});

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = readBody(req);
  if (!checkPassword(body, res)) return;

  try {
    if (body.action === "create") {
      const r = await fetch(`${BASE}/text_to_video`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          model: process.env.RUNWAY_MODEL || "gen4.5",
          promptText: String(body.prompt || "").slice(0, 1000),
          ratio: body.ratio === "1280:720" ? "1280:720" : "720:1280",
          duration: [5, 10].includes(Number(body.duration)) ? Number(body.duration) : 5,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || data?.message || `Erreur Runway (${r.status})`);
      return res.status(200).json({ id: data.id });
    }

    if (body.action === "status") {
      const r = await fetch(`${BASE}/tasks/${encodeURIComponent(body.id)}`, { headers: headers() });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `Erreur Runway (${r.status})`);
      return res.status(200).json({
        status: data.status, // PENDING, THROTTLED, RUNNING, SUCCEEDED, FAILED
        url: data.output?.[0] || null,
        error: data.failure || null,
      });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
