/**
 * POST /api/checar — Registro de checada pública (NFC/QR).
 *
 * NUNCA se registra con GET. Solo el servidor (service role) escribe.
 * Rate limit por IP y por token. Validaciones con zod en este orden:
 * token/usuario activo → hora permitida → geocerca → anti doble registro →
 * marca adicional → inserción atómica.
 *
 * Si la petición no trae ubicación, NO se escribe nada: se responde
 * "sin ubicacion" y queda auditado en la tabla `rechazados`.
 */
import { NextRequest, NextResponse } from "next/server";
import { procesarChecar } from "@/server/checar";
import { esTokenValido } from "@/lib/crypto";
import { cabecerasCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Preflight CORS. */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: cabecerasCors() });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "desconocida";
  const userAgent = request.headers.get("user-agent") ?? "desconocido";

  let input: { token?: string; lat?: number; lng?: number; accuracy?: number };
  try {
    input = (await request.json()) ?? {};
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          motivo: "sin ubicacion",
          mensaje: "Cuerpo de la petición inválido",
        },
      },
      { status: 400, headers: cabecerasCors() }
    );
  }

  const { token, lat, lng, accuracy } = input;

  if (!token || !esTokenValido(token)) {
    return NextResponse.json(
      {
        ok: false,
        error: { motivo: "token invalido", mensaje: "Token requerido o inválido" },
      },
      { status: 400, headers: cabecerasCors() }
    );
  }

  const resultado = await procesarChecar(
    { token, lat, lng, accuracy },
    ip,
    userAgent
  );

  if (resultado.ok) {
    return NextResponse.json(
      {
        ok: true,
        tipo: resultado.data.tipo,
        hora: resultado.data.hora,
        nombre: resultado.data.nombre,
        sede: resultado.data.sede,
        distanciaM: resultado.data.distanciaM,
        aviso: resultado.data.aviso,
      },
      { headers: cabecerasCors() }
    );
  }

  return NextResponse.json(
    { ok: false, error: resultado.error },
    { status: 400, headers: cabecerasCors() }
  );
}
