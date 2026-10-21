#!/usr/bin/env node
/**
 * Aplica las migraciones del Control de Asistencia en un proyecto de Supabase.
 *
 * Uso:
 *   SUPABASE_ACCESS_TOKEN=<personal access token> \
 *   SUPABASE_PROJECT_REF=<ref del proyecto> \
 *   node supabase/aplicar-migraciones.mjs
 *
 * Opciones:
 *   --verificar   Solo consulta el estado del esquema (no escribe nada).
 *   --reset       Borra las tablas del sistema antes de aplicar (pide confirmación).
 *   --dry-run     Muestra las sentencias sin ejecutarlas.
 *
 * Variables de entorno:
 *   SUPABASE_ACCESS_TOKEN  Token personal de supabase.com/dashboard/account/tokens
 *                          con el scope "exec_sql".
 *   SUPABASE_PROJECT_REF   Ref del proyecto (lo que va en ....supabase.co).
 *
 * El script NUNCA escribe credenciales en disco.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

const args = process.argv.slice(2);
const soloVerificar = args.includes("--verificar");
const dryRun = args.includes("--dry-run");
const reset = args.includes("--reset");

/** --solo 0003_seed.sql  (o un fragmento del nombre) */
const idxSolo = args.indexOf("--solo");
const solo = idxSolo !== -1 ? args[idxSolo + 1] : null;

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;

const API = "https://api.supabase.com";

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function log(...args) {
  console.log(...args);
}

function fail(mensaje, detalle) {
  console.error(`\n✖ ${mensaje}`);
  if (detalle) console.error(detalle);
  process.exit(1);
}

/**
 * Divide un archivo SQL en sentencias ejecutables.
 * Respeta: cadenas con comillas simples ('...'), bloques con $$
 * y $tag$, comentarios de línea (--) y de bloque (/* ... *\/).
 */
function dividirSentencias(sql) {
  const sentencias = [];
  let actual = "";
  let i = 0;
  let enComillaSimple = false;
  let etiquetaDollar = null;

  while (i < sql.length) {
    const c = sql[i];
    const dos = sql.slice(i, i + 2);

    // Bloque de comentario
    if (!enComillaSimple && !etiquetaDollar && dos === "--") {
      const fin = sql.indexOf("\n", i);
      i = fin === -1 ? sql.length : fin + 1;
      actual += "\n";
      continue;
    }
    if (!enComillaSimple && !etiquetaDollar && dos === "/*") {
      const fin = sql.indexOf("*/", i + 2);
      i = fin === -1 ? sql.length : fin + 2;
      continue;
    }

    // Cadena con comillas simples
    if (!etiquetaDollar && c === "'") {
      actual += c;
      i++;
      if (sql[i] === "'") {
        actual += "'";
        i++;
        continue;
      }
      enComillaSimple = !enComillaSimple;
      continue;
    }
    if (enComillaSimple) {
      actual += c;
      i++;
      continue;
    }

    // Bloque con etiqueta $...$
    if (!etiquetaDollar && c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        etiquetaDollar = m[0];
        actual += etiquetaDollar;
        i += etiquetaDollar.length;
        continue;
      }
    }
    if (etiquetaDollar) {
      if (sql.startsWith(etiquetaDollar, i)) {
        actual += etiquetaDollar;
        i += etiquetaDollar.length;
        etiquetaDollar = null;
        continue;
      }
      actual += c;
      i++;
      continue;
    }

    // Fin de sentencia
    if (c === ";") {
      const limpia = actual.trim();
      if (limpia) sentencias.push(limpia);
      actual = "";
      i++;
      continue;
    }

    actual += c;
    i++;
  }

  const ultima = actual.trim();
  if (ultima) sentencias.push(ultima);

  return sentencias;
}

/** Ejecuta SQL contra el proyecto vía Management API. */
async function ejecutar(sql) {
  const res = await fetch(`${API}/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });

  const texto = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${texto.slice(0, 800)}`);
  }

  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

/** Consulta y devuelve la primera fila. */
async function consultar(sql) {
  const r = await ejecutar(sql);
  if (Array.isArray(r) && Array.isArray(r[0])) return r[0];
  return r;
}

/* ------------------------------------------------------------------ */
/* Verificación                                                        */
/* ------------------------------------------------------------------ */

const CONSULTAS_VERIFICACION = [
  {
    nombre: "Tablas del sistema",
    sql: `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('usuarios','sedes','marcas','ajustes_manuales',
                               'horarios_especiales','faltas','rechazados','bitacora',
                               'admins','config','avisos_admin')
          ORDER BY table_name;`,
    esperado: 11,
  },
  {
    nombre: "Función registrar_marca",
    sql: `SELECT p.proname FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname = 'registrar_marca' AND n.nspname = 'public';`,
    esperado: 1,
  },
  {
    nombre: "Usuarios",
    sql: "SELECT count(*)::int AS n FROM usuarios;",
    esperado: null,
  },
  {
    nombre: "Sedes",
    sql: "SELECT count(*)::int AS n FROM sedes;",
    esperado: null,
  },
  {
    nombre: "Admins",
    sql: "SELECT count(*)::int AS n FROM admins;",
    esperado: null,
  },
  {
    nombre: "Parámetros de configuración",
    sql: "SELECT count(*)::int AS n FROM config;",
    esperado: null,
  },
];

