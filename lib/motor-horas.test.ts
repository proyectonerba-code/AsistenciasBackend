import { describe, it, expect } from "vitest";
import {
  calcularDia,
  calcularSemana,
  resolverHorarioReferencia,
  seleccionarHorarioEspecial,
  type ResultadoDia,
  type ResultadoSemana,
  type MarcaCruda,
  type HorarioReferencia,
  type ReglaHorarioEspecial,
} from "./motor-horas";
import { esDiaLaboralMx } from "./tz";

/* ===================================================================== */
/* Helpers de prueba                                                     */
/* ===================================================================== */

/**
 * Crea una Date cuya hora LOCAL de México sea la indicada.
 * Como México es UTC-6, sumamos 6 horas al instante UTC.
 */
function mx(ano: number, mes: number, dia: number, h: number, min: number): Date {
  return new Date(Date.UTC(ano, mes - 1, dia, h + 6, min, 0, 0));
}

function marca(h: number, min: number, ano = 2026, mes = 6, dia = 8): MarcaCruda {
  return { ts: mx(ano, mes, dia, h, min) };
}

const HORARIO_OFICINA: HorarioReferencia = {
  inicio: 540,
  fin: 1140,
  etiqueta: "09:00 - 19:00",
  origen: "área",
  descanso: false,
}; // 09:00-19:00
const HORARIO_SABADO: HorarioReferencia = {
  inicio: 540,
  fin: 900,
  etiqueta: "09:00 - 15:00",
  origen: "sábado",
  descanso: false,
}; // 09:00-15:00

const HORARIOS_AREA = {
  Oficina: { inicio: "09:00", fin: "19:00" },
  Técnico: { inicio: "09:00", fin: "20:00" },
  "Sin asignar": { inicio: "09:00", fin: "19:00" },
};

const HORARIO_SABADO_CFG = { inicio: "09:00", fin: "15:00" };

function diaBase(): ParametrosDiaBase {
  return {
    fecha: mx(2026, 6, 8, 12, 0), // lunes 2026-06-08
    marcas: [],
    ajusteManual: null,
    minutosComida: 60,
    horarioReferencia: HORARIO_OFICINA,
  };
}

interface ParametrosDiaBase {
  fecha: Date;
  marcas: MarcaCruda[];
  ajusteManual: { entrada?: string | null; salida?: string | null; observaciones?: string } | null;
  minutosComida: number;
  horarioReferencia: HorarioReferencia;
  minEntreMarcas?: number;
  minutosMinimosComida?: number;
  faltaJustificada?: boolean;
}

/* ===================================================================== */
/* Pruebas de cálculo de día                                             */
/* ===================================================================== */

