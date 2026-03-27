// HolyVerso Landing Page - JavaScript

const HOLYVERSO_SCHEME_BASE = 'holyverso://app'
const APP_STORE_REDIRECT = '/out/app-store'
const GOOGLE_PLAY_REDIRECT = '/out/google-play'
const DESKTOP_DOWNLOAD_FALLBACK = '#download'
const STORAGE_KEY = 'holyverso.landing.context'
const SESSION_KEY = 'holyverso.landing.session_id'
const SCROLL_MARKS = [25, 50, 75, 100]

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    if (this.dataset.skipSmoothScroll === 'true') return

    e.preventDefault()
    const target = document.querySelector(this.getAttribute('href'))
    if (target) {
      const offset = 80
      const targetPosition = target.offsetTop - offset
      window.scrollTo({
        top: targetPosition,
        behavior: 'smooth'
      })
    }
  })
})

function trackEvent(name, params = {}) {
  if (typeof window.gtag === 'function') {
    window.gtag('event', name, params)
    return
  }

  if (Array.isArray(window.dataLayer)) {
    window.dataLayer.push({ event: name, ...params })
  }
}

function getLandingSessionId() {
  const existing = sessionStorage.getItem(SESSION_KEY)
  if (existing) return existing

  const nextId =
    (window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `session_${Date.now()}_${Math.random().toString(16).slice(2)}`)
  sessionStorage.setItem(SESSION_KEY, nextId)
  return nextId
}

function readStoredContext() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function readUrlContext() {
  const params = new URLSearchParams(window.location.search)
  const allowedKeys = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'entry_context',
    'lp_variant',
    'share_token'
  ]

  const context = {}
  allowedKeys.forEach((key) => {
    const value = params.get(key)
    if (value) {
      context[key] = value
    }
  })
  return context
}

function persistLandingContext() {
  const stored = readStoredContext()
  const incoming = readUrlContext()
  const next = { ...stored, ...incoming }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

function getBaseContext() {
  const body = document.body
  const stored = readStoredContext()
  return {
    entry_context: stored.entry_context || body.dataset.entryContext || 'home',
    lp_variant: stored.lp_variant || body.dataset.lpVariant || 'emotional',
    utm_source: stored.utm_source || '',
    utm_medium: stored.utm_medium || '',
    utm_campaign: stored.utm_campaign || '',
    utm_content: stored.utm_content || '',
    share_token: stored.share_token || '',
    landing_session_id: getLandingSessionId()
  }
}

function buildTrackedRedirectUrl(target, overrides = {}) {
  const params = new URLSearchParams()
  const merged = { ...getBaseContext(), ...overrides }

  Object.entries(merged).forEach(([key, value]) => {
    if (value != null && `${value}`.trim() !== '') {
      params.set(key, `${value}`)
    }
  })

  return `${target}?${params.toString()}`
}

function getMobilePlatform() {
  const userAgent = navigator.userAgent || ''
  const isAndroid = /Android/i.test(userAgent)
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent)
  if (isAndroid) return 'android'
  if (isIOS) return 'ios'
  return null
}

function resolveTrackedStoreUrl(platform, overrides = {}) {
  return platform === 'ios'
    ? buildTrackedRedirectUrl(APP_STORE_REDIRECT, {
        target_platform: 'ios',
        ...overrides
      })
    : buildTrackedRedirectUrl(GOOGLE_PLAY_REDIRECT, {
        target_platform: 'android',
        ...overrides
      })
}

function getDeepLinkFromCurrentLocation() {
  const { pathname, search } = window.location

  if (pathname.startsWith('/devotionals/')) {
    return `${HOLYVERSO_SCHEME_BASE}${pathname}${search || ''}`
  }

  if (pathname.startsWith('/reset-password')) {
    return `${HOLYVERSO_SCHEME_BASE}/reset-password${search || ''}`
  }

  const params = new URLSearchParams(search)
  const deepLinkParam = params.get('deeplink')
  if (deepLinkParam && deepLinkParam.startsWith('holyverso://')) {
    return deepLinkParam
  }

  return null
}

