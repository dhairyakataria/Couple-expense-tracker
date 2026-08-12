import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

type CookiesToSet = { name: string; value: string; options: CookieOptions }[]

const PUBLIC_PATHS = ['/login', '/auth', '/invite', '/manifest.webmanifest', '/sw.js', '/icons']

export async function updateSession(request: NextRequest) {
  let cookiesToApply: CookiesToSet = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: CookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          cookiesToApply = cookiesToSet
        },
      },
    },
  )

  // getUser() revalidates the token with Supabase. Do not swap this for
  // getSession(), which trusts the cookie without verifying it.
  //
  // This is the one network round trip to the Auth server that every
  // request pays for authorization. We stash the verified id/email on
  // request headers below so Server Components and Server Actions can
  // trust them for the rest of this request instead of each calling
  // getUser() again and paying for a second round trip.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Any refreshed session cookies from getUser() above must ride along on
  // whichever response we return — including redirects. Dropping them here
  // would strand the browser with a stale, already-rotated refresh token.
  const withCookies = (response: NextResponse) => {
    for (const { name, value, options } of cookiesToApply) {
      response.cookies.set(name, value, options)
    }
    return response
  }

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', path)
    return withCookies(NextResponse.redirect(url))
  }

  if (user && path === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return withCookies(NextResponse.redirect(url))
  }

  const requestHeaders = new Headers(request.headers)
  if (user) {
    requestHeaders.set('x-user-id', user.id)
    requestHeaders.set('x-user-email', user.email ?? '')
  } else {
    requestHeaders.delete('x-user-id')
    requestHeaders.delete('x-user-email')
  }

  return withCookies(NextResponse.next({ request: { headers: requestHeaders } }))
}
