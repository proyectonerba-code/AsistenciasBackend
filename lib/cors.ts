/**
 * CORS para la API pública de checadas.
 *
 * La vista de registro se sirve desde otro dominio (o desde otro puerto en
 * desarrollo), así que la API debe permitir el origen configurado.
 *
 * Variables de entorno:
 *   ALLOWED_ORIGIN  -> origen permitido (ej. https://registro.nerwork.mx).
 *                      Si no se define, se permiten todos ("*"), porque la
 *                      API no usa cookies: la autenticación va en el token.
 */

export function origenPermitido(): string {
  return process.env.ALLOWED_ORIGIN?.trim() || "*";
}

export function cabecerasCors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origenPermitido(),
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
  body?: BodyInit | null
): Response {
  return new Response(body ?? null, {
    status,
    headers: { ...headers, ...cabecerasCors() },
  });
}
