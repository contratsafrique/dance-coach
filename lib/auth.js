function readBody(req) {
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
}
function checkPassword(body, res) {
  if (!process.env.APP_PASSWORD || body.password !== process.env.APP_PASSWORD) {
    res.status(401).json({ error: "Mot de passe incorrect" });
    return false;
  }
  return true;
}
module.exports = { readBody, checkPassword };