describe("motor — cálculo de día", () => {
  it("día normal sin extra (09:00-18:00 oficina)", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      marcas: [marca(9, 0), marca(18, 0)],
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.fecha).toBe("2026-06-08");
    expect(r.entrada).toBe("09:00");
    expect(r.salida).toBe("18:00");
    expect(r.brutas).toBe(540);
    expect(r.comida).toBe(60); // 540 >= 300, descuenta 60
    expect(r.netas).toBe(480);
    expect(r.jornadaBruta).toBe(600); // 09:00-19:00
    expect(r.jornadaNeta).toBe(540); // 600 - 60
    expect(r.extra).toBe(0);
    expect(r.estado).toBe("Completado");
    expect(r.origen).toBe("Marcas");
  });

  it("día con extra (09:00-20:00 oficina)", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      marcas: [marca(9, 0), marca(20, 0)],
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.brutas).toBe(660);
    expect(r.comida).toBe(60);
    expect(r.netas).toBe(600);
    expect(r.jornadaNeta).toBe(540);
    expect(r.extra).toBe(60);
    expect(r.estado).toBe("Completado con horas extra");
  });

  it("entrada de 4 h no descuenta comida (brutas < 300)", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      marcas: [marca(9, 0), marca(13, 0)],
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.brutas).toBe(240);
    expect(r.comida).toBe(0);
    expect(r.netas).toBe(240);
    expect(r.estado).toBe("Completado");
  });

  it("jornada de exactamente 5 h sí descuenta comida (brutas = 300)", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      marcas: [marca(9, 0), marca(14, 0)],
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.brutas).toBe(300);
    expect(r.comida).toBe(60); // >= 300, descuenta
    expect(r.netas).toBe(240);
  });

  it("minutos de comida personalizados (30 min)", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      marcas: [marca(9, 0), marca(18, 0)],
      minutosComida: 30,
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.brutas).toBe(540);
    expect(r.comida).toBe(30);
    expect(r.netas).toBe(510);
  });

  it("sábado sin descuento de comida", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      fecha: mx(2026, 6, 13, 12, 0), // sábado
      marcas: [marca(9, 0, 2026, 6, 13), marca(15, 0, 2026, 6, 13)],
      horarioReferencia: HORARIO_SABADO,
    };
    const r = calcularDia(p);

    expect(r.esDiaLaboral).toBe(true);
    expect(r.brutas).toBe(360);
    expect(r.comida).toBe(0); // sábado no descuenta
    expect(r.netas).toBe(360);
    expect(r.jornadaNeta).toBe(360);
    expect(r.extra).toBe(0);
    expect(r.estado).toBe("Completado");
  });

  it("sábado con horario especial gana al sábado general", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      fecha: mx(2026, 6, 13, 12, 0), // sábado
      marcas: [marca(9, 0, 2026, 6, 13), marca(14, 0, 2026, 6, 13)],
      horarioReferencia: {
        inicio: 480,
        fin: 840,
        etiqueta: "08:00 - 14:00",
        origen: "horario especial",
        descanso: false,
      }, // 08:00-14:00 especial
    };
    const r = calcularDia(p);

    expect(r.jornadaBruta).toBe(360); // 08:00-14:00
    expect(r.brutas).toBe(300);
    expect(r.comida).toBe(0); // sábado
    expect(r.estado).toBe("Completado");
  });

  it("domingo es incidencia: 0 horas, 0 extra, no afecta totales", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      fecha: mx(2026, 6, 14, 12, 0), // domingo
      marcas: [marca(9, 0, 2026, 6, 14), marca(18, 0, 2026, 6, 14)],
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.esDomingo).toBe(true);
    expect(r.esDiaLaboral).toBe(false);
    expect(r.brutas).toBe(0);
    expect(r.comida).toBe(0);
    expect(r.netas).toBe(0);
    expect(r.extra).toBe(0);
    expect(r.estado).toBe("Incidencia: domingo");
  });

  it("doble marca a < 5 min: salida pendiente", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      marcas: [marca(9, 0), marca(9, 3)],
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.entrada).toBe("09:00");
    expect(r.salida).toBeNull();
    expect(r.estado).toBe("Entrada registrada (salida pendiente)");
    expect(r.marcasAdicionales).toEqual(["09:03"]);
  });

  it("3 marcas en un día: la intermedia va a rechazados una sola vez", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      marcas: [marca(9, 0), marca(9, 3), marca(18, 0)],
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.entrada).toBe("09:00");
    expect(r.salida).toBe("18:00");
    expect(r.marcasAdicionales).toEqual(["09:03"]);
  });

  it("una sola marca = pendiente (entrada sin salida)", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      marcas: [marca(9, 0)],
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.entrada).toBe("09:00");
    expect(r.salida).toBeNull();
    expect(r.estado).toBe("Entrada registrada (salida pendiente)");
    expect(r.observaciones).toContain("pendiente");
  });

  it("manual completo se respeta tal cual", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      marcas: [marca(8, 0), marca(17, 0)], // ignoradas, el manual manda
      ajusteManual: { entrada: "09:00", salida: "18:00" },
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.entrada).toBe("09:00");
    expect(r.salida).toBe("18:00");
    expect(r.origen).toBe("Manual");
    expect(r.brutas).toBe(540);
  });

  it("manual solo entrada + marca de salida", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      marcas: [marca(9, 0), marca(18, 0)],
      ajusteManual: { entrada: "09:00" },
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.entrada).toBe("09:00");
    expect(r.salida).toBe("18:00");
    expect(r.origen).toBe("Marcas + Manual");
  });

  it("manual solo salida con marcas previas", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      marcas: [marca(9, 0), marca(12, 0)],
      ajusteManual: { salida: "18:00" },
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.entrada).toBe("09:00"); // primera <= salida
    expect(r.salida).toBe("18:00");
    expect(r.origen).toBe("Marcas + Manual");
  });

  it("manual solo salida sin marcas previas: no hay registro", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      marcas: [],
      ajusteManual: { salida: "18:00" },
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.entrada).toBeNull();
    expect(r.salida).toBeNull();
    expect(r.origen).toBe("Sin registro");
    expect(r.estado).toBe("Sin registro");
  });

  it("falta en día laboral (lunes sin marcas)", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      marcas: [],
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.esDiaLaboral).toBe(true);
    expect(r.estado).toBe("Sin registro");
    expect(r.faltaJustificada).toBe(false);
  });

  it("no hay falta en domingo", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      fecha: mx(2026, 6, 14, 12, 0), // domingo
      marcas: [],
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.esDomingo).toBe(true);
    expect(r.esDiaLaboral).toBe(false);
    expect(r.estado).toBe("Incidencia: domingo");
  });

  it("falta justificada no cuenta como falta", () => {
    const p: ParametrosDiaBase = {
      ...diaBase(),
      marcas: [],
      faltaJustificada: true,
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.estado).toBe("Falta justificada");
    expect(r.faltaJustificada).toBe(true);
  });

  it("zona horaria: marca 23:50 hora México cae en ese día aunque en UTC sea otro día", () => {
    // 2026-06-10 23:50 México = 2026-06-11 05:50 UTC
    const p: ParametrosDiaBase = {
      ...diaBase(),
      fecha: mx(2026, 6, 10, 23, 50), // 2026-06-10 23:50 MX
      marcas: [marca(23, 50, 2026, 6, 10)],
      horarioReferencia: HORARIO_OFICINA,
    };
    const r = calcularDia(p);

    expect(r.fecha).toBe("2026-06-10");
    expect(esDiaLaboralMx(r.fecha)).toBe(true); // miércoles
    expect(r.entrada).toBe("23:50");
  });
});

