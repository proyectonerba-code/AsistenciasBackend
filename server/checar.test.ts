import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";

const respuestasPorTabla = new Map<string, any>();
const insertRechazadosMock = vi.fn().mockResolvedValue({ error: null });
const upsertMock = vi.fn().mockResolvedValue({ error: null });
const deleteMock = vi.fn().mockResolvedValue({ error: null });

function crearCadena(tabla: string) {
  const data = respuestasPorTabla.get(tabla) ?? [];
  let modoResolucion: "lista" | "single" | "maybeSingle" = "lista";
  const obj: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    single: vi.fn(() => {
      modoResolucion = "single";
      return obj;
    }),
    maybeSingle: vi.fn(() => {
      modoResolucion = "maybeSingle";
      return obj;
    }),
    insert: insertRechazadosMock,
    upsert: upsertMock,
    delete: deleteMock,
    then: vi.fn((resolve: any) => {
      if (modoResolucion === "single") {
        return resolve({
          data: data.length > 0 ? data[0] : null,
          error: data.length > 0 ? null : { message: "No se encontró el registro" },
        });
      }
      if (modoResolucion === "maybeSingle") {
        return resolve({
          data: data.length > 0 ? data[0] : null,
          error: null,
        });
      }
      return resolve({ data });
    }),
  };
  return obj;
}

vi.mock("../lib/supabase/server", () => ({
  supabaseAdmin: {
    from: vi.fn((tabla: string) => crearCadena(tabla)),
    rpc: vi.fn(),
  },
}));

import { supabaseAdmin } from "../lib/supabase/server";
import { procesarChecar, resetConfigCache } from "./checar";
import { sha256Hex } from "../lib/crypto";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockRpc = vi.mocked(supabaseAdmin.rpc);

const IP_TEST = "200.1.2.3";
const UA_TEST = "Mozilla/5.0 (iPhone; CPU iPhone OS 17 like Mac OS X)";

const TOKEN_VALIDO = "N7ZEJVLAUQZVUSSLP3UWYEGF";
const USUARIO_ID = "11111111-1111-1111-1111-111111111111";

let TOKEN_HASH_VALIDO = "";

beforeAll(async () => {
  TOKEN_HASH_VALIDO = await sha256Hex(TOKEN_VALIDO);
});

beforeEach(() => {
  vi.restoreAllMocks();
  insertRechazadosMock.mockReset();
  upsertMock.mockReset();
  deleteMock.mockReset();
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockFrom.mockImplementation((tabla: string) => crearCadena(tabla));
  respuestasPorTabla.clear();
  // La caché de config vive a nivel de módulo: hay que limpiarla entre tests.
  resetConfigCache();
});

function configurar(tabla: string, data: any[]) {
  respuestasPorTabla.set(tabla, data);
}

describe("procesarChecar — caso feliz", () => {
  it("registra ENTRADA si es la primera marca del día", async () => {
    configurar("config", [
      { clave: "hora_min_registro", valor: "06:00" },
      { clave: "hora_max_registro", valor: "23:30" },
      { clave: "minutos_entre_marcas", valor: 5 },
      { clave: "radio_geocerca_default_m", valor: 100 },
      { clave: "precision_max_m", valor: 50 },
    ]);
    configurar("usuarios", [
      {
        id: USUARIO_ID,
        nombre: "Jesus Guadarrama",
        activo: true,
        token_hash: TOKEN_HASH_VALIDO,
      },
    ]);
    configurar("sedes", [
      {
        id: "sede-1",
        nombre: "Oficina Central",
        lat: 19.4326,
        lng: -99.1332,
        radio_m: 100,
      },
    ]);
    configurar("marcas", []);
    mockRpc.mockResolvedValue({
      data: [{ tipo: "ENTRADA", hora: "09:02", ts: "2026-06-10T15:02:00Z" }],
      error: null,
    } as unknown as PostgrestSingleResponse<any>);

    const res = await procesarChecar(
      { token: TOKEN_VALIDO, lat: 19.4326, lng: -99.1332, accuracy: 10 },
      IP_TEST,
      UA_TEST
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.tipo).toBe("ENTRADA");
      expect(res.data.hora).toBe("09:02");
      expect(res.data.nombre).toBe("Jesus Guadarrama");
    }
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("registra SALIDA si ya hay una marca hoy (más de 5 min)", async () => {
    configurar("config", [
      { clave: "hora_min_registro", valor: "06:00" },
      { clave: "hora_max_registro", valor: "23:30" },
      { clave: "minutos_entre_marcas", valor: 5 },
      { clave: "radio_geocerca_default_m", valor: 100 },
      { clave: "precision_max_m", valor: 50 },
    ]);
    configurar("usuarios", [
      {
        id: USUARIO_ID,
        nombre: "Jesus Guadarrama",
        activo: true,
        token_hash: TOKEN_HASH_VALIDO,
      },
    ]);
    configurar("sedes", [
      {
        id: "sede-1",
        nombre: "Oficina Central",
        lat: 19.4326,
        lng: -99.1332,
        radio_m: 100,
      },
    ]);
    const hace120Min = new Date(Date.now() - 120 * 60000).toISOString();
    configurar("marcas", [{ ts: hace120Min }]);
    mockRpc.mockResolvedValue({
      data: [{ tipo: "SALIDA", hora: "18:05", ts: "2026-06-11T00:05:00Z" }],
      error: null,
    } as unknown as PostgrestSingleResponse<any>);

    const res = await procesarChecar(
      { token: TOKEN_VALIDO, lat: 19.4326, lng: -99.1332, accuracy: 10 },
      IP_TEST,
      UA_TEST
    );

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.tipo).toBe("SALIDA");
  });
});

