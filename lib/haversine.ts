/**
 * Distancia Haversine entre dos puntos (latitud, longitud) en metros.
 * Función pura, sin dependencias de BD ni red, testeable en Vitest.
 */
const RADIO_TIERRA_M = 6_371_000;

function aRadianes(grados: number): number {
  return (grados * Math.PI) / 180;
}

export function haversineMetros(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const phi1 = aRadianes(lat1);
  const phi2 = aRadianes(lat2);
  const deltaPhi = aRadianes(lat2 - lat1);
  const deltaLambda = aRadianes(lng2 - lng1);

  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return RADIO_TIERRA_M * c;
}
