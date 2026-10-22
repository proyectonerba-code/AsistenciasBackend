/**
 * Identificación en terminal compartida.
 *
 * La persona escanea una etiqueta NFC/QR cuyo enlace es genérico (/c).
 * El sistema le pide su correo (o su nombre, como respaldo), lo valida
 * contra la tabla `usuarios` y devuelve una SESIÓN de vida corta: sirve
 * únicamente para una checada y expira en 5 minutos.
 *
 * Nunca se devuelve el token personal: ese sigue siendo el secreto de la
 * credencial individual.
 */
import { supabaseAdmin } from "../lib/supabase/server";
import { crearSesion } from "./sesion";
import { IdentificarSchema, type IdentificarInput } from "./validations";

export interface Identificado {
  id: string;
  nombre: string;
  correo: string;
  area: string;
}

export type MotivoIdentificacion =
  | "no encontrado"
  | "varios"
  | "inactivo"
  | "invalido";

export type ResultadoIdentificar =
  | { ok: true; data: { sesion: string; usuario: Identificado } }
  | {
      ok: false;
      error:
        | { motivo: "no encontrado"; mensaje: string }
        | { motivo: "varios"; mensaje: string; candidatos: Identificado[] }
        | { motivo: "inactivo"; mensaje: string }
        | { motivo: "invalido"; mensaje: string };
    };

export async function identificar(
  input: IdentificarInput
): Promise<ResultadoIdentificar> {
  const validado = IdentificarSchema.safeParse(input);
  if (!validado.success) {
    return {
      ok: false,
      error: {
        motivo: "invalido",
        mensaje: "Escribe un correo válido o un nombre.",
      },
    };
  }

  const { correo, nombre, id } = validado.data;

  let usuarios: Identificado[] = [];

  if (id) {
    const { data } = await supabaseAdmin
      .from("usuarios")
      .select("id, nombre, correo, area, activo")
      .eq("id", id)
      .limit(1);
    usuarios = (data ?? []) as Identificado[];
  } else if (correo) {
    const { data } = await supabaseAdmin
      .from("usuarios")
      .select("id, nombre, correo, area, activo")
      .eq("correo", correo)
      .limit(1);
    usuarios = (data ?? []) as Identificado[];
  } else if (nombre) {
    // Búsqueda tolerante: el nombre puede venir sin acentos o con Appeal.
    const limpio = normalizar(nombre);
    const { data } = await supabaseAdmin
      .from("usuarios")
      .select("id, nombre, correo, area, activo");
    usuarios = (data ?? []).filter(
      (u) => normalizar(u.nombre).includes(limpio) ||
        normalizar(u.nombre.split(" ")[0] ?? "") === limpio
    ) as Identificado[];
  }

  if (usuarios.length === 0) {
    return {
      ok: false,
      error: {
        motivo: "no encontrado",
        mensaje:
          "No encontramos ese collaborator. Revisa el correo o pide que te den de alta.",
      },
    };
  }

  if (usuarios.length > 1) {
    return {
      ok: false,
      error: {
        motivo: "varios",
        mensaje: "Hay más de una persona con ese nombre. Elige cuál eres.",
        candidatos: usuarios.map((u) => ({
          id: u.id,
          nombre: u.nombre,
          correo: u.correo,
          area: u.area,
        })),
      },
    };
  }

  const usuario = usuarios[0];

  const { data: conActivo } = await supabaseAdmin
    .from("usuarios")
    .select("activo")
    .eq("id", usuario.id)
    .maybeSingle();

  if (conActivo && conActivo.activo === false) {
    return {
      ok: false,
      error: {
        motivo: "inactivo",
        mensaje: "Tu registro está dado de baja. Contacta al administrador.",
      },
    };
  }

  return {
    ok: true,
    data: {
      sesion: await crearSesion(usuario.id),
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        area: usuario.area,
      },
    },
  };
}

/** Normaliza texto para comparar nombres sin acentos ni mayúsculas. */
function normalizar(texto: string): string {
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
