/**
 * Generador determinista de datos de demostración.
 *
 * Reproduce el catálogo de 11 usuarios del seed y simula 6 semanas de
 * asistencia (marcas, ajustes manuales y faltas) para poder ver el sistema
 * funcionando sin una base de datos real.
 *
 * Determinista: misma semilla -> mismos datos en el backend y el admin.
 */

export interface UsuarioDemo {
  id: string;
  nombre: string;
  correo: string;
  area: "Oficina" | "Técnico" | "Sin asignar";
  minutos_comida: number;
  legajo: number | null;
  etiqueta_nfc: string | null;
  token_hash: string | null;
  token_prefijo: string | null;
  activo: boolean;
  creado_en: string;
}

export interface SedeDemo {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  radio_m: number;
  activa: boolean;
  creado_en: string;
}

export interface MarcaDemo {
  id: string;
  usuario_id: string;
  ts: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  distancia_m: number | null;
  sede_id: string | null;
  origen: "nfc" | "qr" | "manual";
  ip: string | null;
  user_agent: string | null;
  creado_en: string;
}

export interface AjusteDemo {
  id: string;
  usuario_id: string;
  fecha: string;
  entrada: string | null;
  salida: string | null;
  observaciones: string | null;
  creado_por: string;
  creado_en: string;
}

export interface FaltaDemo {
  id: string;
  usuario_id: string;
  fecha: string;
  motivo: string | null;
  justificada: boolean;
  creada_por: string;
  creada_en: string;
}

export interface HorarioEspecialDemo {
  id: string;
  usuario_id: string;
  dia_semana: number;
  entrada: string;
  salida: string;
  vigente_desde: string;
  vigente_hasta: string | null;
  activo: boolean;
  creado_en: string;
}

export interface RechazadoDemo {
  id: string;
  ts: string;
  usuario_id: string | null;
  token_prefijo: string | null;
  motivo: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  distancia_m: number | null;
  detalle: string | null;
}

export interface AdminDemo {
  correo: string;
  rol: "admin" | "supervisor";
  creado_en: string;
}

export interface AvisoAdminDemo {
  clave: string;
  ultima_envio: string;
}

export interface DatosDemo {
  usuarios: UsuarioDemo[];
  sedes: SedeDemo[];
  marcas: MarcaDemo[];
  ajustes_manuales: AjusteDemo[];
  faltas: FaltaDemo[];
  horarios_especiales: HorarioEspecialDemo[];
  rechazados: RechazadoDemo[];
  admins: AdminDemo[];
  avisos_admin: AvisoAdminDemo[];
  config: { clave: string; valor: unknown; descripcion: string | null }[];
}

/**
 * Tokens de demostración (los mismos del seed 0003).
 * Solo sirven para probar la vista de registro sin tarjeta física.
 */
export const TOKENS_DEMO: Record<string, string> = {
  "jesus.guadarrama@gmail.com": "BRZADF6P5V95",
  "blanca.lopez@gmail.com": "5AGQHALC87MT",
  "luna.munoz@gmail.com": "FN7SEVNG6D7P",
  "ana.islas@gmail.com": "JFJT9Z3C85LS",
  "mario.jsna@gmail.com": "L8MT45XJNNXN",
  "juanpablo.talamantez@gmail.com": "7A8Y4C9NTARW",
  "antonio.perez@gmail.com": "GJC2NQECLGLQ",
  "juancarlos.hernandez@gmail.com": "S2FGDA4E2ZPU",
  "jesus.escobar@gmail.com": "ZUV2JE3GYU94",
  "josecarlos.trejo@gmail.com": "M3QTU3HXQR2C",
  "juanpablo.amador@gmail.com": "N7HL3YQH25S9",
};

