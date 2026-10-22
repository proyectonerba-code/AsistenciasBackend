/**
 * POST /api/identificar
 *
 * Terminal compartida: valida correo (o nombre) contra la tabla `usuarios`
 * y devuelve una sesión de vida corta (5 min) que autoriza UNA checada.
 *
 * Body: { "correo": "..." }  |  { "nombre": "..." }  |  { "id": "uuid" }
 */
import { NextRequest, NextResponse } from "next/server";
import { identificar } from "@/server/identificar";
import { verificarRateLimit } from "@/lib/rate-limit";
import { cabecerasCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: cabecerasCors() });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "desconocida";

  // Límite de intentos: evita que alguien pruebe correos en masa.
  const rl = verificarRateLimit(`identificar:${ip}`);
  if (!rl.permitido) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          motivo: "invalido",
          mensaje: "Demasiados intentos. Espera un minuto e inténtalo de nuevo.",
        },
      },
      { status: 429, headers: cabecerasCors() }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: { motivo: "invalido", mensaje: "Cuerpo de la petición inválido" },
      },
      { status: 400, headers: cabecerasCors() }
    );
  }

  const resultado = await identificar(body as Record<string, unknown>);

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, error: resultado.error },
      { status: resultado.error.motivo === "varios" ? 300 : 404, headers: cabecerasCors() }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      sesion: resultado.data.sesion,
      usuario: resultado.data.usuario,
    },
    { headers: cabecerasCors() }
  );
}
