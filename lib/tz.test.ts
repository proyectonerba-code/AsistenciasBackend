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
});
