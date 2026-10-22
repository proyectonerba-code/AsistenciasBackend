# Guía de despliegue · Control de Asistencia NerWork

Tres aplicaciones, tres repositorios. Para probarlas en internet:

| App | Repo | Dónde |
|---|---|---|
| **Backend** (API) | `AsistenciasBackend` | Vercel (recomendado) |
| **Vista de registro** (NFC/QR) | `AsistenciasVistaRegistro` | Netlify o Vercel |
| **Panel de administración** | `AsistenciasVistaAdministrador` | Netlify o Vercel |

> ⚠️ **El backend va primero.** Las vistas necesitan su URL para poder
> registrar checadas. Despliégalo, toma su URL y luego despliega las vistas.

---

## 1. Backend → Vercel

```bash
cd AsistenciasBackend
npx vercel --prod
```

Variables de entorno (en Vercel: *Settings → Environment Variables*):

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | `https://mkpknuszfxivtfqdexii.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | la llave `service_role` de tu proyecto |
| `SUPABASE_DEMO` | `0` |
| `SESSION_SECRET` | una cadena larga y aleatoria (para firmar las sesiones) |
| `ALLOWED_ORIGIN` | ver más abajo |
| `ADMIN_ALERT_EMAIL` | `marionly420@gmail.com` |
| `EMAIL_PROVIDER` | `console` (o `resend` si quieres correos reales) |

### `ALLOWED_ORIGIN` acepta varios orígenes

Sepáralos por coma. Admite comodines de dominio, útiles porque **Netlify
genera una URL distinta en cada vista previa**:

```
https://registro.nerwork.mx,https://*.netlify.app,http://localhost:3000
```

---

## 2. Vista de registro → Netlify

```bash
cd AsistenciasVistaRegistro
npx netlify init      # o "Add new site" desde la web
npx netlify deploy --prod
```

Variables (en Netlify: *Site settings → Environment variables*):

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://tu-backend.vercel.app` |
| `NEXT_PUBLIC_REGISTRO_URL` | `https://tu-registro.netlify.app` |

> 🔴 **`NEXT_PUBLIC_*` se incrustan en el BUILD.** Si las defines después del
> primer despliegue, tienes que volver a desplegar para que el cambio aplique.

---

## 3. Panel de administración → Netlify

```bash
cd AsistenciasVistaAdministrador
npx netlify init
npx netlify deploy --prod
```

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://mkpknuszfxivtfqdexii.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la llave `anon` de tu proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | la llave `service_role` |
| `SUPABASE_DEMO` | `0` |
| `SESSION_SECRET` | cadena larga y aleatoria |
| `NEXT_PUBLIC_REGISTRO_URL` | `https://tu-registro.netlify.app` |

Entra con `marionly420@gmail.com` y la clave que se generó
(`NerWork-44cf13ae7955` si no la cambiaste).

---

## 4. Lista de verificación después de desplegar

- [ ] La terminal abre en `https://tu-registro.netlify.app` y muestra el lector NFC.
- [ ] Escanear la etiqueta NFC/QR (o abrir `/c/<token>`) pide la ubicación.
- [ ] **Si niegas el permiso de ubicación, no debe registrar nada** (queda en Rechazados).
- [ ] La marca aparece en el panel, en *Registros del Día*.
- [ ] El panel muestra la hora calculada y las horas trabajadas correctas.
- [ ] *Pendientes* muestra la entrada abierta hasta que registres la salida.
- [ ] *Dispositivos* muestra el celular usado en la terminal.

---

## 5. Antes de usarlo en serio

1. **Rota los tokens de ejemplo.** Los del seed son públicos (están en el
   README del backend). Panel → *Empleados → Regenerar token*.
2. **Revoca el Personal Access Token** que usaste para las migraciones
   (Supabase → *Account → Tokens*).
3. **Revisa las coordenadas de la sede** (ya está en `20.0729167, -98.3852778`,
   radio 150 m). Se cambian en Supabase → tabla `sedes`, o en el panel.
4. **Ajusta el radio** si la señal del GPS en la oficina es mala: 150 m puede
   ser justo; 200-250 m da más tolerancia.
5. **Crea las etiquetas NFC** con la URL `/c` (terminal compartida) o
   `/c/<token>` (credencial personal por persona).

---

## Problemas frecuentes

**"Acceso a fetch bloqueado por CORS"**
→ `ALLOWED_ORIGIN` del backend no incluye el dominio del front. Verifica que
incluya `https://` y que coincida exactamente (con o sin `www`).

**La checada no registra nada y no aparece en Rechazados**
→ El navegador exige **HTTPS** para la geolocalización. Netlify y Vercel lo
dan; `http://` solo funciona en `localhost`.

**El panel entra en loop de login**
→ `NEXT_PUBLIC_SUPABASE_ANON_KEY` incorrecta o el dominio del panel no está
agregado en Supabase → *Authentication → URL Configuration → Site URL*.

**Las variables NEXT_PUBLIC_* no cambian**
→ Se incrustan en el build. Vuelve a desplegar después de definirlas.

**Sale "Application error" en una página del panel**
→ Falta `SUPABASE_SERVICE_ROLE_KEY` en el servidor del panel.