async function verificar() {
  log("\n── Verificación ──────────────────────────────────────────\n");

  let ok = true;

  for (const c of CONSULTAS_VERIFICACION) {
    try {
      const filas = await consultar(c.sql);
      const n = Array.isArray(filas) ? filas.length : 0;
      const valor = filas && filas[0] ? filas[0].n ?? filas[0].table_name ?? filas[0].proname : null;

      if (c.esperado !== null) {
        const bien = n === c.esperado;
        ok = ok && bien;
        log(`${bien ? "✔" : "✖"} ${c.nombre}: ${n} (esperado ${c.esperado})`);
      } else {
        log(`✔ ${c.nombre}: ${valor}`);
      }
    } catch (err) {
      ok = false;
      log(`✖ ${c.nombre}: ${err.message}`);
    }
  }

  // RLS activo en todas las tablas
  try {
    const filas = await consultar(
      `SELECT count(*)::int AS n FROM pg_tables
       WHERE schemaname = 'public' AND rowsecurity = true
         AND tablename IN ('usuarios','sedes','marcas','ajustes_manuales',
                           'horarios_especiales','faltas','rechazados','bitacora',
                           'admins','config','avisos_admin');`
    );
    const n = filas?.[0]?.n ?? 0;
    const bien = n === 11;
    ok = ok && bien;
    log(`${bien ? "✔" : "✖"} RLS activo en las 11 tablas: ${n}`);
  } catch (err) {
    log(`✖ RLS: ${err.message}`);
  }

  log("");
  return ok;
}

/* ------------------------------------------------------------------ */
/* Principal                                                           */
/* ------------------------------------------------------------------ */

async function main() {
  if (!TOKEN) {
    fail(
      "Falta SUPABASE_ACCESS_TOKEN.",
      "Créalo en https://supabase.com/dashboard/account/tokens con el scope exec_sql."
    );
  }
  if (!REF) {
    fail(
      "Falta SUPABASE_PROJECT_REF.",
      "Es el texto entre https:// y .supabase.co en la URL de tu proyecto."
    );
  }

  log(`Proyecto: ${REF}`);
  log(`API:      ${API}`);

  if (soloVerificar) {
    const ok = await verificar();
    process.exit(ok ? 0 : 1);
  }

  /* --- Reset opcional ------------------------------------------- */
  if (reset) {
    log("\n⚠  BORRANDO las tablas del sistema…");
    const tablas = [
      "bitacora",
      "avisos_admin",
      "rechazados",
      "faltas",
      "horarios_especiales",
      "ajustes_manuales",
      "marcas",
      "usuarios",
      "sedes",
      "admins",
      "config",
    ];
    await ejecutar(
      `DROP TABLE IF EXISTS ${tablas.join(", ")} CASCADE;
       DROP FUNCTION IF EXISTS registrar_marca(uuid, double precision, double precision,
         double precision, double precision, uuid, text, text, text) CASCADE;`
    );
    log("   Tablas eliminadas.");
  }

  /* --- Migraciones ----------------------------------------------- */
  const archivos = existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .filter((f) => !solo || f.includes(solo))
        .sort()
    : [];

  if (archivos.length === 0) {
    fail(
      solo
        ? `No se encontró ninguna migración que coincida con "${solo}".`
        : "No se encontraron migraciones en supabase/migrations/."
    );
  }

  log(`\nMigraciones: ${archivos.join(", ")}\n`);

  let total = 0;

  for (const archivo of archivos) {
    const ruta = join(MIGRATIONS_DIR, archivo);
    const sql = readFileSync(ruta, "utf8");
    const sentencias = dividirSentencias(sql);

    log(`── ${archivo} (${sentencias.length} sentencias) ──`);

    for (let n = 0; n < sentencias.length; n++) {
      const s = sentencias[n];
      const primera = s.split("\n").find((l) => l.trim() && !l.trim().startsWith("--")) || "";
      const resumen = primera.slice(0, 76);

      if (dryRun) {
        log(`   [dry-run] ${resumen}`);
        total++;
        continue;
      }

      try {
        await ejecutar(s);
        total++;
        log(`   ✔ ${resumen}`);
      } catch (err) {
        console.error(`\n✖ Falló en ${archivo}, sentencia ${n + 1}:`);
        console.error(`   ${resumen}`);
        console.error(`\n${err.message}\n`);
        process.exit(1);
      }
    }
  }

  log(`\n✔ ${total} sentencias aplicadas.`);

  const ok = await verificar();
  log(ok ? "✔ Esquema listo." : "⚠  Aplicado, pero la verificación reporta diferencias.");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => fail("Error inesperado", err.stack || err.message));
