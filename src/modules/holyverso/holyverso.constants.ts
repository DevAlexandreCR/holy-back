export const HOLYVERSO_TIMEZONE = 'America/Bogota'
export const HOLYVERSO_TARGET_DAILY_PUBLISH_COUNT = 5
export const HOLYVERSO_MAX_RETRIES = 2
export const HOLYVERSO_RETRY_CUTOFF = '22:30'
export const HOLYVERSO_SLOT_TIMES = ['06:00', '09:00', '12:00', '16:00', '20:00'] as const

export const HOLYVERSO_TOPIC_POOL = [
  {
    key: 'esperanza',
    description:
      'Mensajes para días en los que hace falta ánimo, consuelo y esperanza real en Dios.',
  },
  {
    key: 'ansiedad',
    description:
      'Devocionales para ansiedad, afán, cansancio mental y necesidad de descanso espiritual.',
  },
  {
    key: 'proposito',
    description:
      'Reflexiones sobre llamado, sentido, dirección y propósito en medio de la rutina.',
  },
  {
    key: 'disciplina',
    description:
      'Textos sobre constancia, obediencia, hábitos sanos y perseverancia diaria con Dios.',
  },
  {
    key: 'fe',
    description:
      'Contenido centrado en confiar, creer, seguir adelante y depender de la fidelidad de Dios.',
  },
  {
    key: 'trabajo',
    description:
      'Aplicaciones bíblicas para el trabajo, la presión laboral, el servicio y la excelencia.',
  },
  {
    key: 'relaciones',
    description:
      'Devocionales sobre familia, amistades, pareja, perdón, reconciliación y amor práctico.',
  },
] as const

export const HOLYVERSO_STYLE_LIBRARY = [
  {
    key: 'cinematic-documentary',
    description:
      'Cinematic documentary photography, natural light, intimate human moment, realistic skin, warm editorial mood.',
  },
  {
    key: 'quiet-watercolor',
    description:
      'Soft watercolor illustration, airy textures, gentle brushwork, luminous highlights, devotional calm.',
  },
  {
    key: 'modern-paper-cut',
    description:
      'Layered paper-cut illustration, rich depth, tactile edges, symbolic composition, refined contemporary palette.',
  },
  {
    key: 'golden-hour-landscape',
    description:
      'Wide landscape scene at golden hour, contemplative atmosphere, subtle drama, natural beauty, realistic detail.',
  },
  {
    key: 'editorial-portrait',
    description:
      'Editorial portrait photography, expressive face, candid emotion, clean composition, premium magazine look.',
  },
  {
    key: 'minimal-symbolic-3d',
    description:
      'Minimal symbolic 3D render, tactile materials, soft shadows, elegant simplicity, emotionally clear focal point.',
  },
  {
    key: 'charcoal-and-light',
    description:
      'Charcoal and graphite illustration with controlled highlights, textured depth, dramatic but serene mood.',
  },
  {
    key: 'botanical-fine-art',
    description:
      'Fine art botanical scene, detailed foliage, hopeful morning light, subtle movement, organic composition.',
  },
  {
    key: 'street-life-realism',
    description:
      'Realistic urban life photography, everyday Colombian-inspired context, authentic details, hopeful atmosphere.',
  },
  {
    key: 'stained-glass-modern',
    description:
      'Modern stained-glass inspired artwork, luminous color fields, sacred atmosphere, bold shapes, elegant restraint.',
  },
] as const

export type HolyversoTopicKey = (typeof HOLYVERSO_TOPIC_POOL)[number]['key']
export type HolyversoStyleKey = (typeof HOLYVERSO_STYLE_LIBRARY)[number]['key']
