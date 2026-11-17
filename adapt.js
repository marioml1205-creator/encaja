// Genera el CV adaptado mientras el usuario ve el anuncio. Devuelve el resultado CIFRADO:
// la clave para leerlo solo se entrega en /api/unlock cuando han pasado los segundos del anuncio.
const { verifyUser, db, buildPrompt, callClaude, parseJSON, encrypt, MAX_CHARS } = require("./_lib");

const IMG_TYPES = ["image/jpeg", "image/png", "image/webp"];

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  let claimed = null;
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: "auth" });

    const b = req.body || {};
    const ticket = String(b.ticket || "");
    if (!/^[a-f0-9]{32}$/.test(ticket)) return res.status(400).json({ error: "ticket" });

    const cvText = String(b.cvText || "").slice(0, MAX_CHARS);
    const jobText = String(b.jobText || "").slice(0, MAX_CHARS);
    const images = Array.isArray(b.images) ? b.images.slice(0, 8) : [];
    for (const im of images) {
      if (!IMG_TYPES.includes(im.media_type) || typeof im.data !== "string" || im.data.length > 2_000_000) {
        return res.status(400).json({ error: "image" });
      }
    }
    if (!cvText && !images.some(i => i.source === "cv")) return res.status(400).json({ error: "cv" });
    if (!jobText && !images.some(i => i.source === "job")) return res.status(400).json({ error: "job" });

    // Marca el ticket como usado (solo una vez).
    const rows = await db(
      `usos?nonce=eq.${ticket}&user_id=eq.${user.id}&used_at=is.null`,
      { method: "PATCH", body: { used_at: new Date().toISOString() }, prefer: "return=representation" }
    );
    if (!rows || !rows.length) return res.status(409).json({ error: "ticket" });
    claimed = rows[0];
    if (Date.now() - Date.parse(claimed.started_at) > 15 * 60 * 1000) {
      return res.status(409).json({ error: "ticket" });
    }

    const imgDesc = [];
    const content = [];
    let nCv = 0, nJob = 0;
    images.forEach((im, i) => {
      imgDesc.push(`Imagen ${i + 1}: ${im.source === "cv" ? `CV del candidato (página ${++nCv})` : `oferta de empleo (${++nJob})`}`);
      content.push({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } });
    });
    const prompt = buildPrompt({
      cvText, jobText,
      lang: String(b.lang || "auto"),
      notes: String(b.notes || "").slice(0, 300),
      imgDesc
    });
    content.push({ type: "text", text: prompt });

    const messages = [{ role: "user", content }];
    const instruction = String(b.instruction || "").slice(0, 500).trim();
    if (instruction && b.previous && typeof b.previous === "object") {
      const prev = JSON.stringify(b.previous).slice(0, 40000);
      messages.push({ role: "assistant", content: prev });
      messages.push({
        role: "user",
        content: `Aplica este cambio al CV nuevo: "${instruction}". Sigue cumpliendo TODAS las reglas (no inventes nada que no esté en el CV original). Actualiza también "cambios", "puntuacion_nueva" y "mejoras" si corresponde. Responde SOLO con el objeto JSON completo, misma estructura.`
      });
    }

    const text = await callClaude(messages);
    const data = parseJSON(text);
    if (!data.cv) throw new Error("bad json");

    res.status(200).json(encrypt(JSON.stringify(data), claimed.key));
  } catch (e) {
    console.error(e);
    // Si la IA falla, el uso no cuenta.
    if (claimed) {
      try { await db(`usos?nonce=eq.${claimed.nonce}`, { method: "DELETE" }); } catch (_) {}
    }
    res.status(502).json({ error: "ai" });
  }
};

module.exports.config = { maxDuration: 60 };
