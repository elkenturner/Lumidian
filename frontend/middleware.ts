import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Paths that don't require auth
const PUBLIC_PATHS = ['/', '/login', '/register', '/onboarding'];
// Paths that redirect to /dashboard if already authenticated
const AUTH_REDIRECT_PATHS = ['/login', '/register'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get('clarity_session')?.value;
  const isAuthenticated = session === '1';

  // If on landing page and authenticated → go to dashboard
  if (pathname === '/' && isAuthenticated) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // If on login/register and authenticated → go to dashboard
  if (AUTH_REDIRECT_PATHS.includes(pathname) && isAuthenticated) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // If on a protected route and not authenticated → go to login
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (!isAuthenticated && !isPublic) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)',
  ],
};
