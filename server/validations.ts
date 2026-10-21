/**
 * Esquemas Zod para validar todas las entradas del sistema.
 * Nunca se confía en datos del cliente.
 */
import { z } from "zod";

/**
 * Token personal de checada.
 * 24 caracteres del alfabeto sin ambigüedades (sin 0,1,I,O,L,S).
 */
export const TokenSchema = z
  .string()
  .trim()
  .min(8, "Token requerido")
  .max(64, "Token demasiado largo")
  .regex(/^[A-Za-z0-9_-]+$/, "Token con formato inválido");

export const ChecarSchema = z.object({
  token: TokenSchema,
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
});

export type ChecarInput = z.infer<typeof ChecarSchema>;

/** Formato de fecha usado en toda la API: YYYY-MM-DD. */
export const FechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe ser YYYY-MM-DD");

/** Formato de hora: HH:mm en 24 horas. */
export const HoraSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora debe ser HH:mm (24 horas)");
