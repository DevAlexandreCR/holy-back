const APP_STORE_REDIRECT = '/out/app-store'
const GOOGLE_PLAY_REDIRECT = '/out/google-play'
const STORAGE_KEY = 'holyverso.landing.context'
const SESSION_KEY = 'holyverso.landing.session_id'
const SCROLL_MARKS = [25, 50, 75, 100]

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
  const baseContext = getBaseContext()
  const params = new URLSearchParams()
  const merged = { ...baseContext, ...overrides }

  Object.entries(merged).forEach(([key, value]) => {
    if (value != null && `${value}`.trim() !== '') {
      params.set(key, `${value}`)
    }
  })

  return `${target}?${params.toString()}`
}

function getMobilePlatform() {
  const userAgent = navigator.userAgent || ''
  if (/Android/i.test(userAgent)) return 'android'
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios'
  return null
}

function resolveTrackedStoreUrl(platform, overrides) {
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
    return `holyverso://app${pathname}${search || ''}`
  }

  if (pathname.startsWith('/reset-password')) {
    return `holyverso://app/reset-password${search || ''}`
  }

  const params = new URLSearchParams(search)
  const deepLink = params.get('deeplink')
  if (deepLink && deepLink.startsWith('holyverso://')) {
    return deepLink
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
  }, 1800)

  window.location.href = deepLink
}

function revealOnScroll() {
  const elements = document.querySelectorAll('[data-reveal]')
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      }
    })
  }, { threshold: 0.16 })

  elements.forEach((element) => observer.observe(element))
}

function trackSections() {
  const sections = document.querySelectorAll('[data-track="section_view"]')
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        trackEvent('section_view', {
          ...getBaseContext(),
          section_label: entry.target.dataset.trackLabel || 'section'
        })
        observer.unobserve(entry.target)
      }
    })
  }, { threshold: 0.38 })

  sections.forEach((section) => observer.observe(section))
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

function wireSmartDownloads() {
  document.querySelectorAll('.js-smart-download').forEach((button) => {
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
      button.href = resolveTrackedStoreUrl(
        platform,
        { cta_placement: placement }
      )

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

function updateNavbar() {
  const navbar = document.querySelector('.navbar')
  if (!navbar) return

  const sync = () => {
    navbar.classList.toggle('is-scrolled', window.scrollY > 32)
  }

  window.addEventListener('scroll', sync, { passive: true })
  sync()
}

function handleIncomingDeepLink() {
  const deepLink = getDeepLinkFromCurrentLocation()
  if (!deepLink) return

  openAppWithStoreFallback(deepLink, {
    entry_context: getBaseContext().entry_context || 'share',
    cta_placement: 'deep_link_auto'
  })
}

persistLandingContext()
trackEvent('landing_view', getBaseContext())
revealOnScroll()
trackSections()
trackScrollDepth()
wireSmartDownloads()
wireStoreButtons()
updateNavbar()
handleIncomingDeepLink()
