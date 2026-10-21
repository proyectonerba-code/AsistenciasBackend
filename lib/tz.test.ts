import { describe, it, expect } from "vitest";
import {
  ahoraMx,
  formatoHM,
  fechaLocal,
  esDomingoMx,
  esSabadoMx,
  esDiaLaboralMx,
  minutosAHHMM,
  hhmmAMinutos,
  inicioDiaMx,
  finDiaMx,
} from "./tz";

describe("tz — zona horaria fija America/Mexico_City", () => {
  it("formatoHM devuelve HH:mm en zona México", () => {
    const d = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    expect(formatoHM(d)).toBe("06:00");
  });

  it("fechaLocal devuelve YYYY-MM-DD en zona México", () => {
    const d = new Date(Date.UTC(2026, 0, 15, 5, 0, 0));
    expect(fechaLocal(d)).toBe("2026-01-14");
  });

  it("una marca a las 23:50 hora México cae en ese día aunque en UTC sea otro día", () => {
    const d = new Date(Date.UTC(2026, 5, 11, 5, 50, 0));
    expect(fechaLocal(d)).toBe("2026-06-10");
    expect(esDiaLaboralMx(d)).toBe(true);
  });

  it("domingo se detecta correctamente en zona México", () => {
    const d = new Date(Date.UTC(2026, 5, 14, 12, 0, 0));
    expect(esDomingoMx(d)).toBe(true);
    expect(esDiaLaboralMx(d)).toBe(false);
  });

  it("sábado se detecta correctamente en zona México", () => {
    const d = new Date(Date.UTC(2026, 5, 13, 12, 0, 0));
    expect(esSabadoMx(d)).toBe(true);
    expect(esDiaLaboralMx(d)).toBe(true);
  });

  it("minutosAHHMM y hhmmAMinutos son inversos", () => {
    expect(minutosAHHMM(540)).toBe("09:00");
    expect(hhmmAMinutos("09:00")).toBe(540);
    expect(hhmmAMinutos("23:30")).toBe(23 * 60 + 30);
    expect(hhmmAMinutos("")).toBeNull();
    expect(hhmmAMinutos(null)).toBeNull();
    expect(hhmmAMinutos("25:00")).toBeNull();
    expect(hhmmAMinutos("09:60")).toBeNull();
  });

  it("ahoraMx devuelve un Date válido", () => {
    const d = ahoraMx();
    expect(d instanceof Date).toBe(true);
    expect(!isNaN(d.getTime())).toBe(true);
  });

  it("el día en México empieza a las 06:00 UTC, no a las 00:00 UTC", () => {
    // 2026-06-15 00:00 en México = 2026-06-15 06:00 UTC.
    expect(inicioDiaMx("2026-06-15").toISOString()).toBe(
      "2026-06-15T06:00:00.000Z"
    );
  });

  it("el día en México termina a las 23:59:59 local del mismo día", () => {
    // 2026-06-16 05:59:59.999 UTC = 2026-06-15 23:59:59.999 en México.
    expect(finDiaMx("2026-06-15").toISOString()).toBe(
      "2026-06-16T05:59:59.999Z"
    );
  });

  it("una marca a las 22:00 local cae dentro de ese día", () => {
    // 2026-06-16 04:00 UTC = 2026-06-15 22:00 en México.
    const marca = new Date("2026-06-16T04:00:00.000Z");
    expect(marca.getTime()).toBeGreaterThanOrEqual(inicioDiaMx("2026-06-15").getTime());
    expect(marca.getTime()).toBeLessThanOrEqual(finDiaMx("2026-06-15").getTime());
  });

  it("una marca a las 02:00 local NO cae dentro de ese día", () => {
    // 2026-06-16 08:00 UTC = 2026-06-16 02:00 en México.
    const marca = new Date("2026-06-16T08:00:00.000Z");
    expect(marca.getTime()).toBeGreaterThan(finDiaMx("2026-06-15").getTime());
  });
});
