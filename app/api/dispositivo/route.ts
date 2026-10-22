/**
 * GET /api/dispositivo?huella=<id>
 *
 * Consulta si un dispositivo (celular/tablet) ya está asignado a alguien.
 * Solo lectura: NO registra nada. La terminal lo usa para saber si tiene
 * que pedir la identidad o puede checar directo.
 *
 * GET /api/dispositivo?huella=<id>&olvidar=1
 * Libera el vínculo (el dispositivo vuelve a pedir identificación).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cabecerasCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: cabecerasCors(request.headers.get("origin")) });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const huella = request.nextUrl.searchParams.get("huella")?.trim() ?? "";
  const olvidar = request.nextUrl.searchParams.get("olvidar") === "1";

  if (!huella || !/^[A-Za-z0-9_-]{8,64}$/.test(huella)) {
    return NextResponse.json(
      { encontrado: false },
      { status: 400, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  if (olvidar) {
    await supabaseAdmin
      .from("dispositivos")
      .update({ activo: false })
      .eq("huella", huella);
    return NextResponse.json(
      { encontrado: false, olvidado: true },
      { headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  const { data } = await supabaseAdmin
    .from("dispositivos")
    .select("id, usuario_id, etiqueta, veces, ultima_marca, activo")
    .eq("huella", huella)
    .eq("activo", true)
    .limit(1);

  const vinculo = data?.[0];
  if (!vinculo) {
    return NextResponse.json(
      { encontrado: false },
      { headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  // Se resuelve la persona por id (sin JOIN, para que funcione igual en
  // modo demo).
  const { data: personas } = await supabaseAdmin
    .from("usuarios")
    .select("nombre, area")
    .eq("id", vinculo.usuario_id)
    .limit(1);

  const persona = personas?.[0];

  return NextResponse.json(
    {
      encontrado: true,
      usuarioId: vinculo.usuario_id,
      nombre: persona?.nombre ?? null,
      area: persona?.area ?? null,
      etiqueta: vinculo.etiqueta ?? null,
      veces: vinculo.veces ?? 0,
      ultimaMarca: vinculo.ultima_marca ?? null,
    },
    { headers: cabecerasCors(request.headers.get("origin")) }
  );
}
