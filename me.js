// Cuántos CVs gratis le quedan al usuario en las últimas 24 horas.
const { verifyUser, db, DAILY_LIMIT } = require("./_lib");

module.exports = async (req, res) => {
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: "auth" });
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const used = await db(
      `usos?select=id&user_id=eq.${user.id}&used_at=not.is.null&created_at=gte.${encodeURIComponent(since)}`
    );
    res.status(200).json({ remaining: Math.max(0, DAILY_LIMIT - used.length), limit: DAILY_LIMIT });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server" });
  }
};