/* ===================================================================== */
/* Pruebas de horario de referencia                                      */
/* ===================================================================== */

describe("motor — horario de referencia", () => {
  it("horario especial gana al del área", () => {
    const h = resolverHorarioReferencia({
      area: "Oficina",
      fecha: mx(2026, 6, 8, 12, 0),
      horarioEspecial: {
        inicio: 480,
        fin: 840,
        etiqueta: "08:00 - 14:00",
        origen: "horario especial",
        descanso: false,
      }, // 08:00-14:00
      horariosPorArea: HORARIOS_AREA,
      horarioSabado: HORARIO_SABADO_CFG,
    });
    expect(h.inicio).toBe(480);
    expect(h.fin).toBe(840);
  });

  it("sábado general aplica si no hay horario especial", () => {
    const h = resolverHorarioReferencia({
      area: "Oficina",
      fecha: mx(2026, 6, 13, 12, 0), // sábado
      horarioEspecial: null,
      horariosPorArea: HORARIOS_AREA,
      horarioSabado: HORARIO_SABADO_CFG,
    });
    expect(h.inicio).toBe(540); // 09:00
    expect(h.fin).toBe(900); // 15:00
  });

  it("horario del área aplica si no hay especial ni sábado", () => {
    const h = resolverHorarioReferencia({
      area: "Técnico",
      fecha: mx(2026, 6, 8, 12, 0),
      horarioEspecial: null,
      horariosPorArea: HORARIOS_AREA,
      horarioSabado: HORARIO_SABADO_CFG,
    });
    expect(h.inicio).toBe(540); // 09:00
    expect(h.fin).toBe(1200); // 20:00
  });
});

/* ===================================================================== */
/* Pruebas de selección de horario especial (vigencias y múltiples)     */
/* ===================================================================== */

