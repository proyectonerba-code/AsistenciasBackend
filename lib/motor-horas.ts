/**
 * Motor de horas — librería pura, sin tocar la BD.
 *
 * Las MARCAS crudas son la fuente de verdad. Asistencia, semanas, extras y
 * reportes se CALCULAN a partir de marcas + ajustes manuales + horarios
 * especiales + faltas. No se duplican datos derivados.
 *
 * Todas las horas se manejan como minutos enteros desde medianoche (HH:mm, 24 h).
 * La zona horaria fija es America/Mexico_City (módulo tz.ts).
 *
 * Reglas heredadas del control de asistencia original:
 *  - Semana laboral: lunes a sábado. El domingo NO es laboral.
 *  - El sábado no descuenta hora de comida, salvo que el colaborador tenga
 *    un receso configurado (minutosComidaSabado).
 *  - La comida solo se descuenta si la jornada bruta es >= 300 min.
 *  - Las horas extra del sábado se trasladan a la semana siguiente.
 *  - El domingo es solo una incidencia: no suma horas ni extras.
 *  - Nunca se cierra automáticamente una entrada de otro día.
 *  - Cada colaborador puede tener su propia jornada, que pisa a la del área.
 */
import {
  hhmmAMinutos,
  minutosAHHMM,
  fechaLocal,
  esDomingoMx,
  esSabadoMx,
  esDiaLaboralMx,
  formatoHM,
  diaSemanaNumericoMx,
  NOMBRES_DIA,
} from "./tz";

type Minutos = number;

/* ===================================================================== */
/* Tipos                                                               */
/* ===================================================================== */

export interface MarcaCruda {
  ts: Date;
  origen?: string;
}

export interface AjusteManual {
  entrada?: string | null; // HH:mm
  salida?: string | null; // HH:mm
  observaciones?: string | null;
}

export interface HorarioReferencia {
  inicio: Minutos;
  fin: Minutos;
  /** Texto listo para mostrar: "09:00 - 19:00". */
  etiqueta: string;
  /** Motivo por el que se aplicó este horario. */
  origen: "horario especial" | "sábado" | "área" | "colaborador";
  /** El día es de descanso: no se contabilizan horas aunque haya marcas. */
  descanso: boolean;
}

/**
 * Horario configurado para un área.
 * `sabado` es opcional:
 *   - `null`           -> el sábado es día de descanso para esa área.
 *   - `{inicio, fin}`  -> jornada propia del área los sábados.
 *   - ausente          -> se aplica el horario general de sábados.
 */
export interface HorarioArea {
  inicio: string;
  fin: string;
  sabado?: { inicio: string; fin: string } | null;
}

/**
 * Jornada propia de un colaborador.
 *
 * Los campos en `null` heredan del área (o de la config global del sábado),
 * así que un colaborador sin jornada propia se comporta exactamente igual
 * que antes de existir este concepto.
 */
export interface JornadaUsuario {
  /** Lunes a viernes. "09:00" o null = hereda del área. */
  jornadaInicio: string | null;
  jornadaFin: string | null;
  /** null = hereda del área; true = trabaja; false = descanso. */
  sabadoTrabaja: boolean | null;
  sabadoInicio: string | null;
  sabadoFin: string | null;
}

export interface ReglaHorarioEspecial {
  usuarioId: string;
  diaSemana: number; // 0 = domingo ... 6 = sábado
  entrada: string;
  salida: string;
  vigenteDesde: string; // YYYY-MM-DD
  vigenteHasta: string | null;
  activo: boolean;
}

export type EstadoDia =
  | "Completado"
  | "Completado con horas extra"
  | "Entrada registrada (salida pendiente)"
  | "Incidencia: domingo"
  | "Incidencia: descanso"
  | "Falta"
  | "Falta justificada"
  | "Sin registro";

export type OrigenDia = "Marcas" | "Manual" | "Marcas + Manual" | "Sin registro";

export interface ResultadoDia {
  fecha: string; // YYYY-MM-DD en zona oficina
  diaSemana: number; // 0 = domingo ... 6 = sábado
  nombreDia: string;
  esDomingo: boolean;
  esSabado: boolean;
  esDiaLaboral: boolean;

  entrada: string | null; // HH:mm
  salida: string | null; // HH:mm
  origen: OrigenDia;
  observaciones: string;
  marcasAdicionales: string[]; // HH:mm — marcas no usadas como salida

