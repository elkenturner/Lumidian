'use client';

import { useEffect } from 'react';

export default function LoginRedirectPage() {
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_APEX_LOGIN_URL || 'http://localhost:3000/login';
    window.location.href = url;
  }, []);

  return (
    <div className="p-8 text-sm text-muted-foreground">
      Redirecting to Lumidian login…
    </div>
  );
}
