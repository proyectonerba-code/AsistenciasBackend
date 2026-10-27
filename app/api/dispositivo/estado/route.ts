/** Consulta si un navegador está pendiente, activo o revocado. No registra marcas. */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/server';
import { cabecerasCors } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HuellaSchema = z.string().uuid();

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cabecerasCors(request.headers.get('origin')) });
}

export async function GET(request: NextRequest) {
  const headers = cabecerasCors(request.headers.get('origin'));
  const huella = request.nextUrl.searchParams.get('huella') ?? '';
  if (!HuellaSchema.safeParse(huella).success) return NextResponse.json({ registrado: false }, { status: 400, headers });

  const { data: device, error } = await supabaseAdmin.from('dispositivos')
    .select('id, usuario_id, estado, activo').eq('huella', huella).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: 'No se pudo consultar el celular.' }, { status: 503, headers });
  if (!device) return NextResponse.json({ registrado: false }, { headers });
  if (device.estado === 'activo' && device.usuario_id && device.activo) {
    const { data: worker } = await supabaseAdmin.from('usuarios').select('nombre, area, activo').eq('id', device.usuario_id).maybeSingle();
    if (!worker?.activo) return NextResponse.json({ registrado: true, estado: 'revocado' }, { headers });
    return NextResponse.json({ registrado: true, estado: 'activo', nombre: worker.nombre, area: worker.area }, { headers });
  }
  return NextResponse.json({ registrado: true, estado: device.estado ?? (device.activo ? 'activo' : 'pendiente') }, { headers });
}