/** SHA-256 de cada token de demostración (verificado con Web Crypto). */
const TOKENS_HASH_DEMO: Record<string, string> = {
  "jesus.guadarrama@gmail.com":
    "616293469fe4542bc4030d1a7fb967a501a02876a3ffd3ff377b528323486f04",
  "blanca.lopez@gmail.com":
    "3d77cc3af1e5d8407af6686998be17f919c126ff7658b434d1f43415fe34ef39",
  "luna.munoz@gmail.com":
    "3ee35d9c42d2bb5bcdce781f6ac08d95f3c349f596e384da52d8e4c1b7554204",
  "ana.islas@gmail.com":
    "a901be4d126fd69b00feddbcfc71fdcfc1d63ca8b1a697246a402c3df9028824",
  "mario.jsna@gmail.com":
    "ac5c83632208c63dfbcbf2216601032f5ad67109361a4995cf706888407e59ab",
  "juanpablo.talamantez@gmail.com":
    "01953129ef290b135eaf834b3884138e83d2a15b1bdc3e2d9c837c2e4c67edd9",
  "antonio.perez@gmail.com":
    "e67a233f447ba6eadee159d96e729b72d4d14a076c120c6b22a430c09c3c346d",
  "juancarlos.hernandez@gmail.com":
    "fa0bfebd92b8d7f07706390aabb8bc62dbf33c1b982eb53c7ec019b917ff670a",
  "jesus.escobar@gmail.com":
    "7f0b2fd1eef6395f38f2a2c5ccd43e4241e0315e1977338e3694b0040c650c2f",
  "josecarlos.trejo@gmail.com":
    "c142ccaa635af0467047fedca35f86075f16dc59f3764de726662ccf1d3d5c01",
  "juanpablo.amador@gmail.com":
    "8113333b7bcb7765e13ae43c855a5b16b27fe3ff33e9ad0576f8f9c64c753aed",
};

