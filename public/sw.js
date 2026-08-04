/*
 * Minimal service worker.
 *
 * Deliberately conservative: it caches the app shell so the PWA opens instantly
 * and survives a dead signal, but it never caches API responses. Stale
 * financial data shown as if it were current is worse than a loading spinner.
 *
 * Offline transaction queueing is a planned follow-up — see docs/ARCHITECTURE.md.
 */

const SHELL_CACHE = 'together-shell-v1'
const SHELL_ASSETS = ['/', '/add', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/auth')) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (request.mode === 'navigate' && response.ok) {
          const copy = response.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match('/'))),
  )
})
