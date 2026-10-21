-- ============================================================
-- Control de Asistencia — Migración 0004: avisos_admin
-- Tabla para deduplicación de alertas al administrador (serverless-safe)
-- ============================================================

CREATE TABLE IF NOT EXISTS avisos_admin (
  clave TEXT PRIMARY KEY,
  ultima_envio TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_avisos_admin_ultima_envio ON avisos_admin(ultima_envio);

-- RLS: solo el service role del backend debe leer/escribir esta tabla.
-- Sin esto, la llave anon del proyecto podria leerla.
ALTER TABLE avisos_admin ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'avisos_admin' AND policyname = 'deny_all_avisos_admin'
  ) THEN
    CREATE POLICY deny_all_avisos_admin ON avisos_admin FOR ALL USING (false);
  END IF;
END;
$$;

COMMENT ON TABLE avisos_admin IS
  'Control de deduplicación de avisos al admin. Una fila por tipo de aviso (clave).';
