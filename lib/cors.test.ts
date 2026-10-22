import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolverCORS, cabecerasCors, origenesPermitidos } from "./cors";

const ORIGINAL = process.env.ALLOWED_ORIGIN;

beforeEach(() => {
  delete process.env.ALLOWED_ORIGIN;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ALLOWED_ORIGIN;
  else process.env.ALLOWED_ORIGIN = ORIGINAL;
});

describe("CORS — orígenes permitidos", () => {
  it("sin ALLOWED_ORIGIN permite todos", () => {
    expect(origenesPermitidos()).toEqual(["*"]);
    expect(resolverCORS("https://cualquiera.netlify.app")).toBe(
      "https://cualquiera.netlify.app"
    );
  });

  it("acepta una lista separada por comas", () => {
    process.env.ALLOWED_ORIGIN =
      "https://registro.nerwork.mx, https://admin.nerwork.mx";

    expect(resolverCORS("https://registro.nerwork.mx")).toBe(
      "https://registro.nerwork.mx"
    );
    expect(resolverCORS("https://admin.nerwork.mx")).toBe(
      "https://admin.nerwork.mx"
    );
  });

  it("un origen no permitido no se devuelve tal cual", () => {
    process.env.ALLOWED_ORIGIN = "https://registro.nerwork.mx";
    const r = resolverCORS("https://malicioso.example");
    expect(r).not.toBe("https://malicioso.example");
    expect(r).toBe("https://registro.nerwork.mx");
  });

  it("el comodín cubre las vistas previas de Netlify", () => {
    process.env.ALLOWED_ORIGIN =
      "https://registro.nerwork.mx,https://*.netlify.app";

    expect(
      resolverCORS("https://deploy-preview-12--registro.netlify.app")
    ).toBe("https://deploy-preview-12--registro.netlify.app");

    expect(resolverCORS("https://registro.netlify.app")).toBe(
      "https://registro.netlify.app"
    );
  });

  it("el comodín no abre subdominios inventados", () => {
    process.env.ALLOWED_ORIGIN = "https://*.netlify.app";
    // evilnetlify.app NO termina en ".netlify.app"
    expect(resolverCORS("https://evilnetlify.app")).not.toBe(
      "https://evilnetlify.app"
    );
  });

  it("respeta el esquema http en desarrollo", () => {
    process.env.ALLOWED_ORIGIN = "http://localhost:3000";
    expect(resolverCORS("http://localhost:3000")).toBe(
      "http://localhost:3000"
    );
  });

  it("las cabeceras incluyen los métodos y headers correctos", () => {
    process.env.ALLOWED_ORIGIN = "https://registro.nerwork.mx";
    const h = cabecerasCors("https://registro.nerwork.mx");

    expect(h["Access-Control-Allow-Origin"]).toBe(
      "https://registro.nerwork.mx"
    );
    expect(h["Access-Control-Allow-Methods"]).toContain("POST");
    expect(h["Access-Control-Allow-Headers"]).toContain("Content-Type");
    expect(h.Vary).toBe("Origin");
  });
});
