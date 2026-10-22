/**
 * CORS para la API pública de checadas.
 *
 * La vista de registro se sirve desde otro dominio (Netlify, Vercel, o
 * localhost en desarrollo), así que la API debe permitir ese origen.
 *
 * Variables de entorno:
 *   ALLOWED_ORIGIN  Lista de orígenes permitidos, separados por coma:
 *                     https://registro.nerwork.mx,https://*.netlify.app
 *                   Admite comodines con prefijo: "*.netlify.app" (Netlify
 *                   genera una URL distinta en cada vista previa).
 *                   Si se deja vacío, se permiten todos ("*").
 *
 * Nota: la API no usa cookies, por eso puede responder con "*" sin riesgo.
 */

export function origenesPermitidos(): string[] {
  const crudo = process.env.ALLOWED_ORIGIN?.trim();
  if (!crudo) return ["*"];
  return crudo
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * ¿Coincide el origen con el patrón permitido?
 * Un patrón con "*" se trata como comodín: "https://*.netlify.app" acepta
 * "https://deploy-preview-12--registro.netlify.app".
 */
function coincide(p: string, origen: string): boolean {
  if (!p.includes("*")) return p === origen;

  const patron = p
    .split("*")
    .map((parte) => parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");

  try {
    return new RegExp(`^${patron}$`).test(origen);
  } catch {
    return false;
  }
}

/**
 * Decide qué valor va en Access-Control-Allow-Origin.
 * Si el origen de la petición está permitido, se devuelve tal cual
 * (para que el navegador acepte la respuesta).
 */
export function resolverCORS(origenPeticion: string | null): string {
  const permitidos = origenesPermitidos();

  if (permitidos.includes("*")) return origenPeticion || "*";

  if (!origenPeticion) return permitidos[0] ?? "*";

  for (const p of permitidos) {
    if (coincide(p, origenPeticion)) return origenPeticion;
  }

  // Origen no permitido: se devuelve el primero para que quede claro.
  return permitidos[0] ?? "*";
}

/**
 * Cabeceras CORS para la respuesta. Pasa el origen de la petición para
 * poder devolverlo tal cual.
 */
export function cabecerasCors(origenPeticion?: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolverCORS(origenPeticion ?? null),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/**
 * Fusiona las cabeceras CORS con las de la respuesta.
 */
export function conCors(
  headers: Record<string, string>,
  status = 200,
  body?: BodyInit | null,
  origenPeticion?: string | null
): Response {
  return new Response(body ?? null, {
    status,
    headers: { ...headers, ...cabecerasCors(origenPeticion) },
  });
}
