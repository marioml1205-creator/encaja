// Empieza un uso: comprueba los límites (por usuario y por IP) y crea un "ticket" que arranca el reloj del anuncio.
const { crypto, verifyUser, db, ipHash, usage, DAILY_LIMIT, AD_SECONDS } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: "auth" });

    const ip = ipHash(req);
    const u = await usage(user.id, ip);
    if (u.remaining <= 0) {
      return res.status(429).json({ error: "limit", limit: DAILY_LIMIT });
    }

    const nonce = crypto.randomBytes(16).toString("hex");
    const key = crypto.randomBytes(32).toString("hex");
    await db("usos", {
      method: "POST",
      body: { user_id: user.id, nonce, key, ip_hash: ip, started_at: new Date().toISOString() }
    });
    res.status(200).json({ ticket: nonce, remaining: u.remaining, adSeconds: AD_SECONDS });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server" });
  }
};
