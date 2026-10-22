/**
 * Cliente Supabase simulado para el MODO DEMO (sin base de datos real).
 *
 * Implementa el subconjunto de la API de supabase-js que usa el sistema:
 * from(tabla).select().eq().not().gte().lte().order().limit().single()
 * .maybeSingle().insert().upsert().delete() y rpc().
 *
 * Solo para desarrollo/presentación. En producción se usa Supabase real.
 */

type Fila = Record<string, unknown>;

type Filtro =
  | { op: "eq"; col: string; val: unknown }
  | { op: "not"; col: string; val: unknown }
  | { op: "gte"; col: string; val: unknown }
  | { op: "lte"; col: string; val: unknown }
  | { op: "gt"; col: string; val: unknown }
  | { op: "lt"; col: string; val: unknown }
  | { op: "in"; col: string; val: unknown[] };

interface TablasDemo {
  usuarios: Fila[];
  sedes: Fila[];
  marcas: Fila[];
  ajustes_manuales: Fila[];
  horarios_especiales: Fila[];
  config: Fila[];
  faltas: Fila[];
  rechazados: Fila[];
  bitacora: Fila[];
  admins: Fila[];
  avisos_admin: Fila[];
}

export interface ResultadoDemo<T> {
  data: T | null;
  error: { message: string } | null;
}

