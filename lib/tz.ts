/**
 * Zona horaria fija del sistema: America/Mexico_City.
 *
 * Toda marca se guarda en timestamptz (UTC) en la base de datos. Nunca se usa
 * la zona horaria del servidor ni la del navegador para calcular "el día",
 * la semana ni las horas. Toda conversión pasa por este módulo.
 *
 * Regla de oro: la BD guarda instantes (UTC); este módulo decide qué día es
 * "hoy" y qué hora marca el reloj en la oficina.
 */
export const TZ = "America/Mexico_City" as const;

/* ------------------------------------------------------------------ */
/* Instantes                                                           */
/* ------------------------------------------------------------------ */

/** Instante actual. Se guarda en UTC. */
export function ahoraMx(): Date {
  return new Date();
}

/** Convierte un instante a "HH:mm" en la zona de la oficina. */
export function formatoHM(fecha: Date | string): string {
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** Convierte un instante a "HH:mm:ss" en la zona de la oficina. */
export function formatoHMSegundos(fecha: Date | string): string {
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * Devuelve la fecha local (YYYY-MM-DD) del instante en zona oficina.
 *
 * Acepta:
 *   - un Date (instante),
 *   - una cadena ISO completa ("2026-06-10T15:02:00Z"),
 *   - una fecha simple ("2026-06-10"), que se interpreta como ese día local.
 */
export function fechaLocal(fecha: Date | string): string {
  let d: Date;
  if (typeof fecha === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      const partes = fecha.split("-").map(Number);
      d = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2], 12, 0, 0, 0));
    } else {
      d = new Date(fecha);
    }
  } else {
    d = fecha;
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Normaliza cualquier entrada a un Date válido. */
function aFecha(fecha: Date | string): Date {
  if (typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const partes = fecha.split("-").map(Number);
    return new Date(Date.UTC(partes[0], partes[1] - 1, partes[2], 12, 0, 0, 0));
  }
  return typeof fecha === "string" ? new Date(fecha) : fecha;
}

/** Fecha local en formato largo para encabezados: "viernes, 24 de octubre de 2025". */
export function fechaLarga(fecha: Date | string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(aFecha(fecha));
}

/** Fecha local corta para chips: "24 oct". */
export function fechaCorta(fecha: Date | string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
  })
    .format(aFecha(fecha))
    .replace(".", "");
}

/* ------------------------------------------------------------------ */
/* Límites del día (instantes UTC que corresponden al día local)      */
/* ------------------------------------------------------------------ */

/**
 * Desfase de la zona horaria, en minutos, en el instante dado.
 * Positivo si la zona local va por detrás de UTC (México: -360).
 */
function desfaseZonaMinutos(fecha: Date): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(fecha)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  const localComoUtc = Date.UTC(
    Number(partes.year),
    Number(partes.month) - 1,
    Number(partes.day),
    Number(partes.hour) % 24,
    Number(partes.minute),
    Number(partes.second)
  );

  return Math.round((localComoUtc - fecha.getTime()) / 60000);
}

/**
 * Instante UTC que corresponde a las 00:00:00 del día local indicado.
 *
 * OJO: el día en México empieza a las 06:00 UTC, no a las 00:00 UTC.
 * Usar la medianoche UTC dejaría fuera (o dentro) las marcas de las
 * primeras o últimas 6 horas del día.
 */
export function inicioDiaMx(fecha: Date | string): Date {
  const partes = fechaLocal(fecha).split("-").map(Number);
  const medianocheLocal = Date.UTC(partes[0], partes[1] - 1, partes[2], 0, 0, 0, 0);

  // Dos pasadas: la primera estima el desfase, la segunda lo corrige
  // (por ejemplo cuando el horario de verano cambia justo ese día).
  let instante = medianocheLocal;
  for (let i = 0; i < 2; i++) {
    const desfase = desfaseZonaMinutos(new Date(instante));
    instante = medianocheLocal - desfase * 60000;
  }

  return new Date(instante);
}

/** Instante UTC que corresponde a las 23:59:59.999 del día local indicado. */
export function finDiaMx(fecha: Date | string): Date {
  return new Date(inicioDiaMx(fecha).getTime() + 24 * 60 * 60 * 1000 - 1);
}

/* ------------------------------------------------------------------ */
/* Días de la semana                                                   */
/* ------------------------------------------------------------------ */

export const NOMBRES_DIA = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

/** 0 = domingo ... 6 = sábado (en zona oficina). */
export function diaSemanaNumericoMx(fecha: Date | string): number {
  const partes = fechaLocal(aFecha(fecha)).split("-").map(Number);
  const local = new Date(
    Date.UTC(partes[0], partes[1] - 1, partes[2], 12, 0, 0, 0)
  );
  return local.getUTCDay();
}

export function diaSemanaMx(fecha: Date | string): number {
  return diaSemanaNumericoMx(fecha);
}

export function esDomingoMx(fecha: Date | string): boolean {
  return diaSemanaNumericoMx(fecha) === 0;
}

export function esSabadoMx(fecha: Date | string): boolean {
  return diaSemanaNumericoMx(fecha) === 6;
}

/** Semana laboral: lunes (1) a sábado (6). El domingo no es laboral. */
export function esDiaLaboralMx(fecha: Date | string): boolean {
  const d = diaSemanaNumericoMx(fecha);
  return d >= 1 && d <= 6;
}

/** Devuelve el lunes de la semana de una fecha (instante UTC del mediodía local). */
export function lunesDeLaSemanaMx(fecha: Date | string): Date {
  const partes = fechaLocal(fecha).split("-").map(Number);
  const d = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2], 12, 0, 0, 0));
  const dia = d.getUTCDay();
  const ajuste = dia === 0 ? -6 : 1 - dia;
  d.setUTCDate(d.getUTCDate() + ajuste);
  return d;
}

/** Suma días a una fecha local (YYYY-MM-DD) y devuelve YYYY-MM-DD. */
export function sumarDias(fecha: string, dias: number): string {
  const partes = fecha.split("-").map(Number);
  const d = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2], 12, 0, 0, 0));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Minutos <-> HH:mm                                                   */
/* ------------------------------------------------------------------ */

export function minutosAHHMM(minutos: number): string {
  const total = Math.max(0, Math.round(minutos));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Convierte "HH:mm" a minutos desde medianoche. Devuelve null si es inválido. */
export function hhmmAMinutos(valor: string | null | undefined): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const partes = String(valor).trim().split(":");
  if (partes.length < 2) return null;
  const h = Number(partes[0]);
  const min = Number(partes[1]);
  if (
    !Number.isFinite(h) ||
    !Number.isFinite(min) ||
    h < 0 ||
    h > 23 ||
    min < 0 ||
    min > 59
  ) {
    return null;
  }
  return h * 60 + min;
}

export function minutosEntre(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / 60000);
}
