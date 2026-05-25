'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogIn, AlertCircle } from 'lucide-react';
import { authClient } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: signInError } = await authClient.signIn.email({ email, password });
    setLoading(false);
    if (signInError) {
      setError(signInError.message ?? 'Sign-in failed');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to continue managing your stores.</p>
      </div>

      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">Password</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 text-destructive px-4 py-3 text-sm flex items-start gap-2">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full gap-2" disabled={loading}>
          <LogIn className="size-4" />
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="text-sm text-center text-muted-foreground">
        Need an account? <Link href="/sign-up" className="text-primary hover:underline font-medium">Sign up</Link>
      </p>
    </div>
  );
}
