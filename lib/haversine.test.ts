import { describe, it, expect } from "vitest";
import { haversineMetros } from "./haversine";

describe("haversine — distancia entre coordenadas", () => {
  it("misma punto devuelve 0", () => {
    expect(haversineMetros(19.4326, -99.1332, 19.4326, -99.1332)).toBeCloseTo(
      0,
      0
    );
  });

  it("distancia conocida: CDMX a sede cercana ~50 m", () => {
    const d = haversineMetros(19.4326, -99.1332, 19.43305, -99.1332);
    expect(d).toBeGreaterThan(40);
    expect(d).toBeLessThan(60);
  });

  it("distancia larga: CDMX a Guadalajara ~460 km", () => {
    const d = haversineMetros(19.4326, -99.1332, 20.6597, -103.3496);
    const km = d / 1000;
    expect(km).toBeGreaterThan(450);
    expect(km).toBeLessThan(480);
  });

  it("es simétrica", () => {
    const a = haversineMetros(19.4326, -99.1332, 20.6597, -103.3496);
    const b = haversineMetros(20.6597, -103.3496, 19.4326, -99.1332);
    expect(a).toBeCloseTo(b, 0);
  });
});
