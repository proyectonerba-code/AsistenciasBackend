/**
 * GET /api/checar/info?token=<token>
 *
 * SOLO LECTURA: devuelve el nombre de la persona y su última marca del día
 * para que la vista de escaneo muestre el estado. NUNCA registra nada.
 */
import { NextRequest, NextResponse } from "next/server";
import { obtenerInfoPublica } from "@/server/checar";
import { esTokenValido } from "@/lib/crypto";
import { cabecerasCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Preflight CORS. */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: cabecerasCors() });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token") ?? "";

  if (!token || !esTokenValido(token)) {
    return NextResponse.json(
      { valido: false },
      { status: 400, headers: cabecerasCors() }
    );
  }

  const info = await obtenerInfoPublica(token);
  return NextResponse.json(info, { headers: cabecerasCors() });
}
