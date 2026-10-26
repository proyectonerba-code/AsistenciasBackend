/**
 * POST /api/dispositivo/asignar
 *
 * Asigna un dispositivo (huella) a un usuario existente.
 * Body: { "huella": "string", "usuarioId": "uuid" }
 *
 * Si el dispositivo ya estaba vinculado a otro usuario, se actualiza el vínculo.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cabecerasCors } from "@/lib/cors";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  huella: z.string().min(8, "Huella requerida").max(64, "Huella demasiado larga"),
  usuarioId: z.string().uuid("ID de usuario inválido"),
});

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: cabecerasCors(request.headers.get("origin")),
  });
}

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

  const validado = BodySchema.safeParse(body);
  if (!validado.success) {
    return NextResponse.json(
      { ok: false, error: { motivo: "error", mensaje: validado.error.errors.map((e) => e.message).join(", ") } },
      { status: 400, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  const { huella, usuarioId } = validado.data;

  // Verificar que el usuario exista y esté activo.
  const { data: usuario } = await supabaseAdmin
    .from("usuarios")
    .select("id, nombre, activo")
    .eq("id", usuarioId)
    .maybeSingle();

  if (!usuario) {
    return NextResponse.json(
      { ok: false, error: { motivo: "no_encontrado", mensaje: "Usuario no encontrado." } },
      { status: 404, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  if (!usuario.activo) {
    return NextResponse.json(
      { ok: false, error: { motivo: "inactivo", mensaje: "El usuario está dado de baja." } },
      { status: 400, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  // Insertar o actualizar el vínculo dispositivo -> usuario.
  const { data: dispositivo, error } = await supabaseAdmin
    .from("dispositivos")
    .upsert(
      {
        usuario_id: usuarioId,
        huella,
        etiqueta: null,
        agente: null,
        primera_marca: new Date().toISOString(),
        ultima_marca: new Date().toISOString(),
        veces: 1,
        activo: true,
      },
      { onConflict: "huella" }
    )
    .select("id, usuario_id, huella, activo")
    .single();

  if (error || !dispositivo) {
    return NextResponse.json(
      { ok: false, error: { motivo: "error", mensaje: error?.message ?? "No se pudo asignar el dispositivo." } },
      { status: 500, headers: cabecerasCors(request.headers.get("origin")) }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      mensaje: `Dispositivo asignado a ${usuario.nombre}.`,
      dispositivo: {
        id: dispositivo.id,
        usuarioId: dispositivo.usuario_id,
        huella: dispositivo.huella,
        activo: dispositivo.activo,
      },
    },
    { headers: cabecerasCors(request.headers.get("origin")) }
  );
}
