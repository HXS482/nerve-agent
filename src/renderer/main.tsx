import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

// highlight.js theme will be loaded dynamically based on theme
function loadHighlightTheme(theme: string) {
  const existing = document.getElementById('hljs-theme')
  if (existing) existing.remove()

  const link = document.createElement('link')
  link.id = 'hljs-theme'
  link.rel = 'stylesheet'
  link.href =
    theme === 'light'
      ? 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github.min.css'
      : 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github-dark.min.css'
  document.head.appendChild(link)
}

// Load initial theme
const savedTheme = (() => {
  try {
    const raw = localStorage.getItem('nerve-state')
    if (raw) {
      const parsed = JSON.parse(raw)
      return parsed?.state?.theme || 'dark'
    }
  } catch {}
  return 'dark'
})()

document.documentElement.setAttribute('data-theme', savedTheme)
loadHighlightTheme(savedTheme)

// Watch for theme changes via MutationObserver
const observer = new MutationObserver(() => {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark'
  loadHighlightTheme(theme)
})
observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
