/**
 * Esquemas Zod para validar todas las entradas del sistema.
 * Nunca se confía en datos del cliente.
 */
import { z } from "zod";

/**
 * Token personal de checada.
 * 16 caracteres del alfabeto sin ambigüedades (sin 0,1,I,O,L,S).
 */
export const TokenSchema = z
  .string()
  .trim()
  .min(8, "Token requerido")
  .max(64, "Token demasiado largo")
  .regex(/^[A-Za-z0-9_-]+$/, "Token con formato inválido");

/**
 * Sesión de terminal: token de vida corta firmado por el servidor.
 * Formato base64url(payload).base64url(firma).
 */
export const SesionSchema = z
  .string()
  .trim()
  .min(20, "Sesión inválida")
  .max(512, "Sesión inválida")
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "Sesión con formato inválido");

/** Huella del dispositivo: UUID que genera el navegador. */
export const HuellaSchema = z
  .string()
  .trim()
  .min(8, "Huella demasiado corta")
  .max(64, "Huella demasiado larga")
  .regex(/^[A-Za-z0-9_-]+$/, "Huella con formato inválido");

export const ChecarSchema = z.object({
  /** Token personal (credencial) o sesión temporal (terminal compartida). */
  token: TokenSchema.optional(),
  sesion: SesionSchema.optional(),
  lat: z
    .number()
    .min(-90, "Latitud inválida")
    .max(90, "Latitud inválida")
    .optional(),
  lng: z
    .number()
    .min(-180, "Longitud inválida")
    .max(180, "Longitud inválida")
    .optional(),
  accuracy: z.number().nonnegative("Precisión inválida").optional(),
  /** Identificador del dispositivo (para analizarlo y no reidentificar). */
  dispositivo: HuellaSchema.optional(),
  /** Nombre legible del dispositivo. */
  etiqueta: z.string().trim().max(120).optional(),
});

export type ChecarInput = z.infer<typeof ChecarSchema>;

/** Identificación en terminal compartida. */
export const IdentificarSchema = z
  .object({
    correo: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Correo inválido")
      .optional(),
    nombre: z.string().trim().min(2).max(120).optional(),
    /** Cuando hay varios con el mismo nombre, el cliente elige el id. */
    id: z.string().uuid().optional(),
  })
  .refine((d) => Boolean(d.correo || d.nombre || d.id), {
    message: "Indica correo, nombre o id",
  });

export type IdentificarInput = z.infer<typeof IdentificarSchema>;

/** Formato de fecha usado en toda la API: YYYY-MM-DD. */
export const FechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe ser YYYY-MM-DD");

/** Formato de hora: HH:mm en 24 horas. */
export const HoraSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora debe ser HH:mm (24 horas)");