/** PRNG determinista (mulberry32). */
function prng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fecha local de México en YYYY-MM-DD. */
function fechaMx(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Instante UTC de una hora local de México (UTC-6 fijo). */
function instanteMx(fecha: string, hora: number, minuto: number): string {
  const partes = fecha.split("-").map(Number);
  return new Date(
    Date.UTC(partes[0], partes[1] - 1, partes[2], hora + 6, minuto, 0, 0)
  ).toISOString();
}

/**
 * ¿Esa hora local del día ya pasó? Evita generar marcas "en el futuro"
 * para el día en curso (el reloj del servidor puede ser anterior).
 */
function yaPaso(fecha: string, hora: number, minuto: number): boolean {
  const partes = fecha.split("-").map(Number);
  const instante = new Date(
    Date.UTC(partes[0], partes[1] - 1, partes[2], hora + 6, minuto, 0, 0)
  );
  return instante.getTime() <= Date.now();
}

const NOMBRES = [
  ["Jesus Guadarrama", "jesus.guadarrama@gmail.com", "Oficina", 1042],
  ["Blanca Lopez Castro", "blanca.lopez@gmail.com", "Oficina", 874],
  ["Luna Muñoz Gonzaga", "luna.munoz@gmail.com", "Oficina", 1209],
  ["Ana Karen Islas Murcia", "ana.islas@gmail.com", "Oficina", 541],
  ["Mario Ivan Suarez Garcia ESTADIAS", "mario.jsna@gmail.com", "Oficina", 1423],
  [
    "Juan Pablo Talamantez Robles ESTADIAS",
    "juanpablo.talamantez@gmail.com",
    "Oficina",
    392,
  ],
  ["Antonio Perez Tapia", "antonio.perez@gmail.com", "Técnico", 2107],
  ["Juan Carlos Hernandez Rocha", "juancarlos.hernandez@gmail.com", "Técnico", 3311],
  ["Jesus Escobar Neri", "jesus.escobar@gmail.com", "Técnico", 4860],
  ["Jose Carlos Trejo Hernandez", "josecarlos.trejo@gmail.com", "Técnico", 5572],
  ["Juan Pablo Amador", "juanpablo.amador@gmail.com", "Técnico", 6688],
] as const;

/**
 * Genera todos los datos de demostración.
 */
export function crearDatosDemo(semilla = 20260608): DatosDemo {
  const rnd = prng(semilla);
  const hoy = new Date();

  const usuarios: UsuarioDemo[] = NOMBRES.map((n, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    nombre: n[0],
    correo: n[1],
    area: n[2] as UsuarioDemo["area"],
    minutos_comida: 60,
    legajo: n[3],
    etiqueta_nfc: `NFC-${String(1000 + i * 137).padStart(4, "0")}-${String.fromCharCode(
      65 + i
    )}`,
    token_hash: TOKENS_HASH_DEMO[n[1]] ?? null,
    token_prefijo: (TOKENS_DEMO[n[1]] ?? "").slice(0, 4) || null,
    activo: true,
    creado_en: hoy.toISOString(),
  }));

  const sedes: SedeDemo[] = [
    {
      id: "10000000-0000-4000-8000-000000000001",
      nombre: "Oficina Central",
      lat: 19.432608,
      lng: -99.133209,
      radio_m: 100,
      activa: true,
      creado_en: hoy.toISOString(),
    },
  ];

  const marcas: MarcaDemo[] = [];
  const ajustesManuales: AjusteDemo[] = [];
  const faltas: FaltaDemo[] = [];
  const rechazados: RechazadoDemo[] = [];

  let contador = 0;
  const nuevoId = (): string => {
    contador++;
    return `20000000-0000-4000-8000-${String(contador).padStart(12, "0")}`;
  };

  // 6 semanas hacia atrás (lunes a sábado + algunos domingos)
  for (let diasAtras = 41; diasAtras >= 0; diasAtras--) {
    const fecha = new Date(hoy.getTime());
    fecha.setUTCDate(fecha.getUTCDate() - diasAtras);
    const fechaStr = fechaMx(fecha);

    const diaSemana = new Date(
      Date.UTC(
        Number(fechaStr.slice(0, 4)),
        Number(fechaStr.slice(5, 7)) - 1,
        Number(fechaStr.slice(8, 10)),
        12,
        0,
        0,
        0
      )
    ).getUTCDay();

    const esDomingo = diaSemana === 0;

    for (let i = 0; i < usuarios.length; i++) {
      const u = usuarios[i];

      // Domingo: solo algunos registran (incidencias)
      if (esDomingo) {
        if (rnd() < 0.18) {
          marcas.push({
            id: nuevoId(),
            usuario_id: u.id,
            ts: instanteMx(fechaStr, 10, Math.floor(rnd() * 50)),
            lat: 19.432608,
            lng: -99.133209,
            accuracy: 12,
            distancia_m: 8,
            sede_id: sedes[0].id,
            origen: "nfc",
            ip: "201.141.10.5",
            user_agent: "iPhone",
            creado_en: hoy.toISOString(),
          });
        }
        continue;
      }

      // Probabilidad de asistencia
      if (rnd() < 0.14) {
        // Falta: no hay marcas (la tabla faltas la lleva el cron).
        continue;
      }

      const esBlanca = i === 1;
      const esOficina = u.area === "Oficina";

      // Hora de entrada
      let horaEntrada = esOficina ? 8 + Math.floor(rnd() * 2) : 9 + Math.floor(rnd() * 2);
      let minEntrada = Math.floor(rnd() * 50);
      if (esBlanca) {
        horaEntrada = 8;
        minEntrada = 25 + Math.floor(rnd() * 20);
      }

      // Si la entrada caería en el futuro (hoy todavía no es esa hora),
      // la persona todavía no ha fichado.
      if (!yaPaso(fechaStr, horaEntrada, minEntrada)) continue;

      marcas.push({
        id: nuevoId(),
        usuario_id: u.id,
        ts: instanteMx(fechaStr, horaEntrada, minEntrada),
        lat: 19.432608,
        lng: -99.133209,
        accuracy: 8 + Math.floor(rnd() * 20),
        distancia_m: Math.floor(rnd() * 60),
        sede_id: sedes[0].id,
        origen: rnd() < 0.6 ? "nfc" : "qr",
        ip: `201.141.10.${5 + i}`,
        user_agent: "Android",
        creado_en: hoy.toISOString(),
      });

      // Algunos días queda pendiente la salida
      if (rnd() < 0.08) continue;

      // Hora de salida (con extras ocasionales)
      const conExtra = rnd() < 0.22;
      let horaSalida = esOficina ? 17 + Math.floor(rnd() * 2) : 18 + Math.floor(rnd() * 2);
      let minSalida = Math.floor(rnd() * 59);
      if (conExtra) {
        horaSalida = 20;
        minSalida = 10 + Math.floor(rnd() * 40);
      }

      // Si la salida caería en el futuro (hoy todavía no es esa hora),
      // la persona queda con la jornada abierta.
      if (!yaPaso(fechaStr, horaSalida, minSalida)) continue;

      marcas.push({
        id: nuevoId(),
        usuario_id: u.id,
        ts: instanteMx(fechaStr, horaSalida, minSalida),
        lat: 19.432608,
        lng: -99.133209,
        accuracy: 8 + Math.floor(rnd() * 20),
        distancia_m: Math.floor(rnd() * 60),
        sede_id: sedes[0].id,
        origen: rnd() < 0.6 ? "nfc" : "qr",
        ip: `201.141.10.${5 + i}`,
        user_agent: "Android",
        creado_en: hoy.toISOString(),
      });
    }
  }

  // Dos ajustes manuales de ejemplo
  const hace2 = new Date(hoy.getTime());
  hace2.setUTCDate(hace2.getUTCDate() - 2);
  ajustesManuales.push({
    id: nuevoId(),
    usuario_id: usuarios[1].id, // Blanca
    fecha: fechaMx(hace2),
    entrada: "08:30",
    salida: "19:00",
    observaciones: "Corrección manual: jornada extendida por visita a cliente.",
    creado_por: "marionly420@gmail.com",
    creado_en: hoy.toISOString(),
  });

  const hace4 = new Date(hoy.getTime());
  hace4.setUTCDate(hace4.getUTCDate() - 4);
  ajustesManuales.push({
    id: nuevoId(),
    usuario_id: usuarios[6].id, // Antonio
    fecha: fechaMx(hace4),
    entrada: null,
    salida: "20:15",
    observaciones: "Salida manual (olvidó checar).",
    creado_por: "marionly420@gmail.com",
    creado_en: hoy.toISOString(),
  });

  // Faltas: una justificada y una no
  const hace3 = new Date(hoy.getTime());
  hace3.setUTCDate(hace3.getUTCDate() - 3);
  const fechaFalta = fechaMx(hace3);
  faltas.push({
    id: nuevoId(),
    usuario_id: usuarios[3].id,
    fecha: fechaFalta,
    motivo: "Cita médica",
    justificada: true,
    creada_por: "cron",
    creada_en: hoy.toISOString(),
  });
  faltas.push({
    id: nuevoId(),
    usuario_id: usuarios[9].id,
    fecha: fechaFalta,
    motivo: null,
    justificada: false,
    creada_por: "cron",
    creada_en: hoy.toISOString(),
  });

  // Horario especial de Blanca (08:30 - 19:00) de lunes a viernes
  const horariosEspeciales: HorarioEspecialDemo[] = [];
  for (const dia of [1, 2, 3, 4, 5]) {
    horariosEspeciales.push({
      id: nuevoId(),
      usuario_id: usuarios[1].id,
      dia_semana: dia,
      entrada: "08:30",
      salida: "19:00",
      vigente_desde: "2024-01-01",
      vigente_hasta: null,
      activo: true,
      creado_en: hoy.toISOString(),
    });
  }

  // Rechazos de ejemplo (auditoría)
  const rechazadosDemo: Array<{
    usuario: number;
    motivo: string;
    detalle: string;
    distancia: number | null;
  }> = [
    {
      usuario: 2,
      motivo: "fuera de zona",
      detalle: "A 412 m de la sede más cercana (fuera de geocerca).",
      distancia: 412,
    },
    {
      usuario: 4,
      motivo: "doble registro",
      detalle: "Última marca hace 2 min (mínimo 5 min).",
      distancia: 12,
    },
    {
      usuario: 7,
      motivo: "precision insuficiente",
      detalle: "Precisión 87 m supera el máximo permitido de 50 m.",
      distancia: null,
    },
    {
      usuario: 9,
      motivo: "sin ubicacion",
      detalle: "La petición no incluyó coordenadas de ubicación.",
      distancia: null,
    },
    {
      usuario: 5,
      motivo: "marca adicional",
      detalle: "El día ya tiene 2 marcas (entrada y salida cerradas).",
      distancia: 21,
    },
  ];

  rechazadosDemo.forEach((r, i) => {
    const dias = i + 1;
    const d = new Date(hoy.getTime());
    d.setUTCDate(d.getUTCDate() - dias);
    rechazados.push({
      id: nuevoId(),
      ts: new Date(
        d.getTime() - (14 + i) * 60 * 60 * 1000
      ).toISOString(),
      usuario_id: usuarios[r.usuario].id,
      token_prefijo: (TOKENS_DEMO[usuarios[r.usuario].correo] ?? "").slice(0, 4),
      motivo: r.motivo,
      lat: 19.432608,
      lng: -99.133209,
      accuracy: r.distancia === null ? null : 25,
      distancia_m: r.distancia,
      detalle: r.detalle,
    });
  });

  const config = [
    {
      clave: "horarios_por_area",
      valor: {
        Oficina: { inicio: "09:00", fin: "19:00" },
        Técnico: { inicio: "09:00", fin: "20:00" },
        "Sin asignar": { inicio: "09:00", fin: "19:00" },
      },
      descripcion: "Horario de referencia por área.",
    },
    {
      clave: "horario_sabado",
      valor: { inicio: "09:00", fin: "15:00" },
      descripcion: "Horario general de sábados.",
    },
    { clave: "minutos_comida_default", valor: 60, descripcion: null },
    { clave: "minutos_minimos_para_comida", valor: 300, descripcion: null },
    { clave: "minutos_entre_marcas", valor: 5, descripcion: null },
    { clave: "hora_min_registro", valor: "06:00", descripcion: null },
    { clave: "hora_max_registro", valor: "23:30", descripcion: null },
    { clave: "trasladar_extra_sabado", valor: true, descripcion: null },
    { clave: "radio_geocerca_default_m", valor: 100, descripcion: null },
    { clave: "precision_max_m", valor: 50, descripcion: null },
  ];

  const admins: AdminDemo[] = [
    { correo: "marionly420@gmail.com", rol: "admin", creado_en: hoy.toISOString() },
  ];

  // Control de deduplicacion de avisos al admin (vacio en demo).
  const avisosAdmin: AvisoAdminDemo[] = [];

  return {
    usuarios,
    sedes,
    marcas,
    ajustes_manuales: ajustesManuales,
    faltas,
    horarios_especiales: horariosEspeciales,
    rechazados,
    admins,
    avisos_admin: avisosAdmin,
    config,
  };
}

/** Contraseña del modo demo. */
export const PASSWORD_DEMO = "demo1234";

/** ¿El modo demo está activo? */
export function esDemoActivo(): boolean {
  // Se recorta: las variables de entorno pueden traer espacios sobrantes
  // según de dónde venga el valor (archivo .env, panel de Vercel, etc.).
  return process.env.SUPABASE_DEMO?.trim() === "1";
}
