import { NextResponse } from 'next/server';

/**
 * Sets the httpOnly clarity_token cookie directly from the Next.js server.
 * Used by admin impersonation to guarantee cookie is set even if the
 * backend's Set-Cookie headers don't survive the Next.js rewrite proxy.
 *
 * This Route Handler takes priority over the /api rewrite (afterFiles),
 * so it's handled by Next.js, not forwarded to the backend.
 */
export async function POST(request: Request) {
  const { token } = await request.json();
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Token required' }, { status: 400 });
  }

  const isProduction =
    process.env.ENVIRONMENT === 'production' || process.env.NODE_ENV === 'production';

  const response = NextResponse.json({ ok: true });

  response.cookies.set('clarity_token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });
  response.cookies.set('clarity_session', '1', {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });

  return response;
}
