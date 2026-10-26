/**
 * PUT /api/usuarios/[id]/fecha-inicio
 *
 * Registra (o actualiza) la fecha en la que un colaborador empezó a laburar.
 * Se usa para calcular años de servicio y vacaciones.
 *
 * Body: { "fecha_inicio_laburo": "YYYY-MM-DD" }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cabecerasCors } from "@/lib/cors";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  fecha_inicio_laburo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe ser YYYY-MM-DD")
    .optional()
    .nullable(),
});

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: cabecerasCors(request.headers.get("origin")),
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { motivo: "error", mensaje: "Cuerpo inválido" } },
      { status: 400, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  const validado = BodySchema.safeParse(body);
  if (!validado.success) {
    return NextResponse.json(
      { ok: false, error: { motivo: "error", mensaje: validado.error.errors.map((e) => e.message).join(", ") } },
      { status: 400, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  const { fecha_inicio_laburo } = validado.data;

  // Verificar que el usuario exista.
  const { data: existente } = await supabaseAdmin
    .from("usuarios")
    .select("id, nombre")
    .eq("id", id)
    .maybeSingle();

  if (!existente) {
    return NextResponse.json(
      { ok: false, error: { motivo: "no_encontrado", mensaje: "Usuario no encontrado." } },
      { status: 404, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  const { error } = await supabaseAdmin
    .from("usuarios")
    .update({ fecha_inicio_laburo })
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { ok: false, error: { motivo: "error", mensaje: error.message } },
      { status: 500, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      mensaje: `Fecha de inicio actualizada para ${existente.nombre}.`,
      fecha_inicio_laburo,
    },
    { headers: cabecerasCors(request.headers.get("origin")) }
  );
}
