#!/usr/bin/env node
/**
 * Conecta el Control de Asistencia con un proyecto de Supabase de una vez.
 *
 * Hace todo el trabajo de una sentada:
 *   1. Descubre el proyecto (o el que se indique con --ref).
 *   2. Obtiene la service_role y la anon key.
 *   3. Aplica las migraciones y verifica el esquema.
 *   4. Escribe los .env.local del backend y del panel de administración.
 *   5. Crea el usuario administrador en Supabase Auth.
 *
 * Uso:
 *   SUPABASE_ACCESS_TOKEN=sbp_... node supabase/conectar.mjs [opciones]
 *
 * Opciones:
 *   --ref <ref>              Ref del proyecto (si hay varios).
 *   --nombre <texto>         Busca el proyecto cuyo nombre contenga <texto>.
 *   --admin-correo <correo>  Administrador del panel.
 *   --admin-password <pass>  Contraseña (si no, se genera una).
 *   --registro-url <url>     URL pública de la vista de registro.
 *   --sin-migrar             No aplica las migraciones.
 *   --sin-admin              No crea el usuario en Auth.
 */
import { writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(__dirname, "..", "..");
const API = "https://api.supabase.com";

/* ------------------------------------------------------------------ */
/* Argumentos                                                          */
/* ------------------------------------------------------------------ */

function leerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const clave = a.slice(2);
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith("--")) args[clave] = true;
      else { args[clave] = valor; i++; }
    }
  }
  return args;
}

const args = leerArgs(process.argv.slice(2));
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

const ADMIN_CORREO = args["admin-correo"] || "marionly420@gmail.com";
const REGISTRO_URL = args["registro-url"] || "http://localhost:3000";
const SIN_MIGRAR = !!args["sin-migrar"];
const SIN_ADMIN = !!args["sin-admin"];

function log(...a) { console.log(...a); }
function ok(msg) { console.log(`✔ ${msg}`); }
function paso(msg) { console.log(`\n→ ${msg}`); }

/** Error que termina el programa con código 1 (sin cortar la salida por stdout). */
class ErrorFatal extends Error {}

