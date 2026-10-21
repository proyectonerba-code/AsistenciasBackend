-- ============================================================
-- Control de Asistencia — Migración 0002: funciones de negocio
--
-- REGLA DE ORO: una marca se inserta de forma atómica y el tipo
-- (ENTRADA / SALIDA) se decide dentro de la misma transacción,
-- tomando un bloqueo por usuario para que dos checadas simultáneas
-- del mismo teléfono no se cuelen.
--
-- Decisión del tipo:
--   · sin marcas previas              -> ENTRADA
--   · última marca HOY, nº impar       -> SALIDA (la última fue ENTRADA)
--   · última marca HOY, nº par         -> ENTRADA (la última fue SALIDA)
--   · última marca de OTRO DÍA         -> ENTRADA (NUNCA se cierra
--                                          automáticamente una entrada
--                                          de otro día)
-- ============================================================

CREATE OR REPLACE FUNCTION registrar_marca(
  p_usuario_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_accuracy DOUBLE PRECISION,
  p_distancia_m DOUBLE PRECISION,
  p_sede_id UUID,
  p_origen TEXT,
  p_ip TEXT,
  p_user_agent TEXT
) RETURNS TABLE (
  tipo TEXT,
  hora TEXT,
  ts TIMESTAMPTZ,
  entrada_abierta_otro_dia BOOLEAN
) AS $$
DECLARE
  v_tipo TEXT;
  v_ts TIMESTAMPTZ;
  v_hora TEXT;
  v_count_hoy INT := 0;
  v_ultimo_ts TIMESTAMPTZ;
  v_ultimo_dia DATE;
  v_hoy DATE;
  v_abierta_otro_dia BOOLEAN := false;
BEGIN
  SET LOCAL timezone = 'America/Mexico_City';

  -- Bloqueo exclusivo por usuario durante la transacción.
  PERFORM pg_advisory_xact_lock(
    ('x' || substring(p_usuario_id::text from 1 for 8))::bit(32)::int
  );

  v_hoy := (now() AT TIME ZONE 'America/Mexico_City')::date;

  SELECT count(*) INTO v_count_hoy
  FROM marcas
  WHERE usuario_id = p_usuario_id
    AND (ts AT TIME ZONE 'America/Mexico_City')::date = v_hoy;

  SELECT max(ts) INTO v_ultimo_ts
  FROM marcas
  WHERE usuario_id = p_usuario_id;

  IF v_ultimo_ts IS NULL THEN
    v_tipo := 'ENTRADA';
  ELSE
    v_ultimo_dia := (v_ultimo_ts AT TIME ZONE 'America/Mexico_City')::date;

    IF v_ultimo_dia = v_hoy THEN
      -- Número impar de marcas hoy -> la última fue una ENTRADA abierta.
      v_tipo := CASE WHEN v_count_hoy % 2 = 1 THEN 'SALIDA' ELSE 'ENTRADA' END;
    ELSE
      -- Quedó una entrada abierta de un día anterior: se abre una nueva
      -- entrada. El cierre de ese día lo hace el administrador.
      v_tipo := 'ENTRADA';
      v_abierta_otro_dia := true;
    END IF;
  END IF;

  v_ts := now();

  INSERT INTO marcas (
    usuario_id, ts, lat, lng, accuracy, distancia_m, sede_id, origen, ip, user_agent
  ) VALUES (
    p_usuario_id, v_ts, p_lat, p_lng, p_accuracy, p_distancia_m, p_sede_id, p_origen, p_ip, p_user_agent
  )
  RETURNING marcas.ts INTO v_ts;

  v_hora := to_char(v_ts AT TIME ZONE 'America/Mexico_City', 'HH24:MI');

  RETURN QUERY SELECT v_tipo, v_hora, v_ts, v_abierta_otro_dia;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION registrar_marca IS
  'Inserta una marca atómicamente con bloqueo por usuario. Tipo ENTRADA/SALIDA alternado por día; nunca cierra una entrada de otro día.';

-- ------------------------------------------------------------
-- Vista de conveniencia: estado del día por persona.
-- Replica la lógica del motor de horas sin duplicar datos.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_estado_dia AS
SELECT
  m.usuario_id,
  (m.ts AT TIME ZONE 'America/Mexico_City')::date AS fecha,
  count(*)::int AS marcas,
  min(m.ts) AS primera_marca,
  max(m.ts) AS ultima_marca,
  bool_or(m.origen = 'nfc') AS via_nfc,
  bool_or(m.origen = 'qr') AS via_qr
FROM marcas m
GROUP BY m.usuario_id, (m.ts AT TIME ZONE 'America/Mexico_City')::date;

COMMENT ON VIEW v_estado_dia IS
  'Resumen por persona y día local: cuántas marcas hay y la primera/última.';
