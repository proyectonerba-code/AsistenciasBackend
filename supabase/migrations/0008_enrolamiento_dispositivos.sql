-- Enrolamiento con NIP general y asignación administrativa posterior.
-- Conserva marcas, rechazos y vínculos existentes.

ALTER TABLE dispositivos ALTER COLUMN usuario_id DROP NOT NULL;
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'activo';

UPDATE dispositivos
SET estado = CASE WHEN activo THEN 'activo' ELSE 'revocado' END;

-- Una huella representa un navegador. Si versiones previas dejaron la misma
-- huella ligada a varias personas, conserva el vínculo más reciente y mantiene
-- los demás registros históricos con identificadores legacy únicos.
WITH duplicadas AS (
  SELECT id, row_number() OVER (
    PARTITION BY huella
    ORDER BY activo DESC, ultima_marca DESC, primera_marca DESC, id
  ) AS orden
  FROM dispositivos
)
UPDATE dispositivos d
SET huella = 'legacy-' || substr(md5(d.id::text), 1, 16),
    activo = false,
    estado = 'revocado'
FROM duplicadas x
WHERE x.id = d.id AND x.orden > 1;

-- Un trabajador puede conservar todo el historial de dispositivos, pero solo
-- uno activo. Los anteriores quedan revocados, sin borrar sus marcas.
WITH activos AS (
  SELECT id, row_number() OVER (
    PARTITION BY usuario_id
    ORDER BY ultima_marca DESC, primera_marca DESC, id
  ) AS orden
  FROM dispositivos
  WHERE usuario_id IS NOT NULL AND activo
)
UPDATE dispositivos d
SET activo = false, estado = 'revocado'
FROM activos x
WHERE x.id = d.id AND x.orden > 1;

