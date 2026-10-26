-- ============================================================
-- Control de Asistencia — Migración 0007: fecha de inicio + justificaciones
--
-- 1. fecha_inicio_laburo en usuarios: para calcular años de laburo
--    y vacaciones (se guarda la fecha en que empezó a trabajar).
--
-- 2. Tabla justificaciones: faltas justificadas manualmente por el admin
--    (enfermedad, día festivo, etc.) con motivo escrito a mano.
-- ============================================================

-- ------------------------------------------------------------
-- 1. fecha_inicio_laburo en la tabla usuarios
-- ------------------------------------------------------------
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS fecha_inicio_laburo DATE;

COMMENT ON COLUMN usuarios.fecha_inicio_laburo IS
  'Fecha en que el colaborador empezó a laburar. Se usa para calcular años de servicio y vacaciones.';

-- ------------------------------------------------------------
-- 2. Tabla justificaciones
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS justificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('enfermedad', 'festivo', 'asunto_proprio', 'otro')),
  motivo TEXT NOT NULL CHECK (length(motivo) >= 3),
  creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  creada_por TEXT NOT NULL,
  UNIQUE (usuario_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_justificaciones_fecha ON justificaciones(fecha);
CREATE INDEX IF NOT EXISTS idx_justificaciones_usuario ON justificaciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_justificaciones_tipo ON justificaciones(tipo);

-- RLS: solo el service role del backend.
ALTER TABLE justificaciones ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'justificaciones' AND policyname = 'deny_all_justificaciones'
  ) THEN
    CREATE POLICY deny_all_justificaciones ON justificaciones FOR ALL USING (false);
  END IF;
END $$;

COMMENT ON TABLE justificaciones IS
  'Faltas justificadas manualmente por el administrador (enfermedad, día festivo, asunto propio, otro). Incluye motivo escrito a mano.';

-- ------------------------------------------------------------
-- Nota: la tabla `faltas` existente ya sirve para faltas sin justificar.
-- Las justificaciones van en su propia tabla para llevar el motivo y el tipo.
-- ============================================================
