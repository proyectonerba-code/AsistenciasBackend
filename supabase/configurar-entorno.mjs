#!/usr/bin/env node
/**
 * Configura las variables de entorno del Control de Asistencia NerWork
 * (backend + panel de administración) a partir de las credenciales de Supabase.
 *
 * Escribe los archivos .env.local de AsistenciasBackend y
 * AsistenciasVistaAdministrador. Ambos están en .gitignore: las llaves NUNCA
 * se suben al repositorio.
 *
 * Uso:
 *   node supabase/configurar-entorno.mjs \
 *     --url "https://abcxyz.supabase.co" \
 *     --service-role "eyJ..." \
 *     --anon-key "eyJ..." \
 *     [--registro-url "https://registro.nerwork.mx"] \
 *     [--admin-correo "marionly420@gmail.com"] \
 *     [--migrar]
 *
 * Opciones:
 *   --url            Project URL de Supabase.
 *   --service-role   Llave service_role (Project Settings > API). Acceso total.
 *   --anon-key       Llave anon pública (solo login del panel).
 *   --registro-url   URL pública de la vista de registro.
 *   --admin-correo   Correo que quedará como administrador del panel.
 *   --migrar         Aplica también las migraciones (necesita
 *                    SUPABASE_ACCESS_TOKEN y SUPABASE_PROJECT_REF).
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(__dirname, "..", "..");

/* ------------------------------------------------------------------ */
/* Argumentos                                                          */
/* ------------------------------------------------------------------ */

function leerArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const clave = a.slice(2);
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith("--")) {
        args[clave] = true;
      } else {
        args[clave] = valor;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

const args = leerArgs(process.argv.slice(2));

const URL_SUPABASE = args.url;
const SERVICE_ROLE = args["service-role"];
const ANON_KEY = args["anon-key"];
const REGISTRO_URL = args["registro-url"] || "http://localhost:3000";
const ADMIN_CORREO = args["admin-correo"] || "marionly420@gmail.com";
const MIGRAR = args.migrar === true || args.migrar === "true";

/* ------------------------------------------------------------------ */
/* Validación                                                          */
/* ------------------------------------------------------------------ */

function fallar(mensaje, extra) {
  console.error(`\n✖ ${mensaje}`);
  if (extra) console.error(extra);
  process.exit(1);
}

const faltantes = [];
if (!URL_SUPABASE) faltantes.push("--url");
if (!SERVICE_ROLE) faltantes.push("--service-role");
if (!ANON_KEY) faltantes.push("--anon-key");

if (faltantes.length > 0) {
  fallar(
    `Faltan argumentos: ${faltantes.join(", ")}`,
    `
Ejemplo:
  node supabase/configurar-entorno.mjs \\
    --url "https://abcxyz.supabase.co" \\
    --service-role "eyJ..." \\
    --anon-key "eyJ..." \\
    --registro-url "https://registro.nerwork.mx" \\
    --migrar
`
  );
}

if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(URL_SUPABASE)) {
  console.warn(
    "⚠ La URL no tiene el formato esperado (https://xxxx.supabase.co). Se usa tal cual."
  );
}

for (const [nombre, valor] of [
  ["--service-role", SERVICE_ROLE],
  ["--anon-key", ANON_KEY],
]) {
  if (!String(valor).startsWith("eyJ")) {
    fallar(
      `El valor de ${nombre} no parece un JWT (debería empezar con "eyJ").`,
      "En Supabase: Project Settings > API > Project API keys."
    );
  }
}

/* ------------------------------------------------------------------ */
/* Escritura de los .env.local                                         */
/* ------------------------------------------------------------------ */

const backendDir = join(RAIZ, "AsistenciasBackend");
const adminDir = join(RAIZ, "AsistenciasVistaAdministrador");

if (!existsSync(backendDir)) {
  fallar(`No se encontró la carpeta AsistenciasBackend en ${RAIZ}`);
}
if (!existsSync(adminDir)) {
  fallar(`No se encontró la carpeta AsistenciasVistaAdministrador en ${RAIZ}`);
}

const cabecera = [
  "# Control de Asistencia - variables locales",
  "# Generado por supabase/configurar-entorno.mjs",
  "# NO SUBIR AL REPOSITORIO (esta en .gitignore)",
  "",
].join("\n");

const backendEnv = `${cabecera}
SUPABASE_URL=${URL_SUPABASE}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE}
SUPABASE_DEMO=0

ALLOWED_ORIGIN=${REGISTRO_URL}

CRON_SECRET=${randomUUID().replace(/-/g, "")}
ADMIN_ALERT_EMAIL=${ADMIN_CORREO}
EMAIL_PROVIDER=console

TZ=America/Mexico_City
`;

const adminEnv = `${cabecera}
NEXT_PUBLIC_SUPABASE_URL=${URL_SUPABASE}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE}
SUPABASE_DEMO=0

SESSION_SECRET=${randomUUID().replace(/-/g, "")}
ADMIN_ALERT_EMAIL=${ADMIN_CORREO}
NEXT_PUBLIC_REGISTRO_URL=${REGISTRO_URL}

TZ=America/Mexico_City
`;

writeFileSync(join(backendDir, ".env.local"), backendEnv, "utf8");
console.log("✔ AsistenciasBackend/.env.local");

writeFileSync(join(adminDir, ".env.local"), adminEnv, "utf8");
console.log("✔ AsistenciasVistaAdministrador/.env.local");

/* ------------------------------------------------------------------ */
/* Migraciones (opcional)                                             */
/* ------------------------------------------------------------------ */

if (MIGRAR) {
  if (!process.env.SUPABASE_ACCESS_TOKEN || !process.env.SUPABASE_PROJECT_REF) {
    console.warn(
      "\n⚠ Se saltan las migraciones: faltan SUPABASE_ACCESS_TOKEN o SUPABASE_PROJECT_REF."
    );
  } else {
    console.log("\n→ Aplicando migraciones…");
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      process.execPath,
      [join(backendDir, "supabase", "aplicar-migraciones.mjs")],
      { stdio: "inherit", cwd: backendDir }
    );
    if (r.status !== 0) {
      fallar("Las migraciones fallaron.");
    }
  }
}

/* ------------------------------------------------------------------ */
/* Resumen                                                             */
/* ------------------------------------------------------------------ */

console.log(`
Listo. Ahora:

  1. Crea la cuenta de acceso al panel:
       Supabase > Authentication > Users > Add user
       correo: ${ADMIN_CORREO}

  2. Da de alta ese correo como administrador:
       INSERT INTO admins (correo, rol) VALUES ('${ADMIN_CORREO}', 'admin');

  3. Arranca las apps:
       cd AsistenciasBackend            && npm run dev
       cd AsistenciasVistaRegistro      && npm run dev
       cd AsistenciasVistaAdministrador && npm run dev
`);
