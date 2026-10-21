/**
 * Lógica de negocio de /api/checar (servidor únicamente).
 *
 * Validaciones en orden:
 *  1. Token válido y usuario activo.
 *  2. Hora permitida (06:00-23:30, zona México, configurable).
 *  3. Geocerca Haversine + precisión GPS.
 *  4. Anti doble registro (< minEntreMarcas desde la última marca del día).
 *  5. Marca adicional: la 3ª marca del día no se usa como entrada ni salida.
 *  6. Inserción atómica (RPC registrar_marca con bloqueo por usuario).
 *
 * Toda entrada se valida con zod; nunca se confía en el cliente.
 *
 * REGLA DE ORO DEL SISTEMA: si la página no recibe la ubicación, NO se
 * registra nada. La ubicación es obligatoria para escribir una marca.
 */
import { supabaseAdmin } from "../lib/supabase/server";
import { sha256Hex, prefijoToken } from "../lib/crypto";
import { haversineMetros } from "../lib/haversine";
import {
  ahoraMx,
  fechaLocal,
  formatoHM,
  hhmmAMinutos,
  inicioDiaMx,
  finDiaMx,
  minutosAHHMM,
} from "../lib/tz";
import { verificarRateLimit } from "../lib/rate-limit";
import { ChecarSchema, type ChecarInput } from "./validations";

const HORA_MIN_DEFAULT = "06:00";
const HORA_MAX_DEFAULT = "23:30";
const MIN_ENTRE_MARCAS_DEFAULT = 5;
const RADIO_DEFAULT_M = 100;
const PRECISION_MAX_DEFAULT_M = 50;
const MAX_MARCAS_POR_DIA = 2; // entrada + salida

const ORIGEN_PUBLICO = "nfc";

type ConfigMap = Record<string, unknown>;

function cfgNumero(map: ConfigMap, clave: string, def: number): number {
  const v = map[clave];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!isNaN(n)) return n;
  }
  return def;
}

/** Lee un valor de config que puede venir como "06:00" (HH:mm) o como número de minutos. */
function cfgHora(map: ConfigMap, clave: string, def: string): string {
  const v = map[clave];
  if (typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v.trim())) return v.trim();
  if (typeof v === "number") return minutosAHHMM(v);
  return def;
}

export type MotivoRechazo =
  | "token invalido"
  | "usuario inactivo"
  | "hora no permitida"
  | "fuera de zona"
  | "precision insuficiente"
  | "sin ubicacion"
  | "doble registro"
  | "marca adicional";

type ResultadoChecarOk = {
  ok: true;
  data: {
    tipo: "ENTRADA" | "SALIDA";
    hora: string;
    nombre: string;
    usuarioId: string;
    sede: string | null;
    distanciaM: number | null;
    /** Nota informativa (p. ej. entrada abierta de un día anterior). */
    aviso: string | null;
  };
};

type ErrorChecar = {
  ok: false;
  error: {
    motivo: MotivoRechazo;
    mensaje: string;
    usuarioId?: string | null;
    tokenPrefijo?: string;
    lat?: number | null;
    lng?: number | null;
    accuracy?: number | null;
    distanciaM?: number | null;
  };
};

export type ResultadoChecar = ResultadoChecarOk | ErrorChecar;

/**
 * Inserta un intento rechazado en la tabla `rechazados`.
 * Siempre guarda lat, lng, accuracy y distancia_m (pueden ser null).
 */
async function registrarRechazo(params: {
  usuarioId?: string | null;
  tokenPrefijo: string;
  motivo: MotivoRechazo;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  distanciaM: number | null;
  detalle: string;
}): Promise<void> {
  try {
    await supabaseAdmin.from("rechazados").insert({
      usuario_id: params.usuarioId ?? null,
      token_prefijo: params.tokenPrefijo,
      motivo: params.motivo,
      lat: params.lat ?? null,
      lng: params.lng ?? null,
      accuracy: params.accuracy ?? null,
      distancia_m: params.distanciaM ?? null,
      detalle: params.detalle,
    });
  } catch (err) {
    console.error("No se pudo registrar el rechazo:", err);
  }
}

/* ------------------------------------------------------------------ */
/* Avisos al administrador (opcionales, con deduplicación)            */
/* ------------------------------------------------------------------ */

const ultimosAvisos = new Map<string, number>();
const AVISO_INTERVALO_MS = 60 * 1000;