function fallar(msg, extra) {
  console.error(`\n✖ ${msg}`);
  if (extra) console.error(extra);
  throw new ErrorFatal(msg);
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

async function mg(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const texto = await res.text();
  let cuerpo;
  try { cuerpo = texto ? JSON.parse(texto) : null; } catch { cuerpo = texto; }
  if (!res.ok) {
    const err = new Error(
      typeof cuerpo === "object" && cuerpo?.message
        ? cuerpo.message
        : `HTTP ${res.status}: ${String(texto).slice(0, 300)}`
    );
    err.status = res.status;
    err.body = cuerpo;
    throw err;
  }
  return cuerpo;
}

async function sql(ref, query) {
  return mg(`/v1/projects/${ref}/database/query`, {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}

/* ------------------------------------------------------------------ */
/* 1. Descubrir el proyecto                                            */
/* ------------------------------------------------------------------ */

async function descubrirProyecto() {
  let lista;
  try {
    lista = await mg("/v1/projects");
  } catch (err) {
    if (err.status === 403 && /projects_read/.test(err.message)) {
      fallar(
        "El token no tiene el alcance 'projects_read'.",
        `Genera un token nuevo en https://supabase.com/dashboard/account/tokens
   y marca los alcances:  projects_read  +  exec_sql

   (El token actual solo tiene exec_sql: sirve para ejecutar SQL,
    pero no para descubrir el proyecto ni leer sus llaves.)`
      );
    }
    throw err;
  }

  if (!Array.isArray(lista) || lista.length === 0) {
    fallar(
      "No se encontró ningún proyecto en tu cuenta.",
      "Crea uno en https://supabase.com/dashboard y vuelve a ejecutar."
    );
  }

  log(`Proyectos encontrados: ${lista.length}`);
  for (const p of lista) {
    log(`   · ${p.name}  (ref: ${p.ref}, región: ${p.region}, estado: ${p.status})`);
  }

  let elegido = null;

  if (args.ref) {
    elegido = lista.find((p) => p.ref === args.ref);
    if (!elegido) fallar(`No existe un proyecto con ref "${args.ref}".`);
  } else if (args.nombre) {
    const n = String(args.nombre).toLowerCase();
    elegido = lista.find((p) => String(p.name).toLowerCase().includes(n));
    if (!elegido) fallar(`Ningún proyecto cuyo nombre contenga "${args.nombre}".`);
  } else if (lista.length === 1) {
    elegido = lista[0];
  } else {
    fallar(
      "Hay varios proyectos. Indica cuál con --ref o --nombre.",
      `Refs: ${lista.map((p) => p.ref).join(", ")}`
    );
  }

  return elegido;
}

/* ------------------------------------------------------------------ */
/* 2. Obtener las llaves                                               */
/* ------------------------------------------------------------------ */

async function obtenerLlaves(ref) {
  const crudos = await mg(`/v1/projects/${ref}/api-keys`);

  let anon = null;
  let service = null;

  const lista = Array.isArray(crudos) ? crudos : [crudos];

  for (const k of lista) {
    if (!k || typeof k !== "object") continue;
    const tipo = String(k.type || k.name || "").toLowerCase();
    const valor = k.api_key || k.key || k.value;
    if (!valor) continue;
    if (tipo.includes("service") || tipo.includes("secret")) service = valor;
    else if (tipo.includes("anon") || tipo.includes("publishable")) anon = valor;
  }

  // Formato antiguo: { anon_key, service_role_key, jwt_secret }
  if (!anon && crudos?.anon_key) anon = crudos.anon_key;
  if (!service && crudos?.service_role_key) service = crudos.service_role_key;

  if (!anon || !service) {
    fallar(
      "No pude obtener las llaves del proyecto.",
      `Respuesta recibida: ${JSON.stringify(crudos).slice(0, 400)}`
    );
  }

  return { anon, service };
}

/* ------------------------------------------------------------------ */
/* 3. Migraciones                                                      */
/* ------------------------------------------------------------------ */

async function aplicarMigraciones(ref) {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(
    process.execPath,
    [join(__dirname, "aplicar-migraciones.mjs")],
    {
      stdio: "inherit",
      cwd: join(RAIZ, "AsistenciasBackend"),
      env: { ...process.env, SUPABASE_PROJECT_REF: ref },
    }
  );
  if (r.status !== 0) fallar("Las migraciones fallaron.");
}

/* ------------------------------------------------------------------ */
/* 4. Escribir los .env.local                                          */
/* ------------------------------------------------------------------ */

function escribirEntornos(url, service, anon) {
  const backendDir = join(RAIZ, "AsistenciasBackend");
  const adminDir = join(RAIZ, "AsistenciasVistaAdministrador");

  if (!existsSync(backendDir) || !existsSync(adminDir)) {
    fallar(`No se encontraron las carpetas de las apps en ${RAIZ}`);
  }

  const cab = [
    "# Control de Asistencia - variables locales",
    "# Generado por supabase/conectar.mjs",
    "# NO SUBIR AL REPOSITORIO (esta en .gitignore)",
    "",
  ].join("\n");

  writeFileSync(
    join(backendDir, ".env.local"),
    `${cab}
SUPABASE_URL=${url}
SUPABASE_SERVICE_ROLE_KEY=${service}
SUPABASE_DEMO=0

ALLOWED_ORIGIN=${REGISTRO_URL}

CRON_SECRET=${randomUUID().replace(/-/g, "")}
ADMIN_ALERT_EMAIL=${ADMIN_CORREO}
EMAIL_PROVIDER=console

TZ=America/Mexico_City
`,
    "utf8"
  );
  ok("AsistenciasBackend/.env.local");

  writeFileSync(
    join(adminDir, ".env.local"),
    `${cab}
NEXT_PUBLIC_SUPABASE_URL=${url}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}
SUPABASE_SERVICE_ROLE_KEY=${service}
SUPABASE_DEMO=0

SESSION_SECRET=${randomUUID().replace(/-/g, "")}
ADMIN_ALERT_EMAIL=${ADMIN_CORREO}
NEXT_PUBLIC_REGISTRO_URL=${REGISTRO_URL}

TZ=America/Mexico_City
`,
    "utf8"
  );
  ok("AsistenciasVistaAdministrador/.env.local");
}

/* ------------------------------------------------------------------ */
/* 5. Usuario administrador en Supabase Auth                           */
/* ------------------------------------------------------------------ */

async function crearAdmin(url, service, correo, password) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: correo,
      password,
      email_confirm: true,
      user_metadata: { role: "admin" },
    }),
  });

  const texto = await res.text();
  let cuerpo;
  try { cuerpo = texto ? JSON.parse(texto) : null; } catch { cuerpo = texto; }

  if (!res.ok) {
    const msg = cuerpo?.msg || cuerpo?.message || cuerpo?.error_description || texto;
    if (/already|registered|exists/i.test(String(msg))) {
      log(`   El correo ${correo} ya existe en Auth: no se crea de nuevo.`);
      return { yaExistia: true, password: null };
    }
    failarCreacion = `No se pudo crear el usuario: ${String(msg).slice(0, 300)}`;
    return { yaExistia: false, password: null };
  }

  return { yaExistia: false, password, id: cuerpo?.id };
}

