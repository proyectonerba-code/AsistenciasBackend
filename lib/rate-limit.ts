/**
 * Rate limit simple en memoria: ventana deslizante de 1 minuto.
 * Máximo 10 intentos por clave (IP o token).
 *
 * Nota: en despliegues serverless distribuidos (Vercel Functions en varias
 * regiones/instancias) este mapa no se comparte. Para producción se recomienda
 * Upstash Redis o similar. Para 11 personas y una instancia, es suficiente.
 */
type Registro = { marcas: number[] };

const store = new Map<string, Registro>();
const LIMITE = 10;
const VENTANA_MS = 60 * 1000;

export function verificarRateLimit(clave: string): {
  permitido: boolean;
  restante: number;
} {
  const ahora = Date.now();
  let reg = store.get(clave);
  if (!reg) {
    reg = { marcas: [] };
    store.set(clave, reg);
  }

  reg.marcas = reg.marcas.filter((t) => ahora - t < VENTANA_MS);

  if (reg.marcas.length >= LIMITE) {
    return { permitido: false, restante: 0 };
  }

  reg.marcas.push(ahora);
  return { permitido: true, restante: LIMITE - reg.marcas.length };
}

export function limpiarRateLimit(): void {
  store.clear();
}
