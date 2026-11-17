// Entrega la clave para leer el CV solo cuando ha pasado el tiempo del anuncio.
const { verifyUser, db, AD_SECONDS } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: "auth" });
    const ticket = String((req.body || {}).ticket || "");
    if (!/^[a-f0-9]{32}$/.test(ticket)) return res.status(400).json({ error: "ticket" });

    const rows = await db(`usos?select=key,started_at&nonce=eq.${ticket}&user_id=eq.${user.id}`);
    if (!rows.length) return res.status(404).json({ error: "ticket" });

    const elapsed = (Date.now() - Date.parse(rows[0].started_at)) / 1000;
    if (elapsed < AD_SECONDS) {
      return res.status(425).json({ error: "wait", wait: Math.ceil(AD_SECONDS - elapsed) });
    }
    res.status(200).json({ key: rows[0].key });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server" });
  }
};