describe("procesarChecar — rechazos", () => {
  it("token invalido devuelve rechazo", async () => {
    configurar("config", [
      { clave: "hora_min_registro", valor: "06:00" },
      { clave: "hora_max_registro", valor: "23:30" },
      { clave: "minutos_entre_marcas", valor: 5 },
      { clave: "radio_geocerca_default_m", valor: 100 },
      { clave: "precision_max_m", valor: 50 },
    ]);
    configurar("usuarios", []);

    const res = await procesarChecar(
      { token: "TOKENINEXISTENTE12345678", lat: 19.4326, lng: -99.1332, accuracy: 10 },
      IP_TEST,
      UA_TEST
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.motivo).toBe("token invalido");
      expect(res.error.tokenPrefijo).toBe("TOKE");
    }
    expect(insertRechazadosMock).toHaveBeenCalled();
  });

  it("fuera de zona cuando no hay sedes activas cerca", async () => {
    configurar("config", [
      { clave: "hora_min_registro", valor: "06:00" },
      { clave: "hora_max_registro", valor: "23:30" },
      { clave: "minutos_entre_marcas", valor: 5 },
      { clave: "radio_geocerca_default_m", valor: 100 },
      { clave: "precision_max_m", valor: 50 },
    ]);
    configurar("usuarios", [
      { id: USUARIO_ID, nombre: "Jesus Guadarrama", activo: true, token_hash: TOKEN_HASH_VALIDO },
    ]);
    configurar("sedes", []);
    configurar("marcas", []);

    const res = await procesarChecar(
      { token: TOKEN_VALIDO, lat: 20.6597, lng: -103.3496, accuracy: 10 },
      IP_TEST,
      UA_TEST
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.motivo).toBe("fuera de zona");
    expect(insertRechazadosMock).toHaveBeenCalled();
  });

  it("precision insuficiente cuando accuracy > 50 m", async () => {
    configurar("config", [
      { clave: "hora_min_registro", valor: "06:00" },
      { clave: "hora_max_registro", valor: "23:30" },
      { clave: "minutos_entre_marcas", valor: 5 },
      { clave: "radio_geocerca_default_m", valor: 100 },
      { clave: "precision_max_m", valor: 50 },
    ]);
    configurar("usuarios", [
      { id: USUARIO_ID, nombre: "Jesus Guadarrama", activo: true, token_hash: TOKEN_HASH_VALIDO },
    ]);
    configurar("sedes", [
      { id: "sede-1", nombre: "Oficina", lat: 19.4326, lng: -99.1332, radio_m: 100 },
    ]);
    configurar("marcas", []);

    const res = await procesarChecar(
      { token: TOKEN_VALIDO, lat: 19.4326, lng: -99.1332, accuracy: 200 },
      IP_TEST,
      UA_TEST
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.motivo).toBe("precision insuficiente");
  });

  it("doble registro si última marca hace menos de 5 min", async () => {
    configurar("config", [
      { clave: "hora_min_registro", valor: "06:00" },
      { clave: "hora_max_registro", valor: "23:30" },
      { clave: "minutos_entre_marcas", valor: 5 },
      { clave: "radio_geocerca_default_m", valor: 100 },
      { clave: "precision_max_m", valor: 50 },
    ]);
    configurar("usuarios", [
      { id: USUARIO_ID, nombre: "Jesus Guadarrama", activo: true, token_hash: TOKEN_HASH_VALIDO },
    ]);
    configurar("sedes", [
      { id: "sede-1", nombre: "Oficina", lat: 19.4326, lng: -99.1332, radio_m: 100 },
    ]);
    const hace2Min = new Date(Date.now() - 2 * 60000).toISOString();
    configurar("marcas", [{ ts: hace2Min }]);

    const res = await procesarChecar(
      { token: TOKEN_VALIDO, lat: 19.4326, lng: -99.1332, accuracy: 10 },
      IP_TEST,
      UA_TEST
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.motivo).toBe("doble registro");
      expect(res.error.mensaje).toContain("Ya registraste");
    }
  });

  it("sin ubicación cuando no se envían coordenadas", async () => {
    configurar("config", [
      { clave: "hora_min_registro", valor: "06:00" },
      { clave: "hora_max_registro", valor: "23:30" },
      { clave: "minutos_entre_marcas", valor: 5 },
      { clave: "radio_geocerca_default_m", valor: 100 },
      { clave: "precision_max_m", valor: 50 },
    ]);
    configurar("usuarios", [
      { id: USUARIO_ID, nombre: "Jesus Guadarrama", activo: true, token_hash: TOKEN_HASH_VALIDO },
    ]);

    const res = await procesarChecar(
      { token: TOKEN_VALIDO },
      IP_TEST,
      UA_TEST
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.motivo).toBe("sin ubicacion");
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