  brutas: Minutos;
  comida: Minutos;
  netas: Minutos;
  jornadaBruta: Minutos;
  jornadaNeta: Minutos;
  extra: Minutos;

  jornada: HorarioReferencia;
  estado: EstadoDia;
  faltaJustificada: boolean;
}

export interface ParametrosDia {
  fecha: Date; // instante UTC cuyo día local es zona oficina
  marcas: MarcaCruda[];
  ajusteManual: AjusteManual | null;
  minutosComida: number;
  /**
   * Minutos de receso el sábado. Por defecto 0: el sábado no descuenta
   * hora de comida (regla original del control de asistencia). Un
   * colaborador puede configurarlo desde el panel.
   */
  minutosComidaSabado?: number;
  horarioReferencia: HorarioReferencia;
  minEntreMarcas?: number; // default 5
  minutosMinimosComida?: number; // default 300
  faltaJustificada?: boolean; // default false
}

export interface ResultadoSemana {
  lunes: string; // YYYY-MM-DD del lunes de la semana
  dias: ResultadoDia[];
  extraPropia: Minutos; // lunes a viernes
  extraSabadoEstaSemana: Minutos;
  extraTraida: Minutos; // extra traída del sábado de la semana anterior
  extraTotal: Minutos; // extraPropia + extraTraida
  extraASiguienteSemana: Minutos; // extra del sábado de esta semana (si traslada)
  trabajadas: Minutos;
  brutas: Minutos;
  comida: Minutos;
  asistencias: number;
  faltas: number;
  incidencias: string[];
}

/* ===================================================================== */
/* Helpers internos                                                     */
/* ===================================================================== */

function resultadoSinRegistro(
  fechaStr: string,
  esDiaLaboral: boolean,
  faltaJustificada: boolean,
  jornada: HorarioReferencia,
  esDomingo: boolean
): ResultadoDia {
  const diaSemana = diaSemanaDeFechaStr(fechaStr);
  const esDescanso = jornada.descanso;

  return {
    fecha: fechaStr,
    diaSemana,
    nombreDia: NOMBRES_DIA[diaSemana] ?? "",
    esDomingo,
    esSabado: diaSemana === 6,
    esDiaLaboral,
    entrada: null,
    salida: null,
    origen: "Sin registro",
    observaciones: esDomingo
      ? "No se registró. El domingo es incidencia y no suma horas ni extras."
      : esDescanso
        ? "Día de descanso. No se esperan horas ni se cuenta como falta."
        : "Sin registro de entrada.",
    marcasAdicionales: [],
    brutas: 0,
    comida: 0,
    netas: 0,
    jornadaBruta: 0,
    jornadaNeta: 0,
    extra: 0,
    jornada,
    estado: esDomingo
      ? "Incidencia: domingo"
      : esDescanso
        ? "Incidencia: descanso"
        : faltaJustificada
          ? "Falta justificada"
          : "Sin registro",
    faltaJustificada,
  };
}

function diaSemanaDeFechaStr(fechaStr: string): number {
  const partes = fechaStr.split("-").map(Number);
  const d = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2], 12, 0, 0, 0));
  return d.getUTCDay();
}

/* ===================================================================== */
/* Cálculo del día                                                      */
/* ===================================================================== */

/**
 * Deriva el registro de un día a partir de marcas, ajuste manual y horario.
 *
 * Precedencia (idéntica al control de asistencia original):
 *  1. Ajuste manual con entrada y salida  -> se respeta tal cual.
 *  2. Ajuste manual solo con entrada      -> la salida es la última marca
 *     válida del día (>= entrada + minEntreMarcas).
 *  3. Ajuste manual solo con salida       -> la entrada es la primera marca
 *     del día que sea <= salida.
 *  4. Solo marcas                         -> primera = entrada, última = salida
 *     (si distan >= minEntreMarcas).
 */
