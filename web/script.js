const HOLYVERSO_SCHEME_BASE = 'holyverso://app'
const APP_STORE_REDIRECT = '/out/app-store'
const GOOGLE_PLAY_REDIRECT = '/out/google-play'
const STORAGE_KEY = 'holyverso.landing.context'
const SESSION_KEY = 'holyverso.landing.session_id'
const INAPP_BROWSER_PATTERN = /Instagram|FBAN|FBAV/i
const INAPP_HINT_DELAY_MS = 2000

function trackEvent(name, params = {}) {
  if (typeof window.gtag === 'function') {
    window.gtag('event', name, params)
    return
  }

  if (Array.isArray(window.dataLayer)) {
    window.dataLayer.push({ event: name, ...params })
  }
}

function randomId(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID()
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function getLandingSessionId() {
  const existing = sessionStorage.getItem(SESSION_KEY)
  if (existing) return existing

  const nextId = randomId('session')
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
    lp_variant: stored.lp_variant || body.dataset.lpVariant || 'home_widget',
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
  const platform = getMobilePlatform()
  if (!platform) return

  const heroPair = document.querySelector('#hero-cta [data-store-pair]')
  if (!heroPair) return

  const matchingStore = platform === 'ios' ? 'app-store' : 'google-play'
  const primaryAnchor = heroPair.querySelector(`a[data-store="${matchingStore}"]`)
  if (!primaryAnchor) return

  const label = primaryAnchor.querySelector('.store-link-label')
  if (label) label.textContent = 'Abrir en la app'

  primaryAnchor.setAttribute('href', deepLink)
  primaryAnchor.setAttribute('data-deeplink-cta', '')
  primaryAnchor.addEventListener('click', (event) => {
    event.preventDefault()
    openAppWithStoreFallback(deepLink, { cta_placement: 'hero_deep_link' })
  })
}

function applyPlatformAttribute() {
  const platform = getMobilePlatform()
  if (platform) {
    document.documentElement.setAttribute('data-platform', platform)
  }
}

function rewriteStoreLinks() {
  document.querySelectorAll('[data-store-pair]').forEach((pair) => {
    const placement = pair.dataset.placement || 'unknown'
    pair.querySelectorAll('a[data-store]').forEach((anchor) => {
      const store = anchor.dataset.store
      const target = store === 'app-store' ? APP_STORE_REDIRECT : GOOGLE_PLAY_REDIRECT
      const targetPlatform = store === 'app-store' ? 'ios' : 'android'
      anchor.setAttribute('href', buildTrackedRedirectUrl(target, {
        cta_placement: placement,
        target_platform: targetPlatform
      }))
    })
  })
}

function setupStickyBar() {
  const stickyBar = document.getElementById('sticky-cta')
  const heroCta = document.getElementById('hero-cta')
  const closing = document.getElementById('cierre')
  if (!stickyBar || !heroCta || !closing) return

  const mobileQuery = window.matchMedia('(max-width: 767px)')
  let heroVisible = true
  let closingVisible = false
  let heroPassed = false

  const updateVisibility = () => {
    const shouldShow = mobileQuery.matches && heroPassed && !heroVisible && !closingVisible
    stickyBar.classList.toggle('is-visible', shouldShow)
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.target === heroCta) {
        heroVisible = entry.isIntersecting
        if (!entry.isIntersecting) {
          heroPassed = true
        }
      }
      if (entry.target === closing) {
        closingVisible = entry.isIntersecting
      }
    })
    updateVisibility()
  })

  observer.observe(heroCta)
  observer.observe(closing)

  if (typeof mobileQuery.addEventListener === 'function') {
    mobileQuery.addEventListener('change', updateVisibility)
  }
}

function loadMetaPixel(pixelId) {
  if (typeof window.fbq === 'function') {
    window.fbq('init', pixelId)
    window.fbq('track', 'PageView')
    return
  }

  const queueFn = function () {
    if (queueFn.callMethod) {
      queueFn.callMethod.apply(queueFn, arguments)
    } else {
      queueFn.queue.push(arguments)
    }
  }

  window.fbq = queueFn
  window._fbq = window._fbq || queueFn
  queueFn.push = queueFn
  queueFn.loaded = true
  queueFn.version = '2.0'
  queueFn.queue = []

  const script = document.createElement('script')
  script.async = true
  script.src = 'https://connect.facebook.net/en_US/fbevents.js'
  const firstScript = document.getElementsByTagName('script')[0]
  firstScript.parentNode.insertBefore(script, firstScript)

  window.fbq('init', pixelId)
  window.fbq('track', 'PageView')
}

function initMetaPixel() {
  const pixelId = document.querySelector('meta[name="hv-meta-pixel-id"]')?.content?.trim()
  if (!pixelId) return
  loadMetaPixel(pixelId)
}

function applyPrivacyLink() {
  const privacyUrl = document.querySelector('meta[name="hv-privacy-url"]')?.content?.trim()
  const link = document.getElementById('privacy-link')
  if (!privacyUrl || !link) return

  link.setAttribute('href', privacyUrl)
  link.removeAttribute('hidden')
}

function isInAppBrowser() {
  return INAPP_BROWSER_PATTERN.test(navigator.userAgent || '')
}

function maybeShowInAppHint() {
  if (!isInAppBrowser()) return

  window.setTimeout(() => {
    if (document.visibilityState !== 'visible') return

    const hint = document.getElementById('inapp-hint')
    if (!hint) return

    hint.removeAttribute('hidden')
    trackEvent('store_open_stalled', getBaseContext())
  }, INAPP_HINT_DELAY_MS)
}

function setFooterYear() {
  const yearEl = document.getElementById('footer-year')
  if (!yearEl) return
  yearEl.textContent = `${new Date().getFullYear()}`
}

function wireInAppHintDismiss() {
  const hint = document.getElementById('inapp-hint')
  const dismissButton = hint?.querySelector('[data-dismiss]')
  if (!hint || !dismissButton) return

  dismissButton.addEventListener('click', () => {
    hint.setAttribute('hidden', '')
  })
}

function wireStoreTaps() {
  document.querySelectorAll('a[data-store]').forEach((anchor) => {
    anchor.addEventListener('click', () => {
      if (anchor.hasAttribute('data-deeplink-cta')) return

      const store = anchor.dataset.store
      const placement = anchor.closest('[data-store-pair]')?.dataset.placement || 'unknown'
      const targetPlatform = store === 'app-store' ? 'ios' : 'android'

      if (typeof window.fbq === 'function') {
        window.fbq(
          'track',
          'Lead',
          { content_name: store, content_category: placement },
          { eventID: randomId('lead') }
        )
      }

      trackEvent('store_redirect', {
        ...getBaseContext(),
        cta_placement: placement,
        target_platform: targetPlatform
      })

      maybeShowInAppHint()
    })
  })
}

persistLandingContext()
applyPlatformAttribute()
rewriteStoreLinks()
setupStickyBar()
initMetaPixel()
applyPrivacyLink()
setFooterYear()
wireStoreTaps()
wireInAppHintDismiss()

const incomingDeepLink = getDeepLinkFromCurrentLocation()
if (incomingDeepLink) {
  replacePrimaryCtaForDeepLink(incomingDeepLink)
  openAppWithStoreFallback(incomingDeepLink, { cta_placement: 'deep_link_auto' })
}

trackEvent('landing_view', getBaseContext())
