import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get('clarity_session')?.value;
  const isAuthenticated = session === '1';

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (!isAuthenticated && !isPublic) {
    const apexLoginUrl =
      process.env.NEXT_PUBLIC_APEX_LOGIN_URL || 'http://localhost:3000/login';
    return NextResponse.redirect(new URL(apexLoginUrl));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)'],
};
