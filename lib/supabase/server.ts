/**
 * Cliente de Supabase con service role (SOLO servidor).
 * Nunca se expone al navegador. Se usa en route handlers y server actions.
 *
 * Si SUPABASE_DEMO=1 se usa un cliente simulado en memoria (modo demo) para
 * poder ver el sistema funcionando sin base de datos real.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearSupabaseDemo } from "../demo/supabase-demo";
import { crearDatosDemo, esDemoActivo } from "../demo/datos";

let cliente: SupabaseClient;

if (esDemoActivo()) {
  const { cliente: demo } = crearSupabaseDemo(crearDatosDemo());
  cliente = demo as unknown as SupabaseClient;
  console.log("[demo] Usando Supabase simulado en memoria (SUPABASE_DEMO=1)");
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
