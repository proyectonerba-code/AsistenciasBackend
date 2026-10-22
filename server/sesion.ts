/**
 * Sesiones de terminal: tokens de vida corta que autorizan UNA checada.
 *
 * En la terminal compartida (enlace genérico /c) la persona se identifica
 * con su correo o su nombre. El backend valida contra la tabla `usuarios`
 * y devuelve una sesión firmada: sirve para una sola checada y expira en
 * pocos minutos. Así nadie puede reutilizar un identificador robado.
 *
 * Formato: base64url(payload).base64url(firma HMAC-SHA256)
 */

const VIGENCIA_SESION_MS = 5 * 60 * 1000; // 5 minutos

interface PayloadSesion {
  /** id del usuario */
  uid: string;
  /** instante de expiración (epoch ms) */
  exp: number;
  /** nonce aleatorio */
  n: string;
}

/** Secreto de firma. Solo vive en el servidor. */
function secreto(): string {
  const s =
    process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!s) {
    throw new Error(
      "Falta SESSION_SECRET (o SUPABASE_SERVICE_ROLE_KEY) para firmar sesiones."
    );
  }
  return s;
}

function aBase64Url(datos: Uint8Array): string {
  let bin = "";
  for (const b of datos) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64Url(texto: string): Uint8Array {
  const base = texto.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base + "=".repeat((4 - (base.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function firmar(datos: string): Promise<string> {
  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const firma = await crypto.subtle.sign(
    "HMAC",
    clave,
    new TextEncoder().encode(datos)
  );
  return aBase64Url(new Uint8Array(firma));
}

/**
 * Crea una sesión para el usuario dado.
 */
export async function crearSesion(usuarioId: string): Promise<string> {
  const payload: PayloadSesion = {
    uid: usuarioId,
    exp: Date.now() + VIGENCIA_SESION_MS,
    n: aBase64Url(crypto.getRandomValues(new Uint8Array(9))),
  };
  const cuerpo = aBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const firma = await firmar(cuerpo);
  return `${cuerpo}.${firma}`;
}

/**
 * Valida una sesión y devuelve el id del usuario, o null si es inválida
 * o ya expiró.
 */
export async function verificarSesion(token: string): Promise<string | null> {
  if (!token || !token.includes(".")) return null;

  const [cuerpo, firma] = token.split(".");
  if (!cuerpo || !firma) return null;

  const esperada = await firmar(cuerpo);

  // Comparación en tiempo constante.
  if (firma.length !== esperada.length) return null;
  let diff = 0;
  for (let i = 0; i < firma.length; i++) {
    diff |= firma.charCodeAt(i) ^ esperada.charCodeAt(i);
  }
  if (diff !== 0) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(deBase64Url(cuerpo))
    ) as PayloadSesion;

    if (!payload?.uid || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;

    return payload.uid;
  } catch {
    return null;
  }
}
