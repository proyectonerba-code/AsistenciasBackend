-- ============================================================
-- Control de Asistencia — Migración 0003: datos iniciales
--
-- Los tokens de ejemplo son SOLO para la instalación inicial.
-- El panel de administración permite regenerarlos (rota el token_hash).
-- ============================================================

-- ------------------------------------------------------------
-- Sedes (geocercas). Ajusta coordenadas y radio a tu oficina real.
-- El WHERE NOT EXISTS lo hace idempotente: se puede re-aplicar sin duplicar.
--
-- Oficina Central: 20°04'22.5"N 98°23'07.0"W  ->  20.0729167, -98.3852778
-- ------------------------------------------------------------
INSERT INTO sedes (nombre, lat, lng, radio_m, activa)
SELECT 'Oficina Central', 20.0729167, -98.3852778, 150, true
WHERE NOT EXISTS (
  SELECT 1 FROM sedes WHERE nombre = 'Oficina Central'
);

-- ------------------------------------------------------------
-- Configuración del sistema
-- ------------------------------------------------------------
INSERT INTO config (clave, valor, descripcion) VALUES
  ('horarios_por_area', '{"Oficina":{"inicio":"09:00","fin":"19:00"},"Técnico":{"inicio":"09:00","fin":"20:00"},"Sin asignar":{"inicio":"09:00","fin":"19:00"}}'::jsonb,
   'Horario de referencia por área. Se usa cuando no hay horario especial ni sábado.'),
  ('horario_sabado', '{"inicio":"09:00","fin":"15:00"}'::jsonb,
   'Horario general de sábados (sin descuento de comida).'),
  ('minutos_comida_default', '60'::jsonb, 'Minutos de comida por defecto por usuario.'),
  ('minutos_minimos_para_comida', '300'::jsonb, 'Jornada bruta mínima para descontar comida (no aplica sábado).'),
  ('minutos_entre_marcas', '5'::jsonb, 'Minutos mínimos entre marcas para considerar salida (anti doble registro).'),
  ('hora_min_registro', '"06:00"'::jsonb, 'Hora mínima permitida para registrar (zona México).'),
  ('hora_max_registro', '"23:30"'::jsonb, 'Hora máxima permitida para registrar (zona México).'),
  ('trasladar_extra_sabado', 'true'::jsonb, '¿Las horas extra del sábado se suman a la semana siguiente?'),
  ('radio_geocerca_default_m', '100'::jsonb, 'Radio default de geocerca en metros.'),
  ('precision_max_m', '50'::jsonb, 'Precisión máxima del GPS aceptada (metros).')
ON CONFLICT (clave) DO NOTHING;

-- ------------------------------------------------------------
-- Usuarios (catálogo inicial)
--   legajo       = número de empleado
--   etiqueta_nfc = identificador visible de la tarjeta física
--   token_hash   = SHA-256 del token secreto de la URL /c/<token>
--   token_prefijo= primeros 4 caracteres (solo auditoría)
-- ------------------------------------------------------------
INSERT INTO usuarios
  (nombre, correo, area, minutos_comida, legajo, etiqueta_nfc, token_hash, token_prefijo, activo)
VALUES
  ('Jesus Guadarrama', 'jesus.guadarrama@gmail.com', 'Oficina', 60, 1042, 'NFC-1000-A', '616293469fe4542bc4030d1a7fb967a501a02876a3ffd3ff377b528323486f04', 'BRZA', true),
  ('Blanca Lopez Castro', 'blanca.lopez@gmail.com', 'Oficina', 60, 874, 'NFC-1137-B', '3d77cc3af1e5d8407af6686998be17f919c126ff7658b434d1f43415fe34ef39', '5AGQ', true),
  ('Luna Munoz Gonzaga', 'luna.munoz@gmail.com', 'Oficina', 60, 1209, 'NFC-1274-C', '3ee35d9c42d2bb5bcdce781f6ac08d95f3c349f596e384da52d8e4c1b7554204', 'FN7S', true),
  ('Ana Karen Islas Murcia', 'ana.islas@gmail.com', 'Oficina', 60, 541, 'NFC-1411-D', 'a901be4d126fd69b00feddbcfc71fdcfc1d63ca8b1a697246a402c3df9028824', 'JFJT', true),
  ('Mario Ivan Suarez Garcia ESTADIAS', 'mario.jsna@gmail.com', 'Oficina', 60, 1423, 'NFC-1548-E', 'ac5c83632208c63dfbcbf2216601032f5ad67109361a4995cf706888407e59ab', 'L8MT', true),
  ('Juan Pablo Talamantez Robles ESTADIAS', 'juanpablo.talamantez@gmail.com', 'Oficina', 60, 392, 'NFC-1685-F', '01953129ef290b135eaf834b3884138e83d2a15b1bdc3e2d9c837c2e4c67edd9', '7A8Y', true),
  ('Antonio Perez Tapia', 'antonio.perez@gmail.com', 'Técnico', 60, 2107, 'NFC-1822-G', 'e67a233f447ba6eadee159d96e729b72d4d14a076c120c6b22a430c09c3c346d', 'GJC2', true),
  ('Juan Carlos Hernandez Rocha', 'juancarlos.hernandez@gmail.com', 'Técnico', 60, 3311, 'NFC-1959-H', 'fa0bfebd92b8d7f07706390aabb8bc62dbf33c1b982eb53c7ec019b917ff670a', 'S2FG', true),
  ('Jesus Escobar Neri', 'jesus.escobar@gmail.com', 'Técnico', 60, 4860, 'NFC-2096-I', '7f0b2fd1eef6395f38f2a2c5ccd43e4241e0315e1977338e3694b0040c650c2f', 'ZUV2', true),
  ('Jose Carlos Trejo Hernandez', 'josecarlos.trejo@gmail.com', 'Técnico', 60, 5572, 'NFC-2233-J', 'c142ccaa635af0467047fedca35f86075f16dc59f3764de726662ccf1d3d5c01', 'M3QT', true),
  ('Juan Pablo Amador', 'juanpablo.amador@gmail.com', 'Técnico', 60, 6688, 'NFC-2370-K', '8113333b7bcb7765e13ae43c855a5b16b27fe3ff33e9ad0576f8f9c64c753aed', 'N7HL', true)
ON CONFLICT (correo) DO NOTHING;

-- ------------------------------------------------------------
-- Horario especial de Blanca: 08:30 - 19:00 de lunes a viernes.
-- Ejemplo de "horarios especiales por persona y día".
-- El WHERE NOT EXISTS lo hace idempotente: se puede re-aplicar sin duplicar.
-- ------------------------------------------------------------
INSERT INTO horarios_especiales
  (usuario_id, dia_semana, entrada, salida, vigente_desde, vigente_hasta, activo)
SELECT u.id, d.dia, '08:30'::time, '19:00'::time, DATE '2024-01-01', NULL, true
FROM usuarios u
CROSS JOIN (VALUES (1),(2),(3),(4),(5)) AS d(dia)
WHERE u.correo = 'blanca.lopez@gmail.com'
  AND NOT EXISTS (
    SELECT 1
    FROM horarios_especiales h
    WHERE h.usuario_id = u.id
      AND h.dia_semana = d.dia
      AND h.entrada = '08:30'::time
      AND h.salida = '19:00'::time
  );

-- ------------------------------------------------------------
-- Administradores del panel.
-- Crea también la cuenta en Supabase Auth (email + contraseña).
-- ------------------------------------------------------------
INSERT INTO admins (correo, rol) VALUES
  ('marionly420@gmail.com', 'admin')
ON CONFLICT (correo) DO NOTHING;
