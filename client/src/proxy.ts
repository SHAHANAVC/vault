import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Proxy (Next.js 16 convention replacing middleware)
 * Protects application routes and performs auth redirects.
 * Note: Reads the HTTP-only `token` cookie.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get('token')?.value;

  const isAuthRoute = pathname === '/login' || pathname === '/register';
  const isInviteRoute = pathname.startsWith('/invite');
  const isPublicApi =
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico';

  if (isPublicApi) {
    return NextResponse.next();
  }

  // If user is authenticated and tries to visit /login or /register, redirect to dashboard
  if (token && isAuthRoute) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // If user is NOT authenticated and attempts to access protected routes, redirect to login
  if (!token && !isAuthRoute && !isInviteRoute) {
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') {
      loginUrl.searchParams.set('redirect', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const middleware = proxy;

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