export function calcularDia(p: ParametrosDia): ResultadoDia {
  const fecha = p.fecha;
  const fechaStr = fechaLocal(fecha);
  const esDomingo = esDomingoMx(fecha);
  const esSabado = esSabadoMx(fecha);
  const esDiaLaboral = esDiaLaboralMx(fecha);
  const minEntreMarcas = p.minEntreMarcas ?? 5;
  const minutosMinimosComida = p.minutosMinimosComida ?? 300;
  const faltaJustificada = p.faltaJustificada ?? false;
  const jornada = p.horarioReferencia;

  // ------------------------------------------------------------
  // Sin marcas y sin ajuste: no hay nada que derivar.
  // ------------------------------------------------------------
  const marcasOrdenadas = [...p.marcas].sort(
    (a, b) => a.ts.getTime() - b.ts.getTime()
  );
  const marcasMinutos: (Minutos | null)[] = marcasOrdenadas.map((m) =>
    hhmmAMinutos(formatoHM(m.ts))
  );

  const ajuste = p.ajusteManual;
  const tieneEntradaManual =
    ajuste?.entrada != null && String(ajuste.entrada).trim() !== "";
  const tieneSalidaManual =
    ajuste?.salida != null && String(ajuste.salida).trim() !== "";
  const entradaManualMin = tieneEntradaManual
    ? hhmmAMinutos(String(ajuste.entrada))
    : null;
  const salidaManualMin = tieneSalidaManual
    ? hhmmAMinutos(String(ajuste.salida))
    : null;

  let entrada: Minutos | null = null;
  let salida: Minutos | null = null;
  let origen: OrigenDia = "Sin registro";
  let observaciones = "";
  const marcasAdicionales: string[] = [];

  // ------------------------------------------------------------
  // 1. Ajuste manual completo: se respeta exactamente.
  // ------------------------------------------------------------
  if (tieneEntradaManual && tieneSalidaManual) {
    if (entradaManualMin === null || salidaManualMin === null) {
      return resultadoSinRegistro(
        fechaStr,
        esDiaLaboral,
        faltaJustificada,
        jornada,
        esDomingo
      );
    }
    entrada = entradaManualMin;
    salida = salidaManualMin;
    origen = "Manual";
    observaciones = ajuste?.observaciones ?? "";
  }
  // ------------------------------------------------------------
  // 2. Ajuste manual solo con entrada -> salida = última marca válida.
  // ------------------------------------------------------------
  else if (tieneEntradaManual && !tieneSalidaManual) {
    if (entradaManualMin === null) {
      return resultadoSinRegistro(
        fechaStr,
        esDiaLaboral,
        faltaJustificada,
        jornada,
        esDomingo
      );
    }
    entrada = entradaManualMin;
    origen = "Marcas + Manual";
    observaciones = ajuste?.observaciones ?? "";

    const umbral = entrada + minEntreMarcas;
    const marcasValidas = marcasMinutos.filter(
      (m) => m !== null && m >= umbral
    );
    if (marcasValidas.length > 0) {
      salida = marcasValidas[marcasValidas.length - 1]!;
      observaciones +=
        (observaciones ? "\n" : "") +
        "La salida fue tomada de la última marca válida del día (" +
        minutosAHHMM(salida) +
        ").";
    }
  }
  // ------------------------------------------------------------
  // 3. Ajuste manual solo con salida -> entrada = primera marca <= salida.
  // ------------------------------------------------------------
  else if (!tieneEntradaManual && tieneSalidaManual) {
    if (salidaManualMin === null) {
      return resultadoSinRegistro(
        fechaStr,
        esDiaLaboral,
        faltaJustificada,
        jornada,
        esDomingo
      );
    }
    salida = salidaManualMin;
    const marcasAntes = marcasMinutos.filter(
      (m) => m !== null && m <= salida!
    );
    if (marcasAntes.length === 0) {
      return {
        ...resultadoSinRegistro(
          fechaStr,
          esDiaLaboral,
          faltaJustificada,
          jornada,
          esDomingo
        ),
        observaciones:
          "Se capturó una salida manual, pero no hay ninguna marca previa que sirva como entrada.",
        estado: "Sin registro",
      };
    }
    entrada = marcasAntes[0]!;
    origen = "Marcas + Manual";
    observaciones =
      ajuste?.observaciones ??
      "Salida manual aplicada sobre la entrada real registrada.";
  }
  // ------------------------------------------------------------
  // 4. Solo marcas.
  // ------------------------------------------------------------
  else if (marcasMinutos.length > 0) {
    const primera = marcasMinutos[0];
    const ultima = marcasMinutos[marcasMinutos.length - 1];
    if (primera === null) {
      return resultadoSinRegistro(
        fechaStr,
        esDiaLaboral,
        faltaJustificada,
        jornada,
        esDomingo
      );
    }
    entrada = primera;
    origen = "Marcas";

    const diferencia = (ultima ?? 0) - primera;
    if (diferencia >= minEntreMarcas && ultima !== null) {
      salida = ultima;
      for (let i = 1; i < marcasMinutos.length - 1; i++) {
        const m = marcasMinutos[i];
        if (m !== null) marcasAdicionales.push(minutosAHHMM(m));
      }
      if (marcasAdicionales.length > 0) {
        observaciones =
          "Se detectaron " +
          marcasAdicionales.length +
          " marca(s) adicional(es) el mismo día; no se usaron para calcular la salida.";
      }
    } else {
      salida = null;
      for (let i = 1; i < marcasMinutos.length; i++) {
        const m = marcasMinutos[i];
        if (m !== null) marcasAdicionales.push(minutosAHHMM(m));
      }
      if (marcasMinutos.length === 1) {
        observaciones = "Entrada registrada. Salida pendiente de registrar.";
      }
    }
  }

  // ------------------------------------------------------------
  // Sin entrada ni salida: sin registro (o falta justificada).
  // ------------------------------------------------------------
  if (entrada === null && salida === null) {
    const base = resultadoSinRegistro(
      fechaStr,
      esDiaLaboral,
      faltaJustificada,
      jornada,
      esDomingo
    );
    if (!esDomingo && faltaJustificada) {
      base.estado = "Falta justificada";
      base.observaciones =
        ajuste?.observaciones ?? "Falta justificada por administración.";
    }
    return base;
  }

  const e = entrada!;
  const s = salida;

  // ------------------------------------------------------------
  // Cálculo de horas
  // ------------------------------------------------------------
  const brutas = s !== null ? Math.max(0, s - e) : 0;

  // El receso del sábado es 0 por defecto (regla original). Si el
  // colaborador tiene receso configurado, se descuenta igual que de
  // lunes a viernes.
  const minutosComidaDia = esSabado
    ? (p.minutosComidaSabado ?? 0)
    : p.minutosComida;

  const aplicaComida =
    minutosComidaDia > 0 && brutas >= minutosMinimosComida;
  const comida = aplicaComida ? Math.min(minutosComidaDia, brutas) : 0;
  const netas = Math.max(0, brutas - comida);

  const jornadaBruta = Math.max(0, jornada.fin - jornada.inicio);
  const comidaJornada = aplicaComida
    ? Math.min(minutosComidaDia, jornadaBruta)
    : 0;
  const jornadaNeta = Math.max(0, jornadaBruta - comidaJornada);
  const extra = Math.max(0, netas - jornadaNeta);

  // ------------------------------------------------------------
  // Domingo: se conserva la marca como incidencia, pero no suma horas.
  // ------------------------------------------------------------
  if (esDomingo) {    return {
      fecha: fechaStr,
      diaSemana: 0,
      nombreDia: "Domingo",
      esDomingo: true,
      esSabado: false,
      esDiaLaboral: false,
      entrada: minutosAHHMM(e),
      salida: s !== null ? minutosAHHMM(s) : null,
      origen,
      observaciones:
        (observaciones ? observaciones + "\n" : "") +
        "Registro realizado en domingo; no se contabiliza en horas ni horas extra.",
      marcasAdicionales,
      brutas: 0,
      comida: 0,
      netas: 0,
      jornadaBruta: 0,
      jornadaNeta: 0,
      extra: 0,
      jornada,
      estado: "Incidencia: domingo",
      faltaJustificada: false,
    };
  }

  // ------------------------------------------------------------
  // Sábado de descanso: la marca se conserva como incidencia.
  // ------------------------------------------------------------
  if (esSabado && jornada.descanso) {
    return {
      fecha: fechaStr,
      diaSemana: 6,
      nombreDia: "Sábado",
      esDomingo: false,
      esSabado: true,
      esDiaLaboral: true,
      entrada: minutosAHHMM(e),
      salida: s !== null ? minutosAHHMM(s) : null,
      origen,
      observaciones:
        (observaciones ? observaciones + "\n" : "") +
        "El sábado es día de descanso para esta persona; el registro se conserva como incidencia y no suma horas.",
      marcasAdicionales,
      brutas: 0,
      comida: 0,
      netas: 0,
      jornadaBruta: 0,
      jornadaNeta: 0,
      extra: 0,
      jornada,
      estado: "Incidencia: descanso",
      faltaJustificada: false,
    };
  }

  // ------------------------------------------------------------
  // Estado del día
  // ------------------------------------------------------------
  let estado: EstadoDia;
  if (s !== null) {
    estado = extra > 0 ? "Completado con horas extra" : "Completado";
  } else {
    estado = "Entrada registrada (salida pendiente)";
  }

  if (observaciones === "" && esSabado) {
    observaciones =
      "Sábado: jornada de " +
      jornada.etiqueta +
      (aplicaComida
        ? `. Se descuenta ${comida} min de receso.`
        : ". No se descuenta hora de comida.");
  }

  const diaSemana = diaSemanaNumericoMx(fecha);

  return {
    fecha: fechaStr,
    diaSemana,
    nombreDia: NOMBRES_DIA[diaSemana] ?? "",
    esDomingo: false,
    esSabado,
    esDiaLaboral,
    entrada: minutosAHHMM(e),
    salida: s !== null ? minutosAHHMM(s) : null,
    origen,
    observaciones,
    marcasAdicionales,
    brutas,
    comida,
    netas,
    jornadaBruta,
    jornadaNeta,
    extra,
    jornada,
    estado,
    faltaJustificada,
  };
}

