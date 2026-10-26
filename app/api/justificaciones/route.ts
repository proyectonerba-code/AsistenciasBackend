/**
 * GET /api/justificaciones
 *   Lista justificaciones (faltas justificadas) con filtros opcionales:
 *     ?usuario_id=<uuid>&fecha_desde=YYYY-MM-DD&fecha_hasta=YYYY-MM-DD
 *
 * POST /api/justificaciones
 *   Crea una justificación manual.
 *   Body: { "usuario_id": "uuid", "fecha": "YYYY-MM-DD", "tipo": "enfermedad|festivo|asunto_proprio|otro", "motivo": "texto" }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cabecerasCors } from "@/lib/cors";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CrearSchema = z.object({
  usuario_id: z.string().uuid("ID de usuario inválido"),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe ser YYYY-MM-DD"),
  tipo: z.enum(["enfermedad", "festivo", "asunto_proprio", "otro"]),
  motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
});

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: cabecerasCors(request.headers.get("origin")),
  });
}

/* ------------------------------------------------------------------ */
/* GET — listar justificaciones                                       */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const usuarioId = searchParams.get("usuario_id") ?? undefined;
  const fechaDesde = searchParams.get("fecha_desde") ?? undefined;
  const fechaHasta = searchParams.get("fecha_hasta") ?? undefined;

  let q = supabaseAdmin
    .from("justificaciones")
    .select(
      "id, usuario_id, fecha, tipo, motivo, creada_en, creada_por, usuarios(nombre, correo)"
    )
    .order("fecha", { ascending: false });

  if (usuarioId) q = q.eq("usuario_id", usuarioId);
  if (fechaDesde) q = q.gte("fecha", fechaDesde);
  if (fechaHasta) q = q.lte("fecha", fechaHasta);

  const { data, error } = await q;

  if (error) {
    return NextResponse.json(
      { ok: false, error: { motivo: "error", mensaje: error.message } },
      { status: 500, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  const justificaciones = (data ?? []).map((j) => ({
    id: j.id,
    usuarioId: j.usuario_id,
    nombre: (j as any).usuarios?.nombre ?? "—",
    correo: (j as any).usuarios?.correo ?? "—",
    fecha: j.fecha,
    tipo: j.tipo,
    motivo: j.motivo,
    creadaEn: j.creada_en,
    creadaPor: j.creada_por,
  }));

  return NextResponse.json(
    { ok: true, justificaciones },
    { headers: cabecerasCors(request.headers.get("origin")) }
  );
}

/* ------------------------------------------------------------------ */
/* POST — crear justificación                                         */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { motivo: "error", mensaje: "Cuerpo inválido" } },
      { status: 400, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  const validado = CrearSchema.safeParse(body);
  if (!validado.success) {
    return NextResponse.json(
      { ok: false, error: { motivo: "error", mensaje: validado.error.errors.map((e) => e.message).join(", ") } },
      { status: 400, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  const { usuario_id, fecha, tipo, motivo } = validado.data;

  // Verificar que el usuario exista.
  const { data: usuario } = await supabaseAdmin
    .from("usuarios")
    .select("id, nombre")
    .eq("id", usuario_id)
    .maybeSingle();

  if (!usuario) {
    return NextResponse.json(
      { ok: false, error: { motivo: "no_encontrado", mensaje: "Usuario no encontrado." } },
      { status: 404, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  // La creada_por se toma de un header opcional o se deja como "admin-panel".
  const creadaPor = request.headers.get("x-admin-correo") ?? "admin-panel";

  const { data, error } = await supabaseAdmin
    .from("justificaciones")
    .insert({
      usuario_id,
      fecha,
      tipo,
      motivo: motivo.trim(),
      creada_por: creadaPor,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: { motivo: "error", mensaje: error?.message ?? "No se pudo crear la justificación." } },
      { status: 500, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      mensaje: `Justificación registrada para ${usuario.nombre} el ${fecha}.`,
      justificacion: {
        id: data.id,
        usuarioId: data.usuario_id,
        fecha: data.fecha,
        tipo: data.tipo,
        motivo: data.motivo,
        creadaEn: data.creada_en,
      },
    },
    { headers: cabecerasCors(request.headers.get("origin")) }
  );
}
