-- ============================================================
-- Control de Asistencia — Migración 0001: esquema inicial
-- Next.js + Supabase + Postgres
-- Zona horaria fija: America/Mexico_City (timestamptz en UTC)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- config: parámetros del sistema (clave/valor JSONB)
-- ------------------------------------------------------------
CREATE TABLE config (
  clave TEXT PRIMARY KEY,
  valor JSONB NOT NULL,
  descripcion TEXT,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- usuarios — catálogo de trabajadores
--   token_hash    = SHA-256 del token secreto de la URL /c/<token>
--   token_prefijo = 4 primeros caracteres (solo auditoría)
--   etiqueta_nfc  = identificador VISIBLE de la tarjeta física
--   legajo        = número de empleado interno
-- ------------------------------------------------------------
CREATE TABLE usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  correo TEXT UNIQUE NOT NULL CHECK (correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  area TEXT NOT NULL DEFAULT 'Sin asignar'
    CHECK (area IN ('Oficina','Técnico','Sin asignar')),
  minutos_comida INT NOT NULL DEFAULT 60 CHECK (minutos_comida >= 0),
  legajo INT UNIQUE CHECK (legajo IS NULL OR legajo > 0),
  etiqueta_nfc TEXT UNIQUE,
  token_hash TEXT UNIQUE,
  token_prefijo TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usuarios_activo ON usuarios(activo);
CREATE INDEX idx_usuarios_area ON usuarios(area);

-- ------------------------------------------------------------
-- sedes (geocercas)
-- ------------------------------------------------------------
CREATE TABLE sedes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL CHECK (lat >= -90 AND lat <= 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng >= -180 AND lng <= 180),
  radio_m INT NOT NULL DEFAULT 100 CHECK (radio_m > 0),
  activa BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- marcas (fuente de verdad, INMUTABLES)
-- ------------------------------------------------------------
CREATE TABLE marcas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  distancia_m DOUBLE PRECISION,
  sede_id UUID REFERENCES sedes(id) ON DELETE SET NULL,
  origen TEXT NOT NULL CHECK (origen IN ('nfc','qr','manual')),
  ip TEXT,
  user_agent TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_marcas_usuario_ts ON marcas(usuario_id, ts);
CREATE INDEX idx_marcas_ts ON marcas(ts);

-- ------------------------------------------------------------
-- ajustes_manuales (correcciones, único por usuario+fecha)
-- ------------------------------------------------------------
CREATE TABLE ajustes_manuales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  entrada TIME,
  salida TIME,
  observaciones TEXT,
  creado_por TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, fecha)
);

CREATE INDEX idx_ajustes_fecha ON ajustes_manuales(fecha);

-- ------------------------------------------------------------
-- horarios_especiales (por usuario, día de semana, vigencia)
-- ------------------------------------------------------------
CREATE TABLE horarios_especiales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  dia_semana INT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  entrada TIME NOT NULL,
  salida TIME NOT NULL CHECK (entrada < salida),
  vigente_desde DATE NOT NULL,
  vigente_hasta DATE,
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_horarios_esp_usuario ON horarios_especiales(usuario_id, dia_semana);

-- ------------------------------------------------------------
-- faltas (idempotentes por usuario+fecha)
-- ------------------------------------------------------------
CREATE TABLE faltas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  motivo TEXT,
  justificada BOOLEAN NOT NULL DEFAULT false,
  creada_por TEXT NOT NULL,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, fecha)
);

-- ------------------------------------------------------------
-- rechazados (intentos de checada rechazados)
-- ------------------------------------------------------------
CREATE TABLE rechazados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  token_prefijo TEXT,
  motivo TEXT NOT NULL CHECK (
    motivo IN (
      'token invalido',
      'usuario inactivo',
      'hora no permitida',
      'fuera de zona',
      'precision insuficiente',
      'sin ubicacion',
      'doble registro',
      'marca adicional'
    )
  ),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  distancia_m DOUBLE PRECISION,
  detalle TEXT
);

CREATE INDEX idx_rechazados_ts ON rechazados(ts DESC);
CREATE INDEX idx_rechazados_motivo ON rechazados(motivo);
CREATE INDEX idx_rechazados_usuario ON rechazados(usuario_id);

-- ------------------------------------------------------------
-- bitacora (toda edición del panel)
-- ------------------------------------------------------------
CREATE TABLE bitacora (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL,
  accion TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id UUID,
  antes JSONB,
  despues JSONB
);

CREATE INDEX idx_bitacora_ts ON bitacora(ts DESC);
CREATE INDEX idx_bitacora_entidad ON bitacora(entidad, entidad_id);

-- ------------------------------------------------------------
-- admins (acceso al panel /admin)
-- ------------------------------------------------------------
CREATE TABLE admins (
  correo TEXT PRIMARY KEY CHECK (correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  rol TEXT NOT NULL CHECK (rol IN ('admin','supervisor')),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- RLS activado en TODAS las tablas. Sin políticas públicas.
-- Solo el service role del servidor lee/escribe.
-- ------------------------------------------------------------
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE sedes ENABLE ROW LEVEL SECURITY;
ALTER TABLE marcas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ajustes_manuales ENABLE ROW LEVEL SECURITY;
ALTER TABLE horarios_especiales ENABLE ROW LEVEL SECURITY;
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
ALTER TABLE faltas ENABLE ROW LEVEL SECURITY;
ALTER TABLE rechazados ENABLE ROW LEVEL SECURITY;
ALTER TABLE bitacora ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_all_usuarios ON usuarios FOR ALL USING (false);
CREATE POLICY deny_all_sedes ON sedes FOR ALL USING (false);
CREATE POLICY deny_all_marcas ON marcas FOR ALL USING (false);
CREATE POLICY deny_all_ajustes_manuales ON ajustes_manuales FOR ALL USING (false);
CREATE POLICY deny_all_horarios_especiales ON horarios_especiales FOR ALL USING (false);
CREATE POLICY deny_all_config ON config FOR ALL USING (false);
CREATE POLICY deny_all_faltas ON faltas FOR ALL USING (false);
CREATE POLICY deny_all_rechazados ON rechazados FOR ALL USING (false);
CREATE POLICY deny_all_bitacora ON bitacora FOR ALL USING (false);
CREATE POLICY deny_all_admins ON admins FOR ALL USING (false);

COMMENT ON TABLE usuarios IS
  'Catálogo de trabajadores. token_hash guarda SHA-256 del token secreto (24 chars). etiqueta_nfc es el ID visible de la tarjeta.';
COMMENT ON TABLE marcas IS
  'Fuente de verdad de asistencia. Inmutables: las correcciones van en ajustes_manuales.';
COMMENT ON TABLE rechazados IS
  'Auditoría de checadas rechazadas. Guarda coordenadas aunque sea rechazo.';
COMMENT ON TABLE bitacora IS
  'Bitácora de cambios del panel (usuarios, ajustes, horarios, faltas, sedes, config, tokens).';
