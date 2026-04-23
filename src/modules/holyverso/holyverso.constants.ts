import {
  DEVOTIONAL_TAG_DICTIONARY,
  type DevotionalTagKey,
} from '../devotionals/devotionalTagDictionary'

export const HOLYVERSO_TIMEZONE = 'America/Bogota'
export const HOLYVERSO_TARGET_DAILY_PUBLISH_COUNT = 5
export const HOLYVERSO_MAX_RETRIES = 2
export const HOLYVERSO_RETRY_CUTOFF = '22:30'
export const HOLYVERSO_SLOT_TIMES = ['06:00', '09:00', '12:00', '16:00', '20:00'] as const

const HOLYVERSO_TOPIC_DESCRIPTIONS: Record<DevotionalTagKey, string> = {
  esperanza:
    'Mensajes para días en los que hace falta ánimo, consuelo y esperanza real en Dios.',
  ansiedad:
    'Devocionales para ansiedad, afán, cansancio mental y necesidad de descanso espiritual.',
  proposito:
    'Reflexiones sobre llamado, sentido, dirección y propósito en medio de la rutina.',
  disciplina:
    'Textos sobre constancia, hábitos sanos, dominio propio y perseverancia diaria con Dios.',
  fe: 'Contenido centrado en confiar, creer, seguir adelante y depender de la fidelidad de Dios.',
  trabajo:
    'Aplicaciones bíblicas para el trabajo, la presión laboral, el servicio y la excelencia.',
  relaciones:
    'Devocionales sobre amistad, convivencia, reconciliación y amor práctico en vínculos cotidianos.',
  oracion:
    'Reflexiones para volver a la oración sincera, la dependencia de Dios y el clamor perseverante.',
  descanso:
    'Mensajes para reposar en Dios, bajar el ritmo y recuperar paz en medio del desgaste.',
  perdon:
    'Textos sobre perdonar, soltar ofensas, sanar heridas y abrir espacio para la reconciliación.',
  gratitud:
    'Devocionales que despiertan agradecimiento, contentamiento y memoria de la bondad de Dios.',
  sabiduria:
    'Contenido sobre discernimiento, prudencia y decisiones guiadas por la verdad de Dios.',
  identidad:
    'Reflexiones para recordar quién eres en Dios, tu valor y tu pertenencia en Cristo.',
  sanidad:
    'Mensajes sobre restauración interior, proceso de sanidad y esperanza para heridas profundas.',
  soledad:
    'Devocionales para temporadas de aislamiento, silencio y necesidad de compañía espiritual.',
  duelo:
    'Textos pastorales para atravesar pérdida, ausencia y dolor con esperanza y consuelo.',
  familia:
    'Aplicaciones bíblicas para el hogar, la crianza, honrar a los padres y cuidar la familia.',
  matrimonio:
    'Reflexiones para la vida matrimonial, la unidad, el servicio mutuo y el amor perseverante.',
  provision:
    'Mensajes para momentos de escasez, necesidad y confianza en la provisión fiel de Dios.',
  obediencia:
    'Devocionales sobre rendición, obedecer la voz de Dios y caminar con fidelidad práctica.',
}

export const HOLYVERSO_TOPIC_POOL = DEVOTIONAL_TAG_DICTIONARY.map((topic) => ({
  key: topic.key,
  description: HOLYVERSO_TOPIC_DESCRIPTIONS[topic.key],
})) as ReadonlyArray<{
  key: DevotionalTagKey
  description: string
}>

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

export type HolyversoTopicKey = DevotionalTagKey
export type HolyversoStyleKey = (typeof HOLYVERSO_STYLE_LIBRARY)[number]['key']