function openAppWithStoreFallback(deepLink, overrides = {}) {
  const platform = getMobilePlatform()
  if (!platform) return

  let appOpened = false
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      appOpened = true
    }
  }

  trackEvent('deep_link_attempt', {
    ...getBaseContext(),
    ...overrides,
    target_platform: platform
  })

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.setTimeout(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    if (!appOpened) {
      trackEvent('deep_link_fallback', {
        ...getBaseContext(),
        ...overrides,
        target_platform: platform
      })
      window.location.replace(resolveTrackedStoreUrl(platform, overrides))
    }
  }, 2000)

  window.location.href = deepLink
}

function replacePrimaryCtaForDeepLink(deepLink) {
  const primaryButton = document.querySelector('.hero-buttons .btn.btn-primary.js-smart-download')
  if (!primaryButton) return

  const platform = getMobilePlatform()
  if (!platform) {
    primaryButton.setAttribute('href', DESKTOP_DOWNLOAD_FALLBACK)
    return
  }

  const icon = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M5 10H15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M10 5L15 10L10 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `

  primaryButton.dataset.skipSmartDownload = 'true'
  primaryButton.setAttribute('href', deepLink)
  primaryButton.innerHTML = `${icon}Abrir en la app`
  primaryButton.addEventListener('click', (event) => {
    event.preventDefault()
    openAppWithStoreFallback(deepLink, { cta_placement: 'hero_deep_link' })
  })
}

const incomingDeepLink = getDeepLinkFromCurrentLocation()
if (incomingDeepLink) {
  replacePrimaryCtaForDeepLink(incomingDeepLink)
  openAppWithStoreFallback(incomingDeepLink, { cta_placement: 'deep_link_auto' })
}

const navbar = document.querySelector('.navbar')

window.addEventListener('scroll', () => {
  const currentScroll = window.pageYOffset

  if (navbar) {
    if (currentScroll > 50) {
      navbar.style.background = 'rgba(26, 41, 64, 0.98)'
      navbar.style.boxShadow = '0 2px 20px rgba(244, 210, 122, 0.15)'
    } else {
      navbar.style.background = 'rgba(26, 41, 64, 0.95)'
      navbar.style.boxShadow = 'none'
    }
  }

  const heroVisual = document.querySelector('.hero-visual')
  const lightRays = document.querySelector('.light-rays')

  if (heroVisual) {
    heroVisual.style.transform = `translateY(${currentScroll * 0.3}px)`
  }

  if (lightRays) {
    lightRays.style.transform = `translateX(-50%) scale(${1 + currentScroll * 0.0005})`
  }
}, { passive: true })

const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('aos-animate')
      observer.unobserve(entry.target)
    }
  })
}, observerOptions)

document.querySelectorAll('[data-aos]').forEach(el => {
  observer.observe(el)
})

const trackedSections = document.querySelectorAll('[data-track]')
if (trackedSections.length > 0) {
  const trackObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const eventName = entry.target.dataset.track || 'section_view'
        const label = entry.target.dataset.trackLabel || 'section'
        trackEvent(eventName, {
          ...getBaseContext(),
          section_label: label
        })
        trackObserver.unobserve(entry.target)
      }
    })
  }, { threshold: 0.4 })

  trackedSections.forEach(section => {
    trackObserver.observe(section)
  })
}

function trackScrollDepth() {
  const reached = new Set()
  const onScroll = () => {
    const scrollTop = window.scrollY
    const available = document.documentElement.scrollHeight - window.innerHeight
    if (available <= 0) return

    const progress = Math.round((scrollTop / available) * 100)
    SCROLL_MARKS.forEach((mark) => {
      if (progress >= mark && !reached.has(mark)) {
        reached.add(mark)
        trackEvent('scroll_depth', {
          ...getBaseContext(),
          percent: mark
        })
      }
    })
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
}

function createParticles() {
  const particlesContainer = document.querySelector('.floating-particles')
  if (!particlesContainer) return

  const starCount = 100
  const cometCount = 4

  for (let i = 0; i < starCount; i++) {
    const particle = document.createElement('div')
    particle.className = 'particle star'

    const size = Math.random() * 2.5 + 0.8
    const isGolden = Math.random() > 0.65
    const color = isGolden
      ? `rgba(244, 210, 122, ${Math.random() * 0.9 + 0.5})`
      : `rgba(255, 255, 255, ${Math.random() * 0.7 + 0.3})`

    const boxShadow = isGolden
      ? `0 0 ${size * 3}px rgba(244, 210, 122, 1), 0 0 ${size * 6}px rgba(255, 215, 0, 0.8)`
      : `0 0 ${size * 2}px rgba(255, 255, 255, 0.9), 0 0 ${size * 3}px rgba(255, 255, 255, 0.5)`

    particle.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      box-shadow: ${boxShadow};
      border-radius: 50%;
      top: ${Math.random() * 100}%;
      left: ${Math.random() * 100}%;
      animation: particleFloat ${Math.random() * 15 + 25}s ease-in-out infinite, starTwinkle ${Math.random() * 3 + 2}s ease-in-out infinite;
      animation-delay: ${Math.random() * 5}s;
    `

    particlesContainer.appendChild(particle)
  }

  for (let i = 0; i < cometCount; i++) {
    const comet = document.createElement('div')
    comet.className = 'particle comet'

    const size = Math.random() * 2 + 1.5
    const angle = Math.random() * 360

    comet.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      background: radial-gradient(ellipse at center, rgba(244, 210, 122, 1) 0%, rgba(255, 215, 0, 0.8) 40%, transparent 100%);
      border-radius: 50%;
      top: ${Math.random() * 80 + 10}%;
      left: -10%;
      box-shadow:
        0 0 ${size * 4}px rgba(244, 210, 122, 1),
        0 0 ${size * 8}px rgba(255, 215, 0, 0.6),
        ${size * 15}px 0 ${size * 8}px rgba(244, 210, 122, 0.4),
        ${size * 25}px 0 ${size * 6}px rgba(244, 210, 122, 0.2);
      animation: cometMove ${Math.random() * 8 + 12}s linear infinite;
      animation-delay: ${Math.random() * 10}s;
      transform: rotate(${angle}deg);
    `

    particlesContainer.appendChild(comet)
  }
}

const particleStyle = document.createElement('style')
particleStyle.textContent = `
  @keyframes particleFloat {
    0%, 100% {
      transform: translate(0, 0);
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    90% {
      opacity: 1;
    }
    100% {
      transform: translate(${Math.random() * 200 - 100}px, ${Math.random() * 200 - 100}px);
      opacity: 0;
    }
  }
`
document.head.appendChild(particleStyle)
createParticles()

function animateCounter(element, target, duration = 2000, suffix = '') {
  const increment = target / (duration / 16)
  let current = 0

  const formatValue = (value) => {
    if (target >= 1000) {
      return Math.floor(value / 1000) + 'K+'
    }
    if (target.toString().includes('.')) {
      return value.toFixed(1) + '★'
    }
    return Math.floor(value) + suffix
  }

  const timer = setInterval(() => {
    current += increment
    if (current >= target) {
      element.textContent = formatValue(target)
      clearInterval(timer)
    } else {
      element.textContent = formatValue(current)
    }
  }, 16)
}

const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const stats = entry.target.querySelectorAll('.stat-number')
      stats.forEach(stat => {
        const text = stat.textContent
        let target

        if (text.includes('K+')) {
          target = parseInt(text.replace('K+', '')) * 1000
          animateCounter(stat, target, 2000)
        } else if (text.includes('★')) {
          target = parseFloat(text.replace('★', ''))
          let current = 0
          const timer = setInterval(() => {
            current += 0.1
            if (current >= target) {
              stat.textContent = target.toFixed(1) + '★'
              clearInterval(timer)
            } else {
              stat.textContent = current.toFixed(1) + '★'
            }
          }, 50)
        } else if (text.endsWith('+')) {
          target = parseInt(text.replace('+', ''))
          animateCounter(stat, target, 2000, '+')
        } else {
          target = parseInt(text)
          animateCounter(stat, target, 2000)
        }
      })
      statsObserver.unobserve(entry.target)
    }
  })
}, { threshold: 0.5 })

const downloadSection = document.querySelector('.download-stats')
if (downloadSection) {
  statsObserver.observe(downloadSection)
}

const faqItems = document.querySelectorAll('.faq-item')
if (faqItems.length > 0) {
  faqItems.forEach(item => {
    const button = item.querySelector('.faq-question')
    if (!button) return

    button.addEventListener('click', () => {
      const isOpen = item.classList.contains('is-open')
      faqItems.forEach(other => {
        if (other !== item) {
          other.classList.remove('is-open')
          const otherButton = other.querySelector('.faq-question')
          if (otherButton) {
            otherButton.setAttribute('aria-expanded', 'false')
          }
        }
      })
      item.classList.toggle('is-open')
      button.setAttribute('aria-expanded', String(!isOpen))

      if (!isOpen) {
        const label = button.querySelector('span')?.textContent?.trim() || 'faq'
        trackEvent('faq_open', {
          ...getBaseContext(),
          label
        })
      }
    })
  })
}

document.querySelectorAll('.feature-card').forEach(card => {
  card.addEventListener('mouseenter', function () {
    this.style.transition = 'all 0.3s ease'
  })

  card.addEventListener('mousemove', function (e) {
    const rect = this.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const rotateX = (y - centerY) / 20
    const rotateY = (centerX - x) / 20

    this.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px)`
  })

  card.addEventListener('mouseleave', function () {
    this.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) translateY(0)'
  })
})

