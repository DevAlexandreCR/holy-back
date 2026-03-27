# HolyVerso Web Landing

Carpeta que contiene la landing page oficial de HolyVerso.

## 📁 Estructura

```
web/
├── index.html       # Página principal
├── styles.css       # Estilos con marca HolyVerso
├── script.js        # Animaciones y funcionalidad
└── assets/
    └── favicon.svg  # Logo favicon
```

## 🎨 Diseño

La landing page sigue estrictamente el brand guide de HolyVerso:

### Colores
- **Holy Gold**: `#F4D27A` - Acentos y luz
- **Midnight Faith**: `#1A2940` - Base profunda
- **Pure White**: `#FFFFFF` - Claridad
- **Morning Light**: `#7EA9E1` - Suavidad
- **Soft Mist**: `#D7DCE3` - Neutralidad

### Tipografía
- **Inter** - Familia principal para UI y textos

## ✨ Características

1. **Hero Section**: Presentación principal con animaciones de luz
2. **Features**: 6 características clave de la app
3. **Widgets**: Guías paso a paso para iOS y Android
4. **Download**: CTAs para App Store y Google Play
5. **Footer**: Links e información adicional

## 🚀 Despliegue

Esta landing se sirve a través de nginx en el dominio principal `holyverso.com`.

Ver configuración en `docs/back/publish.md`.

## 🧪 Preview local

La forma correcta de ver la landing en local es servirla por HTTP a través del backend.

### Flujo recomendado

```bash
# Desde la raíz del repo
docker compose up backend
```

Luego abre:

```text
http://localhost:3000/
```

### Importante

- No abras `holy-back/web/index.html` directamente con `file://`.
- La landing usa rutas absolutas como `/styles.css`, `/script.js`, `/assets/...`, `/out/...` y `/.well-known/...`.
- También depende de comportamiento de origen HTTP para redirects, tracking y deep links.
- Si la abres como archivo local, verás errores esperados de recursos no encontrados y restricciones del navegador.

## 📱 Responsive

La página es completamente responsive y se adapta a:
- Desktop (1200px+)
- Tablet (768px - 1024px)
- Mobile (< 768px)

## 🎭 Animaciones

- Partículas flotantes
- Parallax en hero
- Scroll animations (AOS)
- Hover effects en cards
- Counter animations en stats
- Rotación automática de versículos

## 📝 SEO

- Meta tags optimizados
- Estructura semántica HTML5
- Performance optimizada
- Assets minificados

---

**Slogan**: *Luz y Palabra para cada día*
