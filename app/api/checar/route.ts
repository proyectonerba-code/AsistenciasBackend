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
export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: cabecerasCors(request.headers.get("origin")) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "desconocida";
  const userAgent = request.headers.get("user-agent") ?? "desconocido";

  let input: {
    token?: string;
    sesion?: string;
    lat?: number;
    lng?: number;
    accuracy?: number;
    dispositivo?: string;
    etiqueta?: string;
  };
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
      { status: 400, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  const { token, sesion, lat, lng, accuracy, dispositivo, etiqueta } = input;

  // Se acepta cualquiera de las tres formas de credencial:
  //   token       -> credencial personal (NFC/QR por persona)
  //   sesion      -> sesión temporal (terminal compartida, ya identificado)
  //   dispositivo -> dispositivo ya vinculado a una persona
  const tieneCredencial =
    (token && esTokenValido(token)) ||
    (sesion && sesion.includes(".")) ||
    (dispositivo && dispositivo.length >= 8);

  if (!tieneCredencial) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          motivo: "token invalido",
          mensaje: "Token, sesión o dispositivo requerido",
        },
      },
      { status: 400, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  const resultado = await procesarChecar(
    { token, sesion, lat, lng, accuracy, dispositivo, etiqueta },
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
      { headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  return NextResponse.json(
    { ok: false, error: resultado.error },
    { status: 400, headers: cabecerasCors(request.headers.get("origin")) }
  );
}
