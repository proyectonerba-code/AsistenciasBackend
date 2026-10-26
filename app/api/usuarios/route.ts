/**
 * GET /api/usuarios
 *
 * Lista todos los usuarios (activos e inactivos) para el panel de administración.
 * Solo lectura: usa service role.
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
    .from("usuarios")
    .select(
      "id, nombre, correo, area, minutos_comida, legajo, etiqueta_nfc, token_prefijo, activo, fecha_inicio_laburo, creado_en"
    )
    .order("nombre");

  if (error) {
    return NextResponse.json(
      { ok: false, error: { motivo: "error", mensaje: error.message } },
      { status: 500, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  const usuarios = (data ?? []).map((u) => ({
    id: u.id,
    nombre: u.nombre,
    correo: u.correo,
    area: u.area ?? "Sin asignar",
    minutosComida: u.minutos_comida ?? 60,
    legajo: u.legajo ?? null,
    etiquetaNfc: u.etiqueta_nfc ?? null,
    tokenPrefijo: u.token_prefijo ?? null,
    activo: u.activo !== false,
    fechaInicioLaburo: u.fecha_inicio_laburo ?? null,
    creadoEn: u.creado_en ?? null,
  }));

  return NextResponse.json(
    { ok: true, usuarios },
    { headers: cabecerasCors(request.headers.get("origin")) }
  );
}
