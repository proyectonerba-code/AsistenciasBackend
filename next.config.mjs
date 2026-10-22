/**
 * Backend del Control de Asistencia (API + Supabase).
 *
 * El CORS se resuelve por ruta (ver lib/cors.ts) porque el origen puede
 * cambiar en cada vista previa de Netlify; las cabeceras estáticas de
 * next.config lo pisarían.
 */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