let failarCreacion = null;

/* ------------------------------------------------------------------ */
/* Principal                                                           */
/* ------------------------------------------------------------------ */

async function main() {
  if (!TOKEN) {
    fallar(
      "Falta SUPABASE_ACCESS_TOKEN.",
      "Ejemplo:  $env:SUPABASE_ACCESS_TOKEN='sbp_...'\n" +
        "          node supabase/conectar.mjs"
    );
  }

  paso("1/5  Buscando el proyecto");
  const proyecto = await descubrirProyecto();
  ok(`${proyecto.name} (ref: ${proyecto.ref}, ${proyecto.region})`);

  paso("2/5  Obteniendo las llaves del proyecto");
  const { anon, service } = await obtenerLlaves(proyecto.ref);
  ok("service_role y anon key obtenidas");

  const url = `https://${proyecto.ref}.supabase.co`;

  paso("3/5  Aplicando migraciones");
  if (SIN_MIGRAR) {
    log("   Omitido (--sin-migrar).");
  } else {
    await aplicarMigraciones(proyecto.ref);
  }

  paso("4/5  Escribiendo los .env.local");
  escribirEntornos(url, service, anon);

  paso("5/5  Usuario administrador del panel");
  if (SIN_ADMIN) {
    log("   Omitido (--sin-admin).");
  } else {
    const password =
      args["admin-password"] || `NerWork-${randomBytes(6).toString("hex")}`;
    const r = await crearAdmin(url, service, ADMIN_CORREO, password);
    if (failarCreacion) fallar(failarCreacion);
    if (r.yaExistia) {
      ok(`El usuario ${ADMIN_CORREO} ya existía en Auth`);
    } else {
      ok(`Usuario creado: ${ADMIN_CORREO}`);
      console.log(`\n   CONTRASEÑA: ${password}`);
      console.log("   (cámbiala en Supabase > Authentication > Users)\n");
    }
  }

  console.log(`
────────────────────────────────────────────────────────────
  CONEXIÓN LISTA
────────────────────────────────────────────────────────────
  Proyecto : ${proyecto.name} (${proyecto.ref})
  URL      : ${url}
  Panel    : ${ADMIN_CORREO}
────────────────────────────────────────────────────────────

  Falta:
   · Poner las coordenadas reales de la sede (tabla "sedes").
   · Rotar los tokens de ejemplo del catálogo (Empleados > Regenerar token).
   · Arrancar las tres apps.
`);
}

main().catch((err) => {
  if (err instanceof ErrorFatal) {
    process.exitCode = 1;
    return;
  }
  console.error(`\n✖ Error inesperado\n${err.stack || err.message}`);
  process.exitCode = 1;
});
