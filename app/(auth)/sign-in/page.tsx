'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { authClient } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';

export default function SignInPage() {
  return (
    <Suspense fallback={<SignInForm errorCode={null} />}>
      <SignInWithParams />
    </Suspense>
  );
}

function SignInWithParams() {
  const params = useSearchParams();
  return <SignInForm errorCode={params.get('error')} />;
}

function SignInForm({ errorCode }: { errorCode: string | null }) {
  const [loading, setLoading] = useState(false);

  async function signInWithGoogle() {
    setLoading(true);
    // errorCallbackURL routes failed sign-ins (incl. the closed-invite gate
    // rejecting an uninvited email) back here with an ?error= code.
    await authClient.signIn.social({
      provider: 'google',
      callbackURL: '/',
      errorCallbackURL: '/sign-in',
    });
    setLoading(false);
  }

  const message = errorMessage(errorCode);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Đăng nhập để tiếp tục quản lý các store.</p>
      </div>

      {message && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 text-destructive px-4 py-3 text-sm flex items-start gap-2">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span>{message}</span>
        </div>
      )}

      <Button type="button" size="lg" className="w-full gap-2" disabled={loading} onClick={signInWithGoogle}>
        <GoogleIcon />
        {loading ? 'Đang chuyển hướng…' : 'Đăng nhập với Google'}
      </Button>
    </div>
  );
}

/** Map better-auth OAuth error codes to a Vietnamese message. The closed-invite
 *  gate aborts user creation for uninvited emails, surfacing as
 *  `unable_to_create_user`. */
function errorMessage(code: string | null): string | null {
  if (!code) return null;
  if (code === 'unable_to_create_user') {
    return 'Email của bạn chưa được mời vào hệ thống. Liên hệ quản trị viên để được cấp quyền.';
  }
  return 'Đăng nhập thất bại. Vui lòng thử lại.';
}

function GoogleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}
