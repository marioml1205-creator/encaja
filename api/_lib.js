// Utilidades compartidas por las funciones de /api (los archivos que empiezan por _ no se publican como endpoints).
const crypto = require("crypto");

const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SB_ANON = process.env.SUPABASE_ANON_KEY || "";
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";
const AD_SECONDS = Number(process.env.AD_SECONDS || 30);
const DAILY_LIMIT = Number(process.env.FREE_DAILY_LIMIT || 5);
const IP_DAILY_LIMIT = Number(process.env.IP_DAILY_LIMIT || 8);
const IV_DAILY_LIMIT = Number(process.env.INTERVIEW_DAILY_LIMIT || 10);
const IV_IP_DAILY_LIMIT = Number(process.env.INTERVIEW_IP_DAILY_LIMIT || 20);
const MAX_CHARS = 30000;

function configured() {
  return !!(SB_URL && SB_ANON && SB_SERVICE && ANTHROPIC_KEY);
}

// Comprueba el token de sesión de Supabase y devuelve el usuario, o null.
async function verifyUser(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` }
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}

// Acceso a la base de datos con la clave de servicio (solo en el servidor).
async function db(path, { method = "GET", body, prefer } = {}) {
  const headers = {
    apikey: SB_SERVICE,
    Authorization: `Bearer ${SB_SERVICE}`,
    "Content-Type": "application/json"
  };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const SCHEMA = `{
  "puesto": "título del puesto de la oferta",
  "empresa": "empresa de la oferta o cadena vacía",
  "puntuacion_actual": 0-100,
  "puntuacion_nueva": 0-100,
  "veredicto": "2 frases: cómo encaja hoy el candidato y qué cambia con el nuevo CV",
  "coincidencias": ["requisitos/palabras clave de la oferta que el CV SÍ cumple"],
  "faltan": ["requisitos/palabras clave de la oferta que el CV NO demuestra"],
  "mejoras": [{"titulo": "acción concreta", "detalle": "por qué y cómo hacerlo", "prioridad": "alta|media|baja"}],
  "cambios": ["qué has cambiado en el CV nuevo y por qué (frases cortas)"],
  "cv": {
    "nombre": "", "titular": "titular profesional orientado al puesto",
    "contacto": {"email": "", "telefono": "", "ubicacion": "", "linkedin": "", "web": ""},
    "perfil": "3-4 líneas",
    "experiencia": [{"puesto": "", "empresa": "", "ubicacion": "", "fechas": "", "logros": [""]}],
    "formacion": [{"titulo": "", "centro": "", "fechas": "", "detalle": ""}],
    "habilidades": [{"categoria": "", "items": [""]}],
    "idiomas": [{"idioma": "", "nivel": ""}],
    "otros": [{"titulo": "Certificaciones / Proyectos / Voluntariado...", "items": [""]}]
  }
}`;

function buildPrompt({ cvText, jobText, lang, notes, imgDesc }) {
  const L = lang === "español" || lang === "inglés" ? lang : "el mismo idioma en que está escrita la oferta";
  return `Eres un experto en selección de personal y en redactar CVs que superan filtros ATS. Tu tarea: analizar el CV de un candidato frente a una oferta de empleo concreta y devolver (a) qué debe mejorar y (b) un CV nuevo adaptado a ESA oferta.

REGLAS ESTRICTAS
1. NUNCA inventes experiencia, empresas, puestos, fechas, títulos, cifras, herramientas ni habilidades que no aparezcan en el CV. Puedes reformular, reordenar, priorizar, agrupar y condensar.
2. Usa el vocabulario y las palabras clave de la oferta solo cuando el CV respalde esa competencia.
3. Lo que la oferta pide y el CV no demuestra NO va en el CV: va en "faltan" y en "mejoras", explicando cómo conseguirlo o cómo demostrarlo si ya lo tiene.
4. Logros con verbo de acción y resultado. Cuantifica solo con datos que estén en el CV; si una cifra ayudaría, sugiérelo en "mejoras".
5. Experiencia en orden cronológico inverso. Más detalle (3-5 logros) en lo relevante para el puesto; lo poco relevante, 1-2 logros o se agrupa.
6. "perfil": 3-4 líneas escritas para este puesto, sin tópicos vacíos.
7. Pensado para 1 página si el candidato tiene menos de 10 años de experiencia.
8. Copia los datos de contacto exactamente como aparecen en el CV. Deja vacíos los campos que no existan; omite secciones vacías con [].
9. Puntuaciones honestas: "puntuacion_actual" = encaje del CV original con la oferta; "puntuacion_nueva" = encaje del CV nuevo. Si faltan requisitos importantes, la nueva no puede ser muy alta.
10. "mejoras": entre 4 y 8, ordenadas de más a menos prioridad, concretas para este candidato y esta oferta.
11. Idioma del CV nuevo: ${L}. Los textos de análisis (veredicto, mejoras, cambios, coincidencias, faltan) siempre en español.
${notes ? `12. Petición del candidato: "${notes}". Tenla en cuenta sin romper las reglas anteriores.\n` : ""}
${imgDesc.length ? "IMÁGENES ADJUNTAS\n" + imgDesc.join("\n") + "\n" : ""}
=== CV DEL CANDIDATO ===
${cvText ? cvText.slice(0, MAX_CHARS) : "(ver imágenes adjuntas)"}

=== OFERTA DE EMPLEO ===
${jobText ? jobText.slice(0, MAX_CHARS) : "(ver imágenes adjuntas)"}

FORMATO DE RESPUESTA
Responde SOLO con un objeto JSON válido (sin texto antes ni después, sin \`\`\`), con esta estructura exacta:
${SCHEMA}`;
}

function buildInterviewPrompt({ cv, puesto, empresa, faltan, coincidencias, jobText }) {
  return `Eres un experto en selección de personal. Prepara a este candidato para la entrevista de trabajo de esta oferta concreta.

PUESTO: ${puesto || "(ver oferta)"}${empresa ? ` · EMPRESA: ${empresa}` : ""}
REQUISITOS QUE YA CUMPLE: ${(coincidencias || []).join(", ") || "-"}
REQUISITOS QUE LE FALTAN: ${(faltan || []).join(", ") || "-"}

=== CV DEL CANDIDATO (JSON) ===
${cv}

=== OFERTA DE EMPLEO ===
${jobText || "(no disponible: usa el puesto y los requisitos de arriba)"}

TAREA
Devuelve exactamente 6 preguntas que probablemente le harán en la entrevista para ESTE puesto: 2 generales (presentación y motivación por el puesto o la empresa), 3 sobre los requisitos y funciones de la oferta, y 1 sobre su punto más débil frente a la oferta (algo que le falte).
Para cada una: "por_que" (qué quiere comprobar el entrevistador, 1 frase), "como_responder" (consejo concreto, 1-2 frases) y "ejemplo" (2-4 frases en primera persona que el candidato podría decir).
REGLAS: los ejemplos se basan SOLO en datos reales del CV; nunca inventes experiencia, cifras ni empresas. Si le falta algo, la respuesta lo reconoce con honestidad y explica cómo lo compensa o lo está trabajando. "pregunta" y "ejemplo" en el mismo idioma que el CV; "por_que" y "como_responder" en español.

Responde SOLO con un JSON válido (sin texto antes ni después, sin \`\`\`) con esta estructura:
{"entrevista":[{"pregunta":"","por_que":"","como_responder":"","ejemplo":""}]}`;
}

async function callClaude(messages) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`claude ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}

function parseJSON(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("bad json");
  return JSON.parse(t.slice(a, b + 1));
}

// Identificador cifrado de la IP (nunca se guarda la IP en claro).
function ipHash(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = fwd || String(req.headers["x-real-ip"] || "") || (req.socket && req.socket.remoteAddress) || "desconocida";
  const salt = process.env.IP_SALT || SB_SERVICE.slice(-24);
  return crypto.createHash("sha256").update(salt + "|" + ip).digest("hex").slice(0, 40);
}

// Emails sin límite (variable UNLIMITED_EMAILS en Vercel, separados por comas).
const UNLIMITED = String(process.env.UNLIMITED_EMAILS || "").toLowerCase().split(",").map(e => e.trim()).filter(Boolean);
function isUnlimited(user) {
  return !!(user && user.email && !user.is_anonymous && UNLIMITED.includes(String(user.email).toLowerCase()));
}

// Usos completados en las últimas 24 h por usuario y por IP.
// kind: "cv" (adaptar CV) o "interview" (preparar entrevista); cada uno tiene su propio límite.
async function usage(userId, ip, user, kind = "cv") {
  if (isUnlimited(user)) return { user: 0, ip: 0, remaining: 999, unlimited: true };
  const since = encodeURIComponent(new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  const [byUser, byIp] = await Promise.all([
    db(`usos?select=id&kind=eq.${kind}&user_id=eq.${userId}&used_at=not.is.null&created_at=gte.${since}`),
    db(`usos?select=id&kind=eq.${kind}&ip_hash=eq.${ip}&used_at=not.is.null&created_at=gte.${since}`)
  ]);
  const uLim = kind === "interview" ? IV_DAILY_LIMIT : DAILY_LIMIT;
  const ipLim = kind === "interview" ? IV_IP_DAILY_LIMIT : IP_DAILY_LIMIT;
  const remaining = Math.max(0, Math.min(uLim - byUser.length, ipLim - byIp.length));
  return { user: byUser.length, ip: byIp.length, remaining };
}

function encrypt(plain, keyHex) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final(), c.getAuthTag()]);
  return { iv: iv.toString("base64"), data: data.toString("base64") };
}

module.exports = {
  crypto, SB_URL, SB_ANON, AD_SECONDS, DAILY_LIMIT, IP_DAILY_LIMIT, IV_DAILY_LIMIT, MAX_CHARS,
  buildInterviewPrompt,
  ipHash, usage,
  configured, verifyUser, db, buildPrompt, callClaude, parseJSON, encrypt
};
