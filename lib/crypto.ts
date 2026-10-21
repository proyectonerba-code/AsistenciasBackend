/**
 * Utilidades criptográficas para tokens personales y etiquetas de tarjeta.
 *
 * Token (secreto): 16 caracteres alfanuméricos criptográficamente seguros
 * (excluye caracteres ambiguos: 0,1,I,O,L,S). Viaja en la URL /c/<token>.
 * Hash: SHA-256 del token, se guarda en BD. El token en claro solo se
 * muestra al momento de generarlo (panel de administración).
 *
 * Etiqueta NFC (visible): identificador impreso en la tarjeta física,
 * por ejemplo "NFC-4829-A". NO es un secreto: solo sirve para que el
 * administrador identifique la tarjeta. La autenticación la hace el token.
 */
const CARACTERES_TOKEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function generarToken(): Promise<string> {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let token = "";
  for (let i = 0; i < bytes.length; i++) {
    token += CARACTERES_TOKEN[bytes[i] % CARACTERES_TOKEN.length];
  }
  return token;
}

/**
 * Etiqueta legible de tarjeta NFC: NFC-4829-A
 * Formato: prefijo + 4 dígitos + letra de control.
 */
export function generarEtiquetaNfc(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const d1 = String(bytes[0] % 10000).padStart(4, "0");
  const d2 = String(bytes[1] % 10000).padStart(4, "0");
  const letra = String.fromCharCode(65 + (bytes[2] % 26));
  return `NFC-${d1}${d2}-${letra}`;
}

/** Etiqueta corta de 4 caracteres para auditar rechazos sin exponer el token. */
export function prefijoToken(token: string): string {
  return String(token).slice(0, 4);
}

export async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto)
  );
  const arr = Array.from(new Uint8Array(buf));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verifica que un string tenga forma de token válido.
 * Se usa antes de tocar la base de datos para no gastar consultas.
 */
export function esTokenValido(token: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(String(token).trim());
}
