'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserPlus, AlertCircle } from 'lucide-react';
import { authClient } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: signUpError } = await authClient.signUp.email({ email, password, name });
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message ?? 'Sign-up failed');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          The first user to sign up is granted admin. Subsequent users have no role until an admin assigns one.
        </p>
      </div>

      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="name" className="text-xs uppercase tracking-wider text-muted-foreground">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Lê Minh Tiệp" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">Password</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
          <p className="text-xs text-muted-foreground">Minimum 8 characters.</p>
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 text-destructive px-4 py-3 text-sm flex items-start gap-2">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full gap-2" disabled={loading}>
          <UserPlus className="size-4" />
          {loading ? 'Creating…' : 'Create account'}
        </Button>
      </form>

      <p className="text-sm text-center text-muted-foreground">
        Already have an account? <Link href="/sign-in" className="text-primary hover:underline font-medium">Sign in</Link>
      </p>
    </div>
  );
}
