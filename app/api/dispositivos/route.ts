/**
 * GET /api/dispositivos/no-asignados
 *
 * Lista dispositivos (celulares/tablets) que NO están vinculados a ningún usuario.
 * Sirve para que el admin los vea y les asigne un nombre.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cabecerasCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: cabecerasCors(request.headers.get("origin")),
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { data, error } = await supabaseAdmin
    .from("dispositivos")
    .select("id, huella, etiqueta, agente, primera_marca, ultima_marca, veces, activo, usuario_id")
    .is("usuario_id", null)
    .order("ultima_marca", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: { motivo: "error", mensaje: error.message } },
      { status: 500, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  const dispositivos = (data ?? []).map((d) => ({
    id: d.id,
    huella: d.huella,
    etiqueta: d.etiqueta ?? null,
    agente: d.agente ?? null,
    primeraMarca: d.primera_marca ?? null,
    ultimaMarca: d.ultima_marca ?? null,
    veces: d.veces ?? 0,
    activo: d.activo !== false,
    usuarioId: d.usuario_id ?? null,
  }));

  return NextResponse.json(
    { ok: true, dispositivos },
    { headers: cabecerasCors(request.headers.get("origin")) }
  );
}
