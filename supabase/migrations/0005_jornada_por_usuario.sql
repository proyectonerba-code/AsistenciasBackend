-- ============================================================
-- Control de Asistencia — Migración 0005: jornada por usuario
--
-- Permite que cada colaborador tenga su propia jornada, en lugar de
-- heredar siempre la del área:
--
--   jornada_inicio / jornada_fin      -> lunes a viernes
--   sabado_trabaja                    -> ¿trabaja los sábados?
--   sabado_inicio / sabado_fin        -> jornada del sábado
--   sabado_minutos_comida             -> receso del sábado (0 = sin receso)
--
-- NULL significa "hereda del área" (o de la config global), así que las
-- filas existentes siguen comportándose exactamente igual.
-- ============================================================

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS jornada_inicio TIME,
  ADD COLUMN IF NOT EXISTS jornada_fin TIME,
  ADD COLUMN IF NOT EXISTS sabado_trabaja BOOLEAN,
  ADD COLUMN IF NOT EXISTS sabado_inicio TIME,
  ADD COLUMN IF NOT EXISTS sabado_fin TIME,
  ADD COLUMN IF NOT EXISTS sabado_minutos_comida INT NOT NULL DEFAULT 0
    CHECK (sabado_minutos_comida >= 0);

COMMENT ON COLUMN usuarios.jornada_inicio IS
  'Hora de inicio de lunes a viernes. NULL = hereda el horario del área.';
COMMENT ON COLUMN usuarios.jornada_fin IS
  'Hora de fin de lunes a viernes. NULL = hereda el horario del área.';
COMMENT ON COLUMN usuarios.sabado_trabaja IS
  'NULL = hereda la config del área; true = trabaja los sábados; false = descanso.';
COMMENT ON COLUMN usuarios.sabado_inicio IS
  'Hora de inicio del sábado. NULL = hereda la config del área.';
COMMENT ON COLUMN usuarios.sabado_fin IS
  'Hora de fin del sábado. NULL = hereda la config del área.';
COMMENT ON COLUMN usuarios.sabado_minutos_comida IS
  'Minutos de receso el sábado. 0 = sin receso (regla por defecto del sistema).';