/* ===================================================================== */
/* Horario de referencia (puro)                                         */
/* ===================================================================== */

/**
 * Resuelve el horario de referencia para una fecha.
 * Prioridad: 1) horario especial vigente, 2) sábado (descanso o jornada),
 * 3) jornada propia del colaborador, 4) horario del área.
 *
 * El sábado puede configurarse por área con la clave `sabado`:
 *   - `null`      -> descanso (no se contabilizan horas).
 *   - `{inicio,fin}` -> jornada propia del área para el sábado.
 *   - ausente     -> se usa el horario general de sábados.
 *
 * La jornada propia del colaborador (`jornadaUsuario`) tiene prioridad
 * sobre el área: un null en un campo significa "hereda", no "vacío".
 */
export function resolverHorarioReferencia(params: {
  area: "Oficina" | "Técnico" | "Sin asignar";
  fecha: Date;
  horarioEspecial: HorarioReferencia | null;
  horariosPorArea: Record<string, HorarioArea>;
  horarioSabado: { inicio: string; fin: string };
  jornadaUsuario?: JornadaUsuario | null;
}): HorarioReferencia {
  if (params.horarioEspecial) {
    return params.horarioEspecial;
  }

  const j = params.jornadaUsuario ?? null;

  if (esSabadoMx(params.fecha)) {
    // 1) El propio colaborador decide si trabaja los sábados.
    if (j?.sabadoTrabaja === false) {
      return {
        inicio: 0,
        fin: 0,
        etiqueta: "Descanso",
        origen: "sábado",
        descanso: true,
      };
    }
    if (j?.sabadoTrabaja === true && j.sabadoInicio && j.sabadoFin) {
      return {
        inicio: hhmmAMinutos(j.sabadoInicio) ?? 0,
        fin: hhmmAMinutos(j.sabadoFin) ?? 0,
        etiqueta: `${j.sabadoInicio} - ${j.sabadoFin}`,
        origen: "colaborador",
        descanso: false,
      };
    }

    // 2) El área.
    const area = params.horariosPorArea[params.area];
    const propio = area ? area.sabado : undefined;

    if (propio === null) {
      return {
        inicio: 0,
        fin: 0,
        etiqueta: "Descanso",
        origen: "sábado",
        descanso: true,
      };
    }

    if (propio && typeof propio === "object") {
      return {
        inicio: hhmmAMinutos(propio.inicio) ?? 0,
        fin: hhmmAMinutos(propio.fin) ?? 0,
        etiqueta: `${propio.inicio} - ${propio.fin}`,
        origen: "sábado",
        descanso: false,
      };
    }

    // 3) El horario general de sábados.
    const inicio = hhmmAMinutos(params.horarioSabado.inicio) ?? 0;
    const fin = hhmmAMinutos(params.horarioSabado.fin) ?? 0;
    return {
      inicio,
      fin,
      etiqueta: `${params.horarioSabado.inicio} - ${params.horarioSabado.fin}`,
      origen: "sábado",
      descanso: false,
    };
  }

  const h =
    params.horariosPorArea[params.area] ??
    params.horariosPorArea["Sin asignar"] ?? {
      inicio: "09:00",
      fin: "19:00",
    };

  // La jornada propia del colaborador pisa al horario del área.
  const inicioTexto = j?.jornadaInicio ?? h.inicio;
  const finTexto = j?.jornadaFin ?? h.fin;

  return {
    inicio: hhmmAMinutos(inicioTexto) ?? 0,
    fin: hhmmAMinutos(finTexto) ?? 0,
    etiqueta: `${inicioTexto} - ${finTexto}`,
    origen: j?.jornadaInicio || j?.jornadaFin ? "colaborador" : "área",
    descanso: false,
  };
}