describe("motor — selección de horario especial", () => {
  const reglas: ReglaHorarioEspecial[] = [
    {
      usuarioId: "u1",
      diaSemana: 1, // lunes
      entrada: "09:00",
      salida: "18:00",
      vigenteDesde: "2026-06-01",
      vigenteHasta: null,
      activo: true,
    },
    {
      usuarioId: "u1",
      diaSemana: 1,
      entrada: "08:00",
      salida: "14:00",
      vigenteDesde: "2026-06-10",
      vigenteHasta: null,
      activo: true,
    },
    {
      usuarioId: "u1",
      diaSemana: 6, // sábado
      entrada: "10:00",
      salida: "14:00",
      vigenteDesde: "2026-06-01",
      vigenteHasta: null,
      activo: true,
    },
    {
      usuarioId: "u2",
      diaSemana: 1,
      entrada: "09:00",
      salida: "18:00",
      vigenteDesde: "2026-06-01",
      vigenteHasta: null,
      activo: false, // inactivo
    },
  ];

  it("varias reglas para lunes: gana la de vigente desde más reciente", () => {
    const h = seleccionarHorarioEspecial(reglas, "u1", mx(2026, 6, 15, 12, 0)); // lunes
    expect(h).not.toBeNull();
    if (h) {
      expect(h.inicio).toBe(480); // 08:00 (regla desde 2026-06-10)
      expect(h.fin).toBe(840); // 14:00
    }
  });

  it("vigencia hasta: fuera de rango devuelve null", () => {
    const reglasConHasta: ReglaHorarioEspecial[] = [
      {
        usuarioId: "u1",
        diaSemana: 1, // lunes
        entrada: "09:00",
        salida: "18:00",
        vigenteDesde: "2026-06-01",
        vigenteHasta: "2026-06-10",
        activo: true,
      },
    ];
    // 2026-06-15 es después del hasta (y es lunes)
    const h = seleccionarHorarioEspecial(reglasConHasta, "u1", mx(2026, 6, 15, 12, 0));
    expect(h).toBeNull();

    // 2026-06-08 está dentro (lunes)
    const h2 = seleccionarHorarioEspecial(reglasConHasta, "u1", mx(2026, 6, 8, 12, 0));
    expect(h2).not.toBeNull();
  });

  it("usuario sin reglas devuelve null", () => {
    const h = seleccionarHorarioEspecial(reglas, "u999", mx(2026, 6, 8, 12, 0));
    expect(h).toBeNull();
  });

  it("regla inactiva no se considera", () => {
    const h = seleccionarHorarioEspecial(reglas, "u2", mx(2026, 6, 8, 12, 0));
    expect(h).toBeNull();
  });

  it("regla de sábado aplica en sábado", () => {
    const h = seleccionarHorarioEspecial(reglas, "u1", mx(2026, 6, 13, 12, 0)); // sábado
    expect(h).not.toBeNull();
    if (h) {
      expect(h.inicio).toBe(600); // 10:00
      expect(h.fin).toBe(840); // 14:00
    }
  });
});

/* ===================================================================== */
/* Pruebas de semana                                                     */
/* ===================================================================== */

