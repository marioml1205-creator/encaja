// Configuración pública que necesita la página (nunca incluye claves secretas).
const { SB_URL, SB_ANON, AD_SECONDS, DAILY_LIMIT, configured } = require("./_lib");

module.exports = (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({
    ok: configured(),
    supabaseUrl: SB_URL,
    supabaseAnonKey: SB_ANON,
    adTagUrl: process.env.AD_TAG_URL || "",
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || "",
    adSeconds: AD_SECONDS,
    dailyLimit: DAILY_LIMIT
  });
};