/**
 * Selecciona el horario especial vigente para un usuario en una fecha.
 * Prioridad: activo, mismo usuario, mismo día de semana, vigente desde/hasta.
 * Si hay varias válidas, gana la de "vigente desde" más reciente.
 */
export function seleccionarHorarioEspecial(
  reglas: ReglaHorarioEspecial[],
  usuarioId: string,
  fecha: Date
): HorarioReferencia | null {
  const fechaStr = fechaLocal(fecha);
  const dia = diaSemanaNumericoMx(fecha);
  let mejor: ReglaHorarioEspecial | null = null;

  for (const r of reglas) {
    if (r.usuarioId !== usuarioId) continue;
    if (r.diaSemana !== dia) continue;
    if (!r.activo) continue;
    if (fechaStr < r.vigenteDesde) continue;
    if (r.vigenteHasta && fechaStr > r.vigenteHasta) continue;
    if (!mejor || r.vigenteDesde > mejor.vigenteDesde) {
      mejor = r;
    }
  }

  if (!mejor) return null;
  return {
    inicio: hhmmAMinutos(mejor.entrada) ?? 0,
    fin: hhmmAMinutos(mejor.salida) ?? 0,
    etiqueta: `${mejor.entrada} - ${mejor.salida}`,
    origen: "horario especial",
    descanso: false,
  };
}