ALTER TABLE dispositivos DROP CONSTRAINT IF EXISTS dispositivos_usuario_id_huella_key;
CREATE UNIQUE INDEX IF NOT EXISTS dispositivos_huella_unica ON dispositivos(huella);
CREATE UNIQUE INDEX IF NOT EXISTS dispositivos_un_activo_por_usuario
  ON dispositivos(usuario_id) WHERE usuario_id IS NOT NULL AND activo;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispositivos_estado_check'
  ) THEN
    ALTER TABLE dispositivos ADD CONSTRAINT dispositivos_estado_check
      CHECK (estado IN ('pendiente', 'activo', 'revocado'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS intentos_enrolamiento (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intentos_enrolamiento_ip_fecha
  ON intentos_enrolamiento(ip_hash, creado_en DESC);
ALTER TABLE intentos_enrolamiento ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'intentos_enrolamiento'
      AND policyname = 'deny_all_intentos_enrolamiento'
  ) THEN
    CREATE POLICY deny_all_intentos_enrolamiento
      ON intentos_enrolamiento FOR ALL USING (false);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION asignar_dispositivo(
  p_dispositivo_id UUID,
  p_usuario_id UUID
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_usuario_activo BOOLEAN;
  v_estado TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_usuario_id::text, 0));

  SELECT activo INTO v_usuario_activo
  FROM usuarios WHERE id = p_usuario_id FOR UPDATE;
  IF NOT FOUND OR NOT v_usuario_activo THEN
    RAISE EXCEPTION 'usuario_inactivo';
  END IF;

  SELECT estado INTO v_estado
  FROM dispositivos WHERE id = p_dispositivo_id FOR UPDATE;
  IF NOT FOUND OR v_estado <> 'pendiente' THEN
    RAISE EXCEPTION 'dispositivo_no_pendiente';
  END IF;

  UPDATE dispositivos
  SET activo = false, estado = 'revocado'
  WHERE usuario_id = p_usuario_id AND activo AND id <> p_dispositivo_id;

  UPDATE dispositivos
  SET usuario_id = p_usuario_id,
      activo = true,
      estado = 'activo'
  WHERE id = p_dispositivo_id AND estado = 'pendiente'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN RAISE EXCEPTION 'dispositivo_no_pendiente'; END IF;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION asignar_dispositivo(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION asignar_dispositivo(UUID, UUID) TO service_role;

-- La función de marca reutiliza el dispositivo ya asignado. No puede vincular
-- ni cambiar la identidad del celular desde una solicitud pública.
CREATE OR REPLACE FUNCTION registrar_marca(
  p_usuario_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_accuracy DOUBLE PRECISION,
  p_distancia_m DOUBLE PRECISION,
  p_sede_id UUID,
  p_origen TEXT,
  p_ip TEXT,
  p_user_agent TEXT,
  p_huella TEXT DEFAULT NULL,
  p_agente TEXT DEFAULT NULL
) RETURNS TABLE (
  tipo TEXT,
  hora TEXT,
  ts TIMESTAMPTZ,
  entrada_abierta_otro_dia BOOLEAN,
  dispositivo_id UUID
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
  v_dispositivo_id UUID;
BEGIN
  SET LOCAL timezone = 'America/Mexico_City';
  PERFORM pg_advisory_xact_lock(('x' || substring(p_usuario_id::text from 1 for 8))::bit(32)::int);
  v_hoy := (now() AT TIME ZONE 'America/Mexico_City')::date;

  SELECT count(*) INTO v_count_hoy
  FROM marcas m
  WHERE m.usuario_id = p_usuario_id
    AND (m.ts AT TIME ZONE 'America/Mexico_City')::date = v_hoy;
  SELECT max(m.ts) INTO v_ultimo_ts FROM marcas m WHERE m.usuario_id = p_usuario_id;

  IF v_ultimo_ts IS NULL THEN
    v_tipo := 'ENTRADA';
  ELSE
    v_ultimo_dia := (v_ultimo_ts AT TIME ZONE 'America/Mexico_City')::date;
    IF v_ultimo_dia = v_hoy THEN
      v_tipo := CASE WHEN v_count_hoy % 2 = 1 THEN 'SALIDA' ELSE 'ENTRADA' END;
    ELSE
      v_tipo := 'ENTRADA';
      v_abierta_otro_dia := true;
    END IF;
  END IF;

  IF p_huella IS NOT NULL AND p_huella <> '' THEN
    INSERT INTO dispositivos(usuario_id, huella, etiqueta, agente, primera_marca, ultima_marca, veces, activo, estado)
    VALUES (p_usuario_id, p_huella, p_agente, p_user_agent, now(), now(), 1, true, 'activo')
    ON CONFLICT (huella) DO UPDATE
      SET ultima_marca = now(),
          veces = dispositivos.veces + 1,
          etiqueta = COALESCE(dispositivos.etiqueta, EXCLUDED.etiqueta),
          agente = COALESCE(dispositivos.agente, EXCLUDED.agente)
      WHERE dispositivos.usuario_id = EXCLUDED.usuario_id
        AND dispositivos.activo
        AND dispositivos.estado = 'activo'
    RETURNING id INTO v_dispositivo_id;
    IF v_dispositivo_id IS NULL THEN RAISE EXCEPTION 'dispositivo_no_autorizado'; END IF;
  END IF;

  v_ts := now();
  INSERT INTO marcas(usuario_id, ts, lat, lng, accuracy, distancia_m, sede_id, origen, ip, user_agent, dispositivo_id)
  VALUES (p_usuario_id, v_ts, p_lat, p_lng, p_accuracy, p_distancia_m, p_sede_id, p_origen, p_ip, p_user_agent, v_dispositivo_id)
  RETURNING marcas.ts INTO v_ts;
  v_hora := to_char(v_ts AT TIME ZONE 'America/Mexico_City', 'HH24:MI');
  RETURN QUERY SELECT v_tipo, v_hora, v_ts, v_abierta_otro_dia, v_dispositivo_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN dispositivos.estado IS 'Pendiente de asignación administrativa, activo o revocado.';
COMMENT ON TABLE intentos_enrolamiento IS 'Rate limit persistente para el NIP compartido de alta de celulares.';
