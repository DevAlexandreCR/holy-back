// HolyVerso Landing Page - JavaScript

// Smooth scroll for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault()
    const target = document.querySelector(this.getAttribute('href'))
    if (target) {
      const offset = 80 // Navbar height
      const targetPosition = target.offsetTop - offset
      window.scrollTo({
        top: targetPosition,
        behavior: 'smooth'
      })
    }
  })
})

// Navbar background on scroll
const navbar = document.querySelector('.navbar')
let lastScroll = 0

window.addEventListener('scroll', () => {
  const currentScroll = window.pageYOffset

  if (currentScroll > 50) {
    navbar.style.background = 'rgba(26, 41, 64, 0.98)'
    navbar.style.boxShadow = '0 2px 20px rgba(244, 210, 122, 0.15)'
  } else {
    navbar.style.background = 'rgba(26, 41, 64, 0.95)'
    navbar.style.boxShadow = 'none'
  }

  lastScroll = currentScroll
})

// Intersection Observer for animations
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('aos-animate')
      // Unobserve after animation to prevent re-triggering
      observer.unobserve(entry.target)
    }
  })
}, observerOptions)

// Observe all elements with data-aos attribute
document.querySelectorAll('[data-aos]').forEach(el => {
  observer.observe(el)
})

// Create floating particles dynamically (estrellas brillantes)
function createParticles() {
  const particlesContainer = document.querySelector('.floating-particles')
  if (!particlesContainer) return

  const starCount = 100 // Estrellas
  const cometCount = 4 // Pocas cometas

  // Crear estrellas brillantes
  for (let i = 0; i < starCount; i++) {
    const particle = document.createElement('div')
    particle.className = 'particle star'

    const size = Math.random() * 2.5 + 0.8
    const isGolden = Math.random() > 0.65 // 35% doradas, más sutiles
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

  // Crear cometas pequeñas y brillantes
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
            left: ${-10}%;
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

// Add particle float animation to CSS dynamically
const style = document.createElement('style')
style.textContent = `
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
document.head.appendChild(style)

// Initialize particles
createParticles()

// Counter animation for stats
function animateCounter(element, target, duration = 2000) {
  const start = 0
  const increment = target / (duration / 16) // 60fps
  let current = start

  const timer = setInterval(() => {
    current += increment
    if (current >= target) {
      element.textContent = target
      clearInterval(timer)
    } else {
      // Format number based on target
      if (target >= 1000) {
        element.textContent = Math.floor(current / 1000) + 'K+'
      } else if (target.toString().includes('.')) {
        element.textContent = current.toFixed(1) + '★'
      } else {
        element.textContent = Math.floor(current)
      }
    }
  }, 16)
}

// Observe stats section
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
          stat.dataset.target = target
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

// Add parallax effect to hero
window.addEventListener('scroll', () => {
  const scrolled = window.pageYOffset
  const heroVisual = document.querySelector('.hero-visual')
  const lightRays = document.querySelector('.light-rays')

  if (heroVisual) {
    heroVisual.style.transform = `translateY(${scrolled * 0.3}px)`
  }

  if (lightRays) {
    lightRays.style.transform = `translateX(-50%) scale(${1 + scrolled * 0.0005})`
  }
})

// Add hover effect to feature cards
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

// Animate verse card text
function typeWriterEffect(element, text, speed = 50) {
  let i = 0
  element.textContent = ''

  function type() {
    if (i < text.length) {
      element.textContent += text.charAt(i)
      i++
      setTimeout(type, speed)
    }
  }

  type()
}

// Random verse rotation for demo
const verses = [
  {
    text: "Lámpara es a mis pies tu palabra, y lumbrera a mi camino.",
    reference: "Salmos 119:105"
  },
  {
    text: "Encomienda a Jehová tu camino, y confía en él; y él hará.",
    reference: "Salmos 37:5"
  },
  {
    text: "Todo lo puedo en Cristo que me fortalece.",
    reference: "Filipenses 4:13"
  },
  {
    text: "Porque yo sé los pensamientos que tengo acerca de vosotros.",
    reference: "Jeremías 29:11"
  }
]

let currentVerseIndex = 0

function rotateVerse() {
  const verseText = document.querySelector('.verse-text')
  const verseRef = document.querySelector('.verse-reference')

  if (verseText && verseRef) {
    // Fade out
    verseText.style.opacity = '0'
    verseRef.style.opacity = '0'

    setTimeout(() => {
      currentVerseIndex = (currentVerseIndex + 1) % verses.length
      verseText.textContent = verses[currentVerseIndex].text
      verseRef.textContent = `— ${verses[currentVerseIndex].reference}`

      // Fade in
      verseText.style.transition = 'opacity 0.5s ease'
      verseRef.style.transition = 'opacity 0.5s ease'
      verseText.style.opacity = '1'
      verseRef.style.opacity = '1'
    }, 500)
  }
}

// Rotate verse every 5 seconds
setInterval(rotateVerse, 5000)

// Add ripple effect to buttons
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

// Add ripple animation to CSS
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

// Lazy load images (if any are added later)
if ('IntersectionObserver' in window) {
  const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target
        img.src = img.dataset.src
        img.classList.add('loaded')
        imageObserver.unobserve(img)
      }
    })
  })

  document.querySelectorAll('img[data-src]').forEach(img => {
    imageObserver.observe(img)
  })
}

// Add loading animation
window.addEventListener('load', () => {
  document.body.classList.add('loaded')
})

// Performance optimization: throttle scroll events
function throttle(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// Add easter egg: Konami code
let konamiCode = []
const konamiSequence = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65] // ↑ ↑ ↓ ↓ ← → ← → B A

document.addEventListener('keydown', (e) => {
  konamiCode.push(e.keyCode)
  konamiCode.splice(-konamiSequence.length - 1, konamiCode.length - konamiSequence.length)

  if (konamiCode.join('').includes(konamiSequence.join(''))) {
    // Easter egg activated!
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

// Console message
console.log('%c🌟 HolyVerso', 'font-size: 24px; font-weight: bold; color: #F4D27A;')
console.log('%cLuz y Palabra para cada día ✨', 'font-size: 14px; color: #7EA9E1;')
console.log('%c\nDesarrollado con ❤️ para inspirar y guiar', 'font-size: 12px; color: #1A2940;')