const verses = [
  {
    text: 'Hoy no necesitas hacerlo perfecto. Solo dar un paso mas con Dios en medio de lo que sientes.',
    reference: 'Ana Lucia · Devocional de hoy'
  },
  {
    text: 'Cuando algo te toca hoy, puedes guardarlo para volver a leerlo cuando el dia se ponga pesado.',
    reference: 'Laura P. · Guardado para volver'
  },
  {
    text: 'No todo cambio hoy, pero ya no me siento igual despues de leer esto.',
    reference: 'Mateo R. · Hace 5 horas'
  }
]

let currentVerseIndex = 0

function rotateVerse() {
  const verseText = document.querySelector('.verse-text')
  const verseRef = document.querySelector('.verse-reference')

  if (verseText && verseRef) {
    verseText.style.opacity = '0'
    verseRef.style.opacity = '0'

    setTimeout(() => {
      currentVerseIndex = (currentVerseIndex + 1) % verses.length
      verseText.textContent = verses[currentVerseIndex].text
      verseRef.textContent = verses[currentVerseIndex].reference
      verseText.style.transition = 'opacity 0.5s ease'
      verseRef.style.transition = 'opacity 0.5s ease'
      verseText.style.opacity = '1'
      verseRef.style.opacity = '1'
    }, 500)
  }
}

