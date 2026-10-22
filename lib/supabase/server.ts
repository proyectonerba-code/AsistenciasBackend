/**
 * Cliente de Supabase con service role (SOLO servidor).
 * Nunca se expone al navegador. Se usa en route handlers y server actions.
 *
 * Si SUPABASE_DEMO=1 se usa un cliente simulado en memoria (modo demo) para
 * poder ver el sistema funcionando sin base de datos real.
 *
 * En modo demo el cliente es un singleton DEL PROCESO (globalThis + un
 * Symbol.for): Next.js compila cada route handler en su propio bundle y cada
 * uno crearía su propia base en memoria. Con el singleton, /api/checar y
 * /api/checar/info ven los mismos datos.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearSupabaseDemo } from "../demo/supabase-demo";
import { crearDatosDemo, esDemoActivo } from "../demo/datos";

const CLAVE = Symbol.for("nerba.asistencias.clienteDemoBackend");

type GlobalConDemo = typeof globalThis & { [CLAVE]?: SupabaseClient };

function clienteDemo(): SupabaseClient {
  const g = globalThis as GlobalConDemo;
  if (!g[CLAVE]) {
    const { cliente } = crearSupabaseDemo(crearDatosDemo());
    g[CLAVE] = cliente as unknown as SupabaseClient;
    console.log("[demo] Usando Supabase simulado en memoria (SUPABASE_DEMO=1)");
  }
  return g[CLAVE];
}

let cliente: SupabaseClient;

if (esDemoActivo()) {
  cliente = clienteDemo();
} else {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno del servidor."
    );
  }

  cliente = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export const supabaseAdmin = cliente;
