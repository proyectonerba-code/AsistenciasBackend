-- ============================================================
-- Control de Asistencia — Migración 0005: dispositivos
--
-- Cada celular/tablet queda amarrado a la persona que se identificó
-- desde él. Sirve para:
--   · No volver a pedir la identidad en cada checada.
--   · Analizar en el admin qué dispositivo usa cada colaborador.
--   · Poder revocar el acceso si alguien pierde o cambia de teléfono.
-- ============================================================

CREATE TABLE IF NOT EXISTS dispositivos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  huella TEXT NOT NULL,          -- identificador del dispositivo (UUID del navegador)
  etiqueta TEXT,                 -- nombre legible ("iPhone de Jesús")
  agente TEXT,                   -- user agent (informativo)
  primera_marca TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultima_marca TIMESTAMPTZ NOT NULL DEFAULT now(),
  veces INT NOT NULL DEFAULT 1,
  activo BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (usuario_id, huella)
);

CREATE INDEX IF NOT EXISTS idx_dispositivos_usuario ON dispositivos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_dispositivos_ultima ON dispositivos(ultima_marca DESC);

-- Cada marca apunta al dispositivo desde el que se hizo.
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS dispositivo_id UUID
  REFERENCES dispositivos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_marcas_dispositivo ON marcas(dispositivo_id);

-- RLS: solo el service role del backend.
ALTER TABLE dispositivos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dispositivos' AND policyname = 'deny_all_dispositivos'
  ) THEN
    CREATE POLICY deny_all_dispositivos ON dispositivos FOR ALL USING (false);
  END IF;
END;
$$;

COMMENT ON TABLE dispositivos IS
  'Dispositivos (celulares/tablets) asignados a un colaborador. Permite checar sin reidentificarse y auditar desde el panel.';

-- ------------------------------------------------------------
-- registrar_marca: ahora recibe el dispositivo y devuelve su id
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS registrar_marca(
  uuid, double precision, double precision, double precision,
  double precision, uuid, text, text, text
);

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

  -- Bloqueo exclusivo por usuario durante la transacción.
  PERFORM pg_advisory_xact_lock(
    ('x' || substring(p_usuario_id::text from 1 for 8))::bit(32)::int
  );

  v_hoy := (now() AT TIME ZONE 'America/Mexico_City')::date;

  -- OJO: el parámetro de salida se llama "ts" y la tabla marcas también tiene
  -- una columna "ts". Por eso todas las referencias a la columna van
  -- cualificadas como marcas.ts; si no, Postgres las marca como ambiguas.
  SELECT count(*) INTO v_count_hoy
  FROM marcas
  WHERE marcas.usuario_id = p_usuario_id
    AND (marcas.ts AT TIME ZONE 'America/Mexico_City')::date = v_hoy;

  SELECT max(marcas.ts) INTO v_ultimo_ts
  FROM marcas
  WHERE marcas.usuario_id = p_usuario_id;

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

  -- ------------------------------------------------------------
  -- Dispositivo: alta o refresco del vínculo
  -- ------------------------------------------------------------
  IF p_huella IS NOT NULL AND p_huella <> '' THEN
    INSERT INTO dispositivos (
      usuario_id, huella, etiqueta, agente, primera_marca, ultima_marca, veces
    ) VALUES (
      p_usuario_id, p_huella, p_agente, p_user_agent, now(), now(), 1
    )
    ON CONFLICT (usuario_id, huella) DO UPDATE
      SET ultima_marca = now(),
          veces = dispositivos.veces + 1,
          etiqueta = COALESCE(dispositivos.etiqueta, EXCLUDED.etiqueta),
          agente = COALESCE(dispositivos.agente, EXCLUDED.agente)
    RETURNING dispositivos.id INTO v_dispositivo_id;
  END IF;

  v_ts := now();

  INSERT INTO marcas (
    usuario_id, ts, lat, lng, accuracy, distancia_m, sede_id, origen,
    ip, user_agent, dispositivo_id
  ) VALUES (
    p_usuario_id, v_ts, p_lat, p_lng, p_accuracy, p_distancia_m, p_sede_id,
    p_origen, p_ip, p_user_agent, v_dispositivo_id
  )
  RETURNING marcas.ts INTO v_ts;

  v_hora := to_char(v_ts AT TIME ZONE 'America/Mexico_City', 'HH24:MI');

  RETURN QUERY SELECT v_tipo, v_hora, v_ts, v_abierta_otro_dia, v_dispositivo_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION registrar_marca IS
  'Inserta una marca atómicamente con bloqueo por usuario. Tipo ENTRADA/SALIDA alternado por día; nunca cierra una entrada de otro día. Registra/actualiza el dispositivo.';
