// Cuántos CVs gratis le quedan al usuario hoy (el menor entre su límite y el de su IP).
const { verifyUser, ipHash, usage, DAILY_LIMIT } = require("./_lib");

module.exports = async (req, res) => {
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: "auth" });
    const u = await usage(user.id, ipHash(req));
    res.status(200).json({ remaining: u.remaining, limit: DAILY_LIMIT });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server" });
  }
};