setInterval(rotateVerse, 5000)

function typeWriterEffect(element, text, speed = 50) {
  if (!element) return

  let index = 0
  element.textContent = ''

  function type() {
    if (index < text.length) {
      element.textContent += text.charAt(index)
      index += 1
      window.setTimeout(type, speed)
    }
  }

  type()
}

function wireSmartDownloads() {
  document.querySelectorAll('.js-smart-download').forEach((button) => {
    if (button.dataset.skipSmartDownload === 'true') return

    button.addEventListener('click', (event) => {
      const placement = button.dataset.ctaPlacement || 'download'
      const scrollTargetId = button.dataset.scrollTarget
      const platform = getMobilePlatform()

      trackEvent(button.dataset.trackClick || 'cta_click', {
        ...getBaseContext(),
        cta_placement: placement,
        target_platform: platform || 'desktop'
      })

      if (platform) {
        event.preventDefault()
        trackEvent('store_redirect', {
          ...getBaseContext(),
          cta_placement: placement,
          target_platform: platform
        })
        window.location.href = resolveTrackedStoreUrl(platform, {
          cta_placement: placement
        })
        return
      }

      if (scrollTargetId) {
        event.preventDefault()
        const target = document.getElementById(scrollTargetId)
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }
    })
  })
}

function wireStoreButtons() {
  document.querySelectorAll('[data-store-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.storeTarget
      const placement = button.dataset.ctaPlacement || `store_${target}`
      const platform = target === 'app-store' ? 'ios' : 'android'
      button.href = resolveTrackedStoreUrl(platform, {
        cta_placement: placement
      })

      trackEvent(button.dataset.trackClick || 'cta_click', {
        ...getBaseContext(),
        cta_placement: placement,
        target_platform: platform
      })

      trackEvent('store_redirect', {
        ...getBaseContext(),
        cta_placement: placement,
        target_platform: platform
      })
    })
  })
}