describe("motor — semana", () => {
  const lunes = mx(2026, 6, 8, 12, 0); // 2026-06-08 lunes

  it("totales de semana: lunes a viernes + sábado extra a la siguiente", () => {
    // Lunes a viernes: 09:00-18:00 (extra 60 cada día) -> extraPropia = 300
    // Sábado: 09:00-17:00 (extra 120) -> extraSabadoEstaSemana = 120, va a siguiente
    const dias: ResultadoDia[] = [];
    for (let i = 0; i < 5; i++) {
      const f = mx(2026, 6, 8 + i, 12, 0);
      const r = calcularDia({
        fecha: f,
        marcas: [marca(9, 0, 2026, 6, 8 + i), marca(20, 0, 2026, 6, 8 + i)],
        ajusteManual: null,
        minutosComida: 60,
        horarioReferencia: HORARIO_OFICINA,
      });
      dias.push(r);
    }
    // Sábado
    const sabado = calcularDia({
      fecha: mx(2026, 6, 13, 12, 0),
      marcas: [marca(9, 0, 2026, 6, 13), marca(17, 0, 2026, 6, 13)],
      ajusteManual: null,
      minutosComida: 60,
      horarioReferencia: HORARIO_SABADO,
    });
    dias.push(sabado);

    const s: ResultadoSemana = calcularSemana(dias, lunes, true, 0);

    expect(s.extraPropia).toBe(300); // 5 dias * 60
    expect(s.extraSabadoEstaSemana).toBe(120);
    expect(s.extraTraida).toBe(0);
    expect(s.extraTotal).toBe(300); // 300 + 0
    expect(s.extraASiguienteSemana).toBe(120); // el sábado va a la siguiente
    expect(s.asistencias).toBe(6);
    expect(s.faltas).toBe(0);
  });

  it("semana con extra traída del sábado anterior", () => {
    const dias: ResultadoDia[] = [];
    for (let i = 0; i < 5; i++) {
      const f = mx(2026, 6, 8 + i, 12, 0);
      const r = calcularDia({
        fecha: f,
        marcas: [marca(9, 0, 2026, 6, 8 + i), marca(18, 0, 2026, 6, 8 + i)],
        ajusteManual: null,
        minutosComida: 60,
        horarioReferencia: HORARIO_OFICINA,
      });
      dias.push(r);
    }

    const s: ResultadoSemana = calcularSemana(dias, lunes, true, 120); // trae 120 del sábado anterior

    expect(s.extraPropia).toBe(0);
    expect(s.extraTraida).toBe(120);
    expect(s.extraTotal).toBe(120); // 0 + 120
    expect(s.extraASiguienteSemana).toBe(0);
  });

  it("domingo no afecta totales de semana", () => {
    const domingo: ResultadoDia = {
      fecha: "2026-06-14",
      diaSemana: 0,
      nombreDia: "Domingo",
      esDomingo: true,
      esSabado: false,
      esDiaLaboral: false,
      entrada: null,
      salida: null,
      origen: "Sin registro",
      observaciones: "",
      marcasAdicionales: [],
      brutas: 0,
      comida: 0,
      netas: 0,
      jornadaBruta: 0,
      jornadaNeta: 0,
      extra: 0,
      jornada: HORARIO_OFICINA,
      estado: "Incidencia: domingo",
      faltaJustificada: false,
    };
    const lunesDia = calcularDia({
      fecha: mx(2026, 6, 8, 12, 0),
      marcas: [marca(9, 0), marca(18, 0)],
      ajusteManual: null,
      minutosComida: 60,
      horarioReferencia: HORARIO_OFICINA,
    });

    const s: ResultadoSemana = calcularSemana([domingo, lunesDia], lunes, true, 0);

    expect(s.extraPropia).toBe(0); // lunes 09:00-18:00 oficina = extra 0 (jornada 600, netas 480, jornadaNeta 540)
    expect(s.asistencias).toBe(1);
    expect(s.faltas).toBe(0);
    expect(s.incidencias.length).toBeGreaterThan(0);
  });

  it("falta no justificada cuenta en semana; justificada no", () => {
    const falta: ResultadoDia = {
      fecha: "2026-06-09",
      diaSemana: 2,
      nombreDia: "Martes",
      esDomingo: false,
      esSabado: false,
      esDiaLaboral: true,
      entrada: null,
      salida: null,
      origen: "Sin registro",
      observaciones: "",
      marcasAdicionales: [],
      brutas: 0,
      comida: 0,
      netas: 0,
      jornadaBruta: 0,
      jornadaNeta: 0,
      extra: 0,
      jornada: HORARIO_OFICINA,
      estado: "Sin registro",
      faltaJustificada: false,
    };
    const faltaJust: ResultadoDia = {
      ...falta,
      fecha: "2026-06-10",
      faltaJustificada: true,
    };
    const lunesDia = calcularDia({
      fecha: mx(2026, 6, 8, 12, 0),
      marcas: [marca(9, 0), marca(18, 0)],
      ajusteManual: null,
      minutosComida: 60,
      horarioReferencia: HORARIO_OFICINA,
    });

    const s: ResultadoSemana = calcularSemana([falta, faltaJust, lunesDia], lunes, true, 0);

    expect(s.faltas).toBe(1); // solo la no justificada
    expect(s.asistencias).toBe(1);
  });
});
