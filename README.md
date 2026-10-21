# Asistencias · Backend

API del **Control de Asistencia NerWork**. Recibe las checadas (NFC / QR), valida
**ubicación, horario y geocerca**, y guarda la marca de forma atómica en Supabase.

Este repositorio es la **fuente de verdad**: las marcas son inmutables y todo lo
demás (Asistencia, Reportes, Pendientes, Fichas) se **calcula** a partir de ellas.

---

## Reglas del sistema

| Regla | Detalle |
|---|---|
| **La ubicación es obligatoria** | Si la página no entrega coordenadas, **no se registra nada**. Queda auditado en `rechazados` con motivo `sin ubicacion`. |
| Geocerca | Distancia Haversine contra la sede activa. Fuera del radio → `fuera de zona`. |
| Precisión GPS | Mayor a `precision_max_m` (50 m por defecto) → `precision insuficiente`. |
| Horario | Solo se registra entre `hora_min_registro` (06:00) y `hora_max_registro` (23:30), hora Ciudad de México. |
| Anti doble registro | Dos marcas con menos de `minutos_entre_marcas` (5 min) → `doble registro`. |
| Marca adicional | La 3.ª marca del día se conserva solo como incidencia, no cuenta como entrada ni salida. |
| Nunca se cruza un día | Si quedó una entrada abierta de un día anterior, la nueva marca es una **ENTRADA** nueva: el cierre lo hace una persona. |
| Zona horaria | Fija: `America/Mexico_City`. Las marcas se guardan en UTC (`timestamptz`). |
| Semana laboral | Lunes a sábado. El sábado **no** descuenta hora de comida. |
| Domingo | Es **incidencia**: no suma horas ni horas extra, pero el registro se conserva. |
| Comida | Se descuenta solo si la jornada bruta es ≥ 300 min. Es configurable por persona. |
| Extra del sábado | Se traslada a la semana siguiente (configurable). |

---

## Endpoint

### `POST /api/checar`

```jsonc
// Request
{ "token": "BRZADF6P5V95", "lat": 19.4326, "lng": -99.1332, "accuracy": 12 }

// Response OK
{
  "ok": true,
  "tipo": "ENTRADA",        // o "SALIDA"
  "hora": "09:14",
  "nombre": "Jesus Guadarrama",
  "sede": "Oficina Central",
  "distanciaM": 8,
  "aviso": null
}

// Response con rechazo
{
  "ok": false,
  "error": {
    "motivo": "fuera de zona",   // token invalido | usuario inactivo | hora no permitida
                                  // fuera de zona | precision insuficiente
                                  // sin ubicacion | doble registro | marca adicional
    "mensaje": "Fuera de zona de registro. Estás a 412 m de la sede más cercana.",
    "distanciaM": 412
  }
}
```

### `GET /api/checar/info?token=<token>`

Solo lectura. Devuelve el nombre, el área y la última marca del día. **Nunca registra nada.**

```json
{ "valido": true, "nombre": "Jesus Guadarrama", "area": "Oficina", "ultimaMarca": "09:14", "tipoUltimaMarca": "ENTRADA" }
```

---

## Puesta en marcha

### 1. Dependencias

```bash
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env.local
```

| Variable | Para qué sirve |
|---|---|
| `SUPABASE_URL` | URL del proyecto de Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Llave de service role (**solo servidor**). |
| `SUPABASE_DEMO` | `1` activa el modo demostración (Supabase simulado en memoria). |
| `ALLOWED_ORIGIN` | Origen permitido de la vista de registro (CORS). |
| `ADMIN_ALERT_EMAIL` | Destino de los avisos de rechazo. |
| `EMAIL_PROVIDER` | `console` (log) o `resend` (correo real). |
| `CRON_SECRET` | Secreto para las tareas programadas. |

### 3. Base de datos

**Opción A — automática (recomendada).** Genera un *Personal Access Token* en
<https://supabase.com/dashboard/account/tokens> con el alcance `exec_sql` y ejecuta:

```bash
$env:SUPABASE_ACCESS_TOKEN="sbp_..."      # tu token personal
$env:SUPABASE_PROJECT_REF="abcdexyz"     # lo que va en ....supabase.co
npm run migraciones
```

Aplica `0001_init.sql`, `0002_funciones.sql` y `0003_seed.sql` en orden, y al
final verifica que existan las 10 tablas, la función `registrar_marca()`, el RLS
y los datos iniciales.

```bash
npm run migraciones:verificar   # solo comprueba, no escribe
npm run migraciones:reset       # borra y vuelve a aplicar (pide confirmación)
```

**Opción B — manual.** Pega los tres archivos, en orden, en
*Supabase → SQL Editor → New query*:

```
supabase/migrations/0001_init.sql      -- tablas, índices, RLS
supabase/migrations/0002_funciones.sql -- registrar_marca() + vista v_estado_dia
supabase/migrations/0003_seed.sql      -- sedes, config, usuarios y admins iniciales
```

> Ajusta las coordenadas de `sedes` en `0003_seed.sql` a la dirección real de la oficina.
> Los tokens del seed son de ejemplo: roótalos desde *Empleados → Regenerar token*.

### 4. Desarrollo

```bash
npm run dev      # http://localhost:4000
npm run build
npm start
npm test         # 49 pruebas (motor de horas, zona horaria, haversine, checadas)
npm run lint     # tsc --noEmit
```

### Modo demostración

Con `SUPABASE_DEMO=1` no necesitas Supabase: se simula en memoria el catálogo de
11 personas y 6 semanas de historial. **Nunca actives esto en producción.**

Tokens de prueba (mismo seed):

| Correo | Token |
|---|---|
| jesus.guadarrama@gmail.com | `BRZADF6P5V95` |
| blanca.lopez@gmail.com | `5AGQHALC87MT` |
| antonio.perez@gmail.com | `GJC2NQECLGLQ` |

---

## Estructura

```
app/api/checar/          POST /api/checar
app/api/checar/info/     GET  /api/checar/info
lib/motor-horas.ts       Motor puro: día, semana, horas, extras
lib/tz.ts                Zona horaria fija America/Mexico_City
lib/haversine.ts         Distancia entre coordenadas
lib/crypto.ts            Tokens y etiquetas NFC
lib/cors.ts              CORS de la API pública
lib/rate-limit.ts        Límite de intentos por IP y por token
lib/demo/                Supabase simulado (modo demo)
server/checar.ts         Flujo de validación de una checada
server/validations.ts    Esquemas Zod
supabase/migrations/     Migraciones SQL
```

---

## Seguridad

- La **service role** solo se usa en el servidor; nunca se expone al navegador.
- RLS activado en **todas** las tablas con políticas `deny_all`: el único acceso
  es el service role del backend.
- El token es la credencial: 16 caracteres aleatorios, se guarda **hasheado**
  (SHA-256) y se puede rotar desde el panel de administración.
- Todas las entradas se validan con Zod; nunca se confía en el cliente.
- Las rechazas se auditan con coordenadas para poder revisar intentos.

---

## Despliegue (Vercel)

```bash
vercel --prod
```

Variables de entorno en el panel de Vercel: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGIN`, `ADMIN_ALERT_EMAIL`.