/* ===================================================================== */
/* Semana                                                               */
/* ===================================================================== */

/**
 * Calcula los totales de una semana laboral (lunes a sábado).
 * Las horas extra del sábado se contabilizan en la semana siguiente si
 * `trasladaExtraSabado` es true.
 *
 * `fechaHoy` (YYYY-MM-DD) delimita hasta dónde se cuentan faltas: los días
 * que todavía no ocurren no son faltas, simplemente aún no llegan.
 */
export function calcularSemana(
  dias: ResultadoDia[],
  fechaLunes: Date,
  trasladaExtraSabado: boolean,
  extraTraidaAnterior: Minutos = 0,
  fechaHoy?: string
): ResultadoSemana {
  const lunesStr = fechaLocal(fechaLunes);
  const diasOrdenados = [...dias].sort((a, b) => a.fecha.localeCompare(b.fecha));

  let extraPropia = 0; // lunes a viernes
  let extraSabadoEstaSemana = 0;
  let trabajadas = 0;
  let brutas = 0;
  let comida = 0;
  let asistencias = 0;
  let faltas = 0;
  const incidencias: string[] = [];

  for (const d of diasOrdenados) {
    const esSabado = d.diaSemana === 6;

    // Los días que todavía no ocurren no cuentan (ni como falta).
    if (fechaHoy && d.fecha > fechaHoy) {
      continue;
    }

    if (d.estado === "Incidencia: domingo") {
      incidencias.push(`${d.nombreDia}: domingo (incidencia, no suma horas)`);
      continue;
    }

    if (d.estado === "Incidencia: descanso") {
      incidencias.push(`${d.nombreDia}: día de descanso (no suma horas)`);
      continue;
    }

    if (d.estado === "Sin registro") {
      if (!d.faltaJustificada) {
        faltas++;
        incidencias.push(`${d.nombreDia}: sin registro (falta)`);
      }
      continue;
    }

    if (d.estado === "Falta justificada") {
      incidencias.push(`${d.nombreDia}: falta justificada`);
      continue;
    }

    asistencias++;
    trabajadas += d.netas;
    brutas += d.brutas;
    comida += d.comida;

    if (esSabado && trasladaExtraSabado) {
      extraSabadoEstaSemana += d.extra;
    } else {
      extraPropia += d.extra;
    }
  }

  const extraASiguienteSemana = trasladaExtraSabado ? extraSabadoEstaSemana : 0;
  const extraTotal = extraPropia + extraTraidaAnterior;

  return {
    lunes: lunesStr,
    dias: diasOrdenados,
    extraPropia,
    extraSabadoEstaSemana,
    extraTraida: extraTraidaAnterior,
    extraTotal,
    extraASiguienteSemana,
    trabajadas,
    brutas,
    comida,
    asistencias,
    faltas,
    incidencias,
  };
}

/* ===================================================================== */
/* Exportes de conveniencia                                              */
/* ===================================================================== */

export { hhmmAMinutos, minutosAHHMM };