async function enviarAvisoAdmin(
  clave: string,
  asunto: string,
  cuerpo: string
): Promise<void> {
  const ahora = Date.now();
  const previo = ultimosAvisos.get(clave);
  if (previo && ahora - previo < AVISO_INTERVALO_MS) return;
  ultimosAvisos.set(clave, ahora);

  if (ultimosAvisos.size > 50) {
    ultimosAvisos.forEach((v, k) => {
      if (ahora - v > AVISO_INTERVALO_MS * 3) ultimosAvisos.delete(k);
    });
  }

  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  const provider = process.env.EMAIL_PROVIDER;
  const resendKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM;

  const mensaje = `[Control de Asistencia]\n${asunto}\n\n${cuerpo}\n`;
  console.log("AVISO ADMIN:", mensaje);

  if (provider === "resend" && resendKey && resendFrom && adminEmail) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [adminEmail],
          subject: asunto,
          text: cuerpo,
        }),
      });
    } catch (err) {
      console.error("No se pudo enviar el aviso por correo:", err);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Lectura de información pública                                       */
/* ------------------------------------------------------------------ */

/**
 * Obtiene la información pública del token: nombre de la persona, última marca
 * del día (zona México) y si tiene una entrada abierta. SOLO LECTURA: nunca
 * registra nada.
 */
export async function obtenerInfoPublica(
  token: string
): Promise<{
  valido: boolean;
  nombre?: string;
  ultimaMarca?: string;
  tipoUltimaMarca?: "ENTRADA" | "SALIDA";
  area?: string;
}> {
  if (!token) return { valido: false };

  const tokenHash = await sha256Hex(token);

  const { data: usuarios } = await supabaseAdmin
    .from("usuarios")
    .select("id, nombre, area, activo, token_hash")
    .eq("token_hash", tokenHash)
    .limit(1);

  const usuario = usuarios?.[0];
  if (!usuario || !usuario.activo) {
    return { valido: false };
  }

  const hoy = fechaLocal(ahoraMx());
  const inicioDia = inicioDiaMx(hoy);
  const finDia = finDiaMx(hoy);

  const { data: marcas } = await supabaseAdmin
    .from("marcas")
    .select("ts")
    .eq("usuario_id", usuario.id)
    .gte("ts", inicioDia.toISOString())
    .lte("ts", finDia.toISOString())
    .order("ts", { ascending: false })
    .limit(2);

  let ultimaMarca: string | undefined;
  let tipoUltimaMarca: "ENTRADA" | "SALIDA" | undefined;

  const totalHoy = marcas?.length ?? 0;
  if (marcas?.[0]) {
    ultimaMarca = formatoHM(marcas[0].ts);
    // 1 marca = entrada, 2 = salida, 3 = entrada...
    tipoUltimaMarca = totalHoy % 2 === 1 ? "ENTRADA" : "SALIDA";
  }

  return {
    valido: true,
    nombre: usuario.nombre,
    ultimaMarca,
    tipoUltimaMarca,
    area: usuario.area,
  };
}

/* ------------------------------------------------------------------ */
/* Flujo principal de checada                                           */
/* ------------------------------------------------------------------ */

/**
 * Ejecuta todo el flujo de validación de una checada pública.
 */
export async function procesarChecar(
  input: ChecarInput,
  ip: string,
  userAgent: string
): Promise<ResultadoChecar> {
  const validacion = ChecarSchema.safeParse(input);
  if (!validacion.success) {
    const motivo: MotivoRechazo = "sin ubicacion";
    await registrarRechazo({
      tokenPrefijo: prefijoToken(input.token ?? ""),
      motivo,
      lat: null,
      lng: null,
      accuracy: null,
      distanciaM: null,
      detalle: `Entrada inválida: ${validacion.error.errors
        .map((e) => e.message)
        .join(", ")}`,
    });
    return {
      ok: false,
      error: {
        motivo,
        mensaje: "Activa tu ubicación para registrar",
        tokenPrefijo: prefijoToken(input.token ?? ""),
        lat: null,
        lng: null,
        accuracy: null,
      },
    };
  }

  const { token, lat, lng, accuracy } = validacion.data;
  const tokenPrefijo = prefijoToken(token);

  /* ---------------------------------------------------------------- */
  /* Rate limit por IP y por token                                     */
  /* ---------------------------------------------------------------- */
  const rlIp = verificarRateLimit(`ip:${ip}`);
  if (!rlIp.permitido) {
    return {
      ok: false,
      error: {
        motivo: "token invalido",
        mensaje: "Demasiados intentos. Intenta de nuevo en un minuto.",
        tokenPrefijo,
      },
    };
  }
  const rlToken = verificarRateLimit(`token:${tokenPrefijo}`);
  if (!rlToken.permitido) {
    return {
      ok: false,
      error: {
        motivo: "token invalido",
        mensaje: "Demasiados intentos con este token. Intenta de nuevo en un minuto.",
        tokenPrefijo,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Configuración del sistema                                         */
  /* ---------------------------------------------------------------- */
  const { data: configRows } = await supabaseAdmin
    .from("config")
    .select("clave, valor");
  const config: ConfigMap = {};
  for (const row of configRows ?? []) {
    config[row.clave] = row.valor;
  }

  const horaMin = cfgHora(config, "hora_min_registro", HORA_MIN_DEFAULT);
  const horaMax = cfgHora(config, "hora_max_registro", HORA_MAX_DEFAULT);
  const minEntreMarcas = cfgNumero(
    config,
    "minutos_entre_marcas",
    MIN_ENTRE_MARCAS_DEFAULT
  );
  const radioDefault = cfgNumero(
    config,
    "radio_geocerca_default_m",
    RADIO_DEFAULT_M
  );
  const precisionMax = cfgNumero(
    config,
    "precision_max_m",
    PRECISION_MAX_DEFAULT_M
  );

  const minRegistro = hhmmAMinutos(horaMin) ?? hhmmAMinutos(HORA_MIN_DEFAULT)!;
  const maxRegistro = hhmmAMinutos(horaMax) ?? hhmmAMinutos(HORA_MAX_DEFAULT)!;

  /* ---------------------------------------------------------------- */
  /* Usuario + token                                                   */
  /* ---------------------------------------------------------------- */
  const tokenHash = await sha256Hex(token);

  const { data: usuarios } = await supabaseAdmin
    .from("usuarios")
    .select("id, nombre, correo, area, activo, token_hash, token_prefijo")
    .eq("token_hash", tokenHash)
    .limit(1);

  const usuario = usuarios?.[0];

  if (!usuario) {
    await registrarRechazo({
      usuarioId: null,
      tokenPrefijo,
      motivo: "token invalido",
      lat: null,
      lng: null,
      accuracy: null,
      distanciaM: null,
      detalle: `Token no reconocido. Prefijo: ${tokenPrefijo}`,
    });
    await enviarAvisoAdmin(
      `token-invalido:${tokenPrefijo}`,
      "Rechazo: token inválido en checada pública",
      `Se intentó una checada con un token no válido o usuario inactivo.\n\n` +
        `Prefijo del token: ${tokenPrefijo}\n` +
        `IP: ${ip}\n` +
        `Fecha/hora: ${fechaLocal(ahoraMx())} ${formatoHM(ahoraMx())}\n`
    );
    return {
      ok: false,
      error: {
        motivo: "token invalido",
        mensaje: "Token inválido o usuario inactivo",
        tokenPrefijo,
      },
    };
  }

  if (!usuario.activo) {
    await registrarRechazo({
      usuarioId: usuario.id,
      tokenPrefijo,
      motivo: "usuario inactivo",
      lat: null,
      lng: null,
      accuracy: null,
      distanciaM: null,
      detalle: `El usuario ${usuario.nombre} está dado de baja.`,
    });
    return {
      ok: false,
      error: {
        motivo: "usuario inactivo",
        mensaje: "Tu registro está dado de baja. Contacta al administrador.",
        tokenPrefijo,
        usuarioId: usuario.id,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Hora permitida                                                    */
  /* ---------------------------------------------------------------- */
  const ahora = ahoraMx();
  const horaActualMinutos = hhmmAMinutos(formatoHM(ahora)) ?? 0;

  if (horaActualMinutos < minRegistro || horaActualMinutos > maxRegistro) {
    await registrarRechazo({
      usuarioId: usuario.id,
      tokenPrefijo,
      motivo: "hora no permitida",
      lat: lat ?? null,
      lng: lng ?? null,
      accuracy: accuracy ?? null,
      distanciaM: null,
      detalle: `Hora ${formatoHM(ahora)} fuera del rango permitido (${horaMin}-${horaMax}, hora Ciudad de México).`,
    });
    return {
      ok: false,
      error: {
        motivo: "hora no permitida",
        mensaje: `Fuera de horario permitido. El registro está habilitado de ${horaMin} a ${horaMax} (hora Ciudad de México).`,
        tokenPrefijo,
        usuarioId: usuario.id,
        lat: lat ?? null,
        lng: lng ?? null,
        accuracy: accuracy ?? null,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Ubicación obligatoria — si no llega, NO se registra nada          */
  /* ---------------------------------------------------------------- */
  if (lat === undefined || lat === null || lng === undefined || lng === null) {
    await registrarRechazo({
      usuarioId: usuario.id,
      tokenPrefijo,
      motivo: "sin ubicacion",
      lat: null,
      lng: null,
      accuracy: null,
      distanciaM: null,
      detalle: "La petición no incluyó coordenadas de ubicación.",
    });
    return {
      ok: false,
      error: {
        motivo: "sin ubicacion",
        mensaje: "Activa tu ubicación para registrar",
        tokenPrefijo,
        usuarioId: usuario.id,
        lat: null,
        lng: null,
        accuracy: null,
      },
    };
  }

  const accuracyNum = accuracy ?? 0;

  /* ---------------------------------------------------------------- */
  /* Precisión del GPS                                                 */
  /* ---------------------------------------------------------------- */
  if (accuracyNum > precisionMax) {
    await registrarRechazo({
      usuarioId: usuario.id,
      tokenPrefijo,
      motivo: "precision insuficiente",
      lat,
      lng,
      accuracy: accuracyNum,
      distanciaM: null,
      detalle: `Precisión ${Math.round(accuracyNum)} m supera el máximo permitido de ${precisionMax} m.`,
    });
    return {
      ok: false,
      error: {
        motivo: "precision insuficiente",
        mensaje: `Precisión insuficiente (${Math.round(accuracyNum)} m). Activa el GPS y vuelve a intentar.`,
        tokenPrefijo,
        usuarioId: usuario.id,
        lat,
        lng,
        accuracy: accuracyNum,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Geocerca                                                          */
  /* ---------------------------------------------------------------- */
  const { data: sedes } = await supabaseAdmin
    .from("sedes")
    .select("id, nombre, lat, lng, radio_m")
    .eq("activa", true);

  let distanciaMasCercana: number | null = null;
  let sedeMasCercanaId: string | null = null;
  let sedeMasCercanaNombre: string | null = null;
  let dentroDeGeocerca = false;

  for (const sede of sedes ?? []) {
    const d = haversineMetros(lat, lng, sede.lat, sede.lng);
    const radio = sede.radio_m ?? radioDefault;
    if (distanciaMasCercana === null || d < distanciaMasCercana) {
      distanciaMasCercana = d;
      sedeMasCercanaId = sede.id;
      sedeMasCercanaNombre = sede.nombre;
    }
    if (d <= radio) {
      dentroDeGeocerca = true;
    }
  }

  if (!dentroDeGeocerca || distanciaMasCercana === null) {
    await registrarRechazo({
      usuarioId: usuario.id,
      tokenPrefijo,
      motivo: "fuera de zona",
      lat,
      lng,
      accuracy: accuracyNum,
      distanciaM: distanciaMasCercana,
      detalle: `A ${Math.round(distanciaMasCercana ?? 0)} m de la sede más cercana (fuera de geocerca).`,
    });
    return {
      ok: false,
      error: {
        motivo: "fuera de zona",
        mensaje: `Fuera de zona de registro. Estás a ${Math.round(
          distanciaMasCercana ?? 0
        )} m de la sede más cercana.`,
        tokenPrefijo,
        usuarioId: usuario.id,
        lat,
        lng,
        accuracy: accuracyNum,
        distanciaM: distanciaMasCercana,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Anti doble registro + marca adicional                            */
  /* ---------------------------------------------------------------- */
  const hoy = fechaLocal(ahora);

  // Una sola consulta trae las marcas más recientes de la persona.
  // Como el máximo es de 2 marcas por día (entrada + salida), 5 registros
  // alcanzan para saber cuántas hay hoy y si quedó una entrada abierta
  // de un día anterior.
  const { data: marcasRecientes } = await supabaseAdmin
    .from("marcas")
    .select("ts")
    .eq("usuario_id", usuario.id)
    .order("ts", { ascending: false })
    .limit(5);

  const marcasHoy = (marcasRecientes ?? []).filter(
    (m) => fechaLocal(m.ts) === hoy
  );
  const marcasPrevias = (marcasRecientes ?? []).filter(
    (m) => fechaLocal(m.ts) !== hoy
  );

  const ultimaMarcaHoy = marcasHoy[0]?.ts
    ? new Date(marcasHoy[0].ts)
    : null;

  if (ultimaMarcaHoy) {
    const diffMin = Math.round(
      (ahora.getTime() - ultimaMarcaHoy.getTime()) / 60000
    );
    if (diffMin < minEntreMarcas) {
      await registrarRechazo({
        usuarioId: usuario.id,
        tokenPrefijo,
        motivo: "doble registro",
        lat,
        lng,
        accuracy: accuracyNum,
        distanciaM: distanciaMasCercana,
        detalle: `Última marca hace ${diffMin} min (mínimo ${minEntreMarcas} min).`,
      });
      return {
        ok: false,
        error: {
          motivo: "doble registro",
          mensaje: `Ya registraste hace ${diffMin} min`,
          tokenPrefijo,
          usuarioId: usuario.id,
          lat,
          lng,
          accuracy: accuracyNum,
          distanciaM: distanciaMasCercana,
        },
      };
    }
  }

  // La tercera marca del día no se usa como entrada ni como salida:
  // se conserva solo como incidencia en la tabla de rechazados.
  if (marcasHoy.length >= MAX_MARCAS_POR_DIA) {
    await registrarRechazo({
      usuarioId: usuario.id,
      tokenPrefijo,
      motivo: "marca adicional",
      lat,
      lng,
      accuracy: accuracyNum,
      distanciaM: distanciaMasCercana,
      detalle: `El día ya tiene ${marcasHoy.length} marcas (entrada y salida cerradas). Esta marca se conserva solo como incidencia.`,
    });
    return {
      ok: false,
      error: {
        motivo: "marca adicional",
        mensaje:
          "Ya tienes tu entrada y tu salida registradas hoy. Esta marca quedó como incidencia.",
        tokenPrefijo,
        usuarioId: usuario.id,
        lat,
        lng,
        accuracy: accuracyNum,
        distanciaM: distanciaMasCercana,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Inserción atómica                                                 */
  /* ---------------------------------------------------------------- */
  const { data: resultado, error: rpcError } = await supabaseAdmin.rpc(
    "registrar_marca",
    {
      p_usuario_id: usuario.id,
      p_lat: lat,
      p_lng: lng,
      p_accuracy: accuracyNum,
      p_distancia_m: distanciaMasCercana,
      p_sede_id: sedeMasCercanaId,
      p_origen: ORIGEN_PUBLICO,
      p_ip: ip,
      p_user_agent: userAgent,
    }
  );

  if (rpcError || !resultado) {
    await registrarRechazo({
      usuarioId: usuario.id,
      tokenPrefijo,
      motivo: "token invalido",
      lat,
      lng,
      accuracy: accuracyNum,
      distanciaM: distanciaMasCercana,
      detalle: `Error del servidor al registrar la marca: ${
        rpcError?.message ?? "desconocido"
      }`,
    });
    return {
      ok: false,
      error: {
        motivo: "token invalido",
        mensaje: "Error al registrar la marca. Intenta de nuevo.",
        tokenPrefijo,
        usuarioId: usuario.id,
        lat,
        lng,
        accuracy: accuracyNum,
        distanciaM: distanciaMasCercana,
      },
    };
  }

  const fila = Array.isArray(resultado) ? resultado[0] : resultado;

  // Aviso informativo si quedó una entrada abierta de otro día.
  let aviso: string | null = null;
  const previa = marcasPrevias[0];

  if (previa?.ts && fila.tipo === "ENTRADA") {
    const prev = new Date(previa.ts);
    const diffMin = Math.round((ahora.getTime() - prev.getTime()) / 60000);
    aviso = `Tenías una entrada abierta del ${fechaLocal(prev)}. Se registra una nueva entrada; el cierre del día anterior lo debe hacer el administrador.`;
    console.log(
      `[Control de Asistencia] ${usuario.nombre}: ${aviso} (hace ${diffMin} min)`
    );
  }

  return {
    ok: true,
    data: {
      tipo: fila.tipo as "ENTRADA" | "SALIDA",
      hora: fila.hora as string,
      nombre: usuario.nombre,
      usuarioId: usuario.id,
      sede: sedeMasCercanaNombre,
      distanciaM: distanciaMasCercana,
      aviso,
    },
  };
}
