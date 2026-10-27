/**
 * POST /api/dispositivo/registrar
 * Registra una solicitud de alta con el NIP general. El admin asigna el
 * dispositivo a la persona desde el panel; aquí nunca se elige un trabajador.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sha256Hex } from '@/lib/crypto';
import { supabaseAdmin } from '@/lib/supabase/server';
import { cabecerasCors } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'El NIP debe tener cuatro dígitos.'),
  huella: z.string().uuid('Identificador del celular inválido.'),
  etiqueta: z.string().trim().max(120).optional().default(''),
  agente: z.string().trim().max(500).optional().default(''),
});

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cabecerasCors(request.headers.get('origin')) });
}

export async function POST(request: NextRequest) {
  const headers = cabecerasCors(request.headers.get('origin'));
  let raw: unknown;
  try { raw = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Solicitud inválida.' }, { status: 400, headers });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400, headers });

  const pepper = process.env.PIN_PEPPER;
  if (!pepper) return NextResponse.json({ ok: false, error: 'El enrolamiento todavía no está configurado.' }, { status: 503, headers });

  const ip = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'desconocida';
  const ipHash = await sha256Hex(`${process.env.RATE_LIMIT_PEPPER ?? pepper}:${ip}`);
  const haceQuince = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count, error: rateError } = await supabaseAdmin.from('intentos_enrolamiento')
    .select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('creado_en', haceQuince);
  if (rateError) return NextResponse.json({ ok: false, error: 'No se pudo validar el intento.' }, { status: 503, headers });
  if ((count ?? 0) >= 8) return NextResponse.json({ ok: false, error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' }, { status: 429, headers });
  const { error: attemptError } = await supabaseAdmin.from('intentos_enrolamiento').insert({ ip_hash: ipHash });
  if (attemptError) return NextResponse.json({ ok: false, error: 'No se pudo registrar el intento.' }, { status: 503, headers });

  const { data: config, error: configError } = await supabaseAdmin.from('config')
    .select('valor').eq('clave', 'pin_enrolamiento_hash').maybeSingle();
  if (configError) return NextResponse.json({ ok: false, error: 'No se pudo validar el NIP.' }, { status: 503, headers });
  const expectedHash = typeof config?.valor === 'string' ? config.valor : '';
  const providedHash = await sha256Hex(`${pepper}:${parsed.data.pin}`);
  if (!expectedHash || expectedHash !== providedHash) return NextResponse.json({ ok: false, error: 'NIP incorrecto.' }, { status: 401, headers });

  const now = new Date().toISOString();
  const { data: device, error } = await supabaseAdmin.from('dispositivos').insert({
    usuario_id: null,
    huella: parsed.data.huella,
    etiqueta: parsed.data.etiqueta || null,
    agente: parsed.data.agente || request.headers.get('user-agent')?.slice(0, 500) || null,
    primera_marca: now,
    ultima_marca: now,
    veces: 0,
    activo: false,
    estado: 'pendiente',
  }).select('id, estado, creado_en:primera_marca').single();

  if (error || !device) {
    if (error?.code === '23505') return NextResponse.json({ ok: false, error: 'Este celular ya solicitó el alta. Espera la asignación del administrador.' }, { status: 409, headers });
    return NextResponse.json({ ok: false, error: 'No se pudo registrar el celular.' }, { status: 500, headers });
  }

  return NextResponse.json({ ok: true, dispositivoId: device.id, estado: device.estado, mensaje: 'El celular quedó pendiente de asignación.' }, { status: 201, headers });
}
