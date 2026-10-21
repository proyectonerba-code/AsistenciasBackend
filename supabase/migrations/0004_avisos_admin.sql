-- ============================================================
-- Control de Asistencia — Migración 0004: avisos_admin
-- Tabla para deduplicación de alertas al administrador (serverless-safe)
-- ============================================================

CREATE TABLE avisos_admin (
  clave TEXT PRIMARY KEY,
  ultima_envio TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_avisos_admin_ultima_envio ON avisos_admin(ultima_envio);

COMMENT ON TABLE avisos_admin IS
  'Control de deduplicación de avisos al admin. Una fila por tipo de aviso (clave).';