function comparar(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function cumple(fila: Fila, filtros: Filtro[]): boolean {
  for (const f of filtros) {
    const valor = fila[f.col];
    switch (f.op) {
      case "eq":
        if (String(valor) !== String(f.val)) return false;
        break;
      case "not":
        if (f.val === null) {
          // .not(col, "is", null) -> solo filas donde la columna NO es null
          if (valor === null || valor === undefined) return false;
        } else if (String(valor) === String(f.val)) {
          return false;
        }
        break;
      case "gte":
        if (valor === null || valor === undefined) return false;
        if (comparar(valor, f.val) < 0) return false;
        break;
      case "lte":
        if (valor === null || valor === undefined) return false;
        if (comparar(valor, f.val) > 0) return false;
        break;
      case "gt":
        if (valor === null || valor === undefined) return false;
        if (comparar(valor, f.val) <= 0) return false;
        break;
      case "lt":
        if (valor === null || valor === undefined) return false;
        if (comparar(valor, f.val) >= 0) return false;
        break;
      case "in":
        if (!Array.isArray(f.val)) return false;
        if (!f.val.some((v) => String(v) === String(valor))) return false;
        break;
    }
  }
  return true;
}

/**
 * Crea el cliente demo. Los datos viven en memoria durante el proceso.
 */
export function crearSupabaseDemo(datos: {
  usuarios: object[];
  sedes: object[];
  marcas: object[];
  ajustes_manuales: object[];
  faltas: object[];
  config: object[];
  admins: object[];
  horarios_especiales?: object[];
  rechazados?: object[];
  bitacora?: object[];
  avisos_admin?: object[];
}): { cliente: unknown; tablas: TablasDemo } {
  const aFilas = (filas: object[]): Fila[] => filas.map((f) => ({ ...f }));

  const tablas: TablasDemo = {
    usuarios: aFilas(datos.usuarios),
    sedes: aFilas(datos.sedes),
    marcas: aFilas(datos.marcas),
    ajustes_manuales: aFilas(datos.ajustes_manuales),
    horarios_especiales: aFilas(datos.horarios_especiales ?? []),
    config: aFilas(datos.config),
    faltas: aFilas(datos.faltas),
    rechazados: aFilas(datos.rechazados ?? []),
    bitacora: aFilas(datos.bitacora ?? []),
    admins: aFilas(datos.admins),
    avisos_admin: aFilas(datos.avisos_admin ?? []),
  };

  let contador = 0;
  const nuevoUuid = (): string => {
    contador++;
    return `90000000-0000-4000-8000-${String(contador).padStart(12, "0")}`;
  };

  const tabla = (nombre: string) => {
    const filas = tablas[nombre as keyof TablasDemo];
    if (!filas) {
      throw new Error(`Tabla demo desconocida: ${nombre}`);
    }

    const filtros: Filtro[] = [];
    let modo: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let limite: number | null = null;
    let orden: { col: string; asc: boolean } | null = null;
    let single = false;
    let maybeSingle = false;
    let datosInsert: Fila[] = [];
    let claveConflicto: string[] = [];
    let soloCabecera = false;
    let pedirConteo = false;

    const builder: Record<string, unknown> = {};

    const filtrar = (): Fila[] => {
      let out = filas.filter((f) => cumple(f, filtros));
      if (orden) {
        const col = orden.col;
        const asc = orden.asc;
        out = [...out].sort((a, b) => {
          const r = comparar(a[col], b[col]);
          return asc ? r : -r;
        });
      }
      if (limite !== null) out = out.slice(0, limite);
      return out;
    };

    builder.select = (
      _cols?: string,
      opts?: { count?: string; head?: boolean }
    ) => {
      soloCabecera = opts?.head === true;
      pedirConteo = opts?.count === "exact";
      return builder;
    };
    builder.eq = (col: string, val: unknown) => {
      filtros.push({ op: "eq", col, val });
      return builder;
    };
    builder.not = (col: string, _op: string, val: unknown) => {
      filtros.push({ op: "not", col, val });
      return builder;
    };
    builder.gte = (col: string, val: unknown) => {
      filtros.push({ op: "gte", col, val });
      return builder;
    };
    builder.lte = (col: string, val: unknown) => {
      filtros.push({ op: "lte", col, val });
      return builder;
    };
    builder.gt = (col: string, val: unknown) => {
      filtros.push({ op: "gt", col, val });
      return builder;
    };
    builder.lt = (col: string, val: unknown) => {
      filtros.push({ op: "lt", col, val });
      return builder;
    };
    builder.in = (col: string, valores: unknown[]) => {
      filtros.push({ op: "in", col, val: valores });
      return builder;
    };
    builder.order = (col: string, opts?: { ascending?: boolean }) => {
      orden = { col, asc: opts?.ascending !== false };
      return builder;
    };
    builder.limit = (n: number) => {
      limite = n;
      return builder;
    };
    builder.single = () => {
      single = true;
      maybeSingle = false;
      return builder;
    };
    builder.maybeSingle = () => {
      single = true;
      maybeSingle = true;
      return builder;
    };
    builder.insert = (vals: Fila | Fila[]) => {
      modo = "insert";
      datosInsert = Array.isArray(vals) ? vals : [vals];
      return builder;
    };
    builder.upsert = (vals: Fila | Fila[], opts?: { onConflict?: string }) => {
      modo = "upsert";
      datosInsert = Array.isArray(vals) ? vals : [vals];
      claveConflicto = (opts?.onConflict ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      // PostgREST usa la primary key cuando no se indica on_conflict.
      // En el demo, la primary key se deduce de la propia fila.
      if (claveConflicto.length === 0 && datosInsert[0]) {
        claveConflicto = "clave" in datosInsert[0] ? ["clave"] : ["id"];
      }
      return builder;
    };
    builder.update = (vals: Fila) => {
      modo = "update";
      datosInsert = [vals];
      return builder;
    };
    builder.delete = () => {
      modo = "delete";
      return builder;
    };

    builder.then = (
      resolve: (r: ResultadoDemo<unknown>) => unknown,
      reject?: (e: unknown) => unknown
    ): unknown => {
      try {
        if (modo === "insert" || modo === "upsert") {
          let insertada: Fila | null = null;
          for (const val of datosInsert) {
            const fila: Fila = { ...val };
            if (!fila.id) fila.id = nuevoUuid();
            if (!fila.creado_en) fila.creado_en = new Date().toISOString();

            if (modo === "upsert" && claveConflicto.length > 0) {
              const existente = filas.find((f) =>
                claveConflicto.every((c) => String(f[c]) === String(fila[c]))
              );
              if (existente) {
                Object.assign(existente, fila);
                insertada = existente;
                continue;
              }
            }
            filas.push(fila);
            insertada = fila;
          }
          // El codigo real encadena .insert(...).select(...).single(): en
          // ese caso hay que devolver la fila recien insertada.
          if (single && insertada) {
            return resolve({ data: insertada, error: null });
          }
          return resolve({ data: null, error: null });
        }

        if (modo === "update") {
          // Se aplica y se sigue el flujo: el codigo real encadena
          // .update(...).eq(...).select(...).single() y espera la fila.
          const victims = filtrar();
          for (const v of victims) {
            Object.assign(v, datosInsert[0] ?? {});
          }
        }

        if (modo === "delete") {
          const victims = filtrar();
          for (const v of victims) {
            const i = filas.indexOf(v);
            if (i >= 0) filas.splice(i, 1);
          }
          return resolve({ data: null, error: null });
        }

        const out = filtrar();
        if (pedirConteo) {
          // Supabase devuelve { data, count, error } cuando se pide count.
          const resultado = { data: out, count: out.length, error: null };
          return resolve(resultado);
        }
        if (soloCabecera) {
          return resolve({ data: null, error: null });
        }
        if (single) {
          return resolve({
            data: out.length > 0 ? out[0] : null,
            // maybeSingle no es error cuando no hay coincidencias.
            error:
              out.length > 0 || maybeSingle
                ? null
                : { message: "No se encontró el registro" },
          });
        }
        return resolve({ data: out, error: null });
      } catch (e) {
        if (reject) return reject(e);
        return resolve({
          data: null,
          error: { message: e instanceof Error ? e.message : "Error demo" },
        });
      }
    };

    return builder;
  };

  const rpc = (nombre: string, params: Fila): Promise<ResultadoDemo<unknown>> => {
    if (nombre !== "registrar_marca") {
      return Promise.resolve({
        data: null,
        error: { message: `RPC demo no soportada: ${nombre}` },
      });
    }

    const usuarioId = String(params.p_usuario_id);
    const ahora = new Date();
    const hoyStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(ahora);

    const marcasDelUsuario = tablas.marcas.filter(
      (m) => m.usuario_id === usuarioId
    );

    const marcasHoy = marcasDelUsuario.filter((m) => {
      const f = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Mexico_City",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(String(m.ts)));
      return f === hoyStr;
    });

    const ultimaMarca = marcasDelUsuario
      .map((m) => new Date(String(m.ts)).getTime())
      .sort((a, b) => b - a)[0];

    let tipo = "ENTRADA";
    let entradaAbiertaOtroDia = false;

    if (ultimaMarca !== undefined) {
      const ultimaFechaStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Mexico_City",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(ultimaMarca));

      if (ultimaFechaStr === hoyStr) {
        tipo = marcasHoy.length % 2 === 1 ? "SALIDA" : "ENTRADA";
      } else {
        // Entrada abierta de otro día: nunca se cierra automáticamente.
        tipo = "ENTRADA";
        entradaAbiertaOtroDia = true;
      }
    }

    const ts = ahora.toISOString();

    tablas.marcas.push({
      id: nuevoUuid(),
      usuario_id: usuarioId,
      ts,
      lat: params.p_lat ?? null,
      lng: params.p_lng ?? null,
      accuracy: params.p_accuracy ?? null,
      distancia_m: params.p_distancia_m ?? null,
      sede_id: params.p_sede_id ?? null,
      origen: params.p_origen ?? "nfc",
      ip: params.p_ip ?? null,
      user_agent: params.p_user_agent ?? null,
      creado_en: ts,
    });

    const hora = new Intl.DateTimeFormat("es-MX", {
      timeZone: "America/Mexico_City",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(ahora);

    return Promise.resolve({
      data: [{ tipo, hora, ts, entrada_abierta_otro_dia: entradaAbiertaOtroDia }],
      error: null,
    });
  };

  const cliente = {
    from: (nombre: string) => tabla(nombre),
    rpc,
    auth: {
      signInWithPassword: async () => ({
        data: { user: { email: null } },
        error: { message: "Auth no disponible en modo demo" },
      }),
      signOut: async () => ({ error: null }),
      getUser: async () => ({ data: { user: null }, error: { message: "demo" } }),
    },
  };

  return { cliente, tablas };
}
