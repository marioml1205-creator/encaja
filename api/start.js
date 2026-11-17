// Empieza un uso: comprueba el límite diario y crea un "ticket" que arranca el reloj del anuncio.
const { crypto, verifyUser, db, DAILY_LIMIT, AD_SECONDS } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: "auth" });

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const used = await db(
      `usos?select=id&user_id=eq.${user.id}&used_at=not.is.null&created_at=gte.${encodeURIComponent(since)}`
    );
    if (used.length >= DAILY_LIMIT) {
      return res.status(429).json({ error: "limit", limit: DAILY_LIMIT });
    }

    const nonce = crypto.randomBytes(16).toString("hex");
    const key = crypto.randomBytes(32).toString("hex");
    await db("usos", {
      method: "POST",
      body: { user_id: user.id, nonce, key, started_at: new Date().toISOString() }
    });
    res.status(200).json({ ticket: nonce, remaining: DAILY_LIMIT - used.length, adSeconds: AD_SECONDS });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server" });
  }
};