function wireTrackedClicks() {
  document.querySelectorAll('[data-track-click]').forEach((element) => {
    if (element.classList.contains('js-smart-download')) return
    if (element.hasAttribute('data-store-target')) return

    element.addEventListener('click', () => {
      const placement = element.dataset.ctaPlacement || 'interaction'
      trackEvent(element.dataset.trackClick || 'cta_click', {
        ...getBaseContext(),
        cta_placement: placement,
        target_platform: getMobilePlatform() || 'desktop'
      })
    })
  })
}

document.querySelectorAll('.btn, .store-button').forEach(button => {
  button.addEventListener('click', function (e) {
    const rect = this.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const ripple = document.createElement('span')
    ripple.style.cssText = `
      position: absolute;
      width: 20px;
      height: 20px;
      background: rgba(255, 255, 255, 0.5);
      border-radius: 50%;
      transform: translate(-50%, -50%) scale(0);
      animation: ripple 0.6s ease-out;
      left: ${x}px;
      top: ${y}px;
      pointer-events: none;
    `

    this.style.position = 'relative'
    this.style.overflow = 'hidden'
    this.appendChild(ripple)

    setTimeout(() => ripple.remove(), 600)
  })
})

const rippleStyle = document.createElement('style')
rippleStyle.textContent = `
  @keyframes ripple {
    to {
      transform: translate(-50%, -50%) scale(20);
      opacity: 0;
    }
  }
`
document.head.appendChild(rippleStyle)

if ('IntersectionObserver' in window) {
  const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return

      const image = entry.target
      if (image instanceof HTMLImageElement && image.dataset.src) {
        image.src = image.dataset.src
        image.classList.add('loaded')
      }

      imageObserver.unobserve(image)
    })
  })

  document.querySelectorAll('img[data-src]').forEach((image) => {
    imageObserver.observe(image)
  })
}

window.addEventListener('load', () => {
  document.body.classList.add('loaded')
})

function throttle(func, wait) {
  let timeoutId

  return function throttledFunction(...args) {
    const later = () => {
      clearTimeout(timeoutId)
      func(...args)
    }

    clearTimeout(timeoutId)
    timeoutId = window.setTimeout(later, wait)
  }
}

const throttledResize = throttle(() => {
  const heroVisual = document.querySelector('.hero-visual')
  if (!heroVisual) return

  if (window.innerWidth <= 768) {
    heroVisual.style.transform = ''
  }
}, 120)

window.addEventListener('resize', throttledResize, { passive: true })

document.addEventListener('keydown', (e) => {
  window.__holyversoKonami = window.__holyversoKonami || []
  const sequence = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65]
  window.__holyversoKonami.push(e.keyCode)
  window.__holyversoKonami.splice(
    -sequence.length - 1,
    window.__holyversoKonami.length - sequence.length
  )

  if (window.__holyversoKonami.join('').includes(sequence.join(''))) {
    document.body.style.animation = 'rainbow 2s linear infinite'
    setTimeout(() => {
      document.body.style.animation = ''
    }, 5000)
  }
})

const rainbowStyle = document.createElement('style')
rainbowStyle.textContent = `
  @keyframes rainbow {
    0% { filter: hue-rotate(0deg); }
    100% { filter: hue-rotate(360deg); }
  }
`
document.head.appendChild(rainbowStyle)

persistLandingContext()
trackEvent('landing_view', getBaseContext())
trackScrollDepth()
wireSmartDownloads()
wireStoreButtons()
wireTrackedClicks()

console.log('%cHolyVerso', 'font-size: 24px; font-weight: bold; color: #F4D27A;')
console.log('%cLuz y Palabra para cada dia', 'font-size: 14px; color: #7EA9E1;')
console.log('%cWidgets, devocionales y Biblia sin distracciones', 'font-size: 12px; color: #E8EBF0;')
