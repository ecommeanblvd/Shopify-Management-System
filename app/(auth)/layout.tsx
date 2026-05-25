import { Diamond, ShieldCheck, Workflow, Globe2 } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid md:grid-cols-2">
      {/* Brand panel — hidden on mobile */}
      <aside className="hidden md:flex flex-col justify-between p-10 lg:p-14 bg-foreground text-background relative overflow-hidden">
        <div className="absolute -top-24 -right-24 size-80 rounded-full bg-primary/40 blur-3xl pointer-events-none" aria-hidden />
        <div className="absolute -bottom-32 -left-20 size-72 rounded-full bg-primary/30 blur-3xl pointer-events-none" aria-hidden />

        <div className="relative">
          <div className="inline-flex items-center gap-2 font-semibold">
            <Diamond className="size-5" />
            Shopify Management
          </div>
        </div>

        <div className="relative space-y-8">
          <h2 className="text-3xl lg:text-4xl font-semibold tracking-tight max-w-md leading-tight">
            One workspace for every Shopify store you run.
          </h2>
          <ul className="space-y-3 text-sm text-background/80 max-w-md">
            <BrandPoint icon={<Workflow className="size-4" />} label="Author shipping + checkout templates, push them with diff-preview and one-click rollback." />
            <BrandPoint icon={<Globe2 className="size-4" />} label="Region templates with per-store overrides — apply to a single store or every store at once." />
            <BrandPoint icon={<ShieldCheck className="size-4" />} label="Encrypted tokens, scoped RBAC, full audit log on every apply." />
          </ul>
        </div>

        <div className="relative text-xs text-background/50">
          © {new Date().getFullYear()} ECC
        </div>
      </aside>

      {/* Form panel */}
      <main className="flex items-center justify-center p-6 md:p-10 bg-background">
        <div className="w-full max-w-sm space-y-6">
          {/* Mobile brand */}
          <div className="md:hidden inline-flex items-center gap-2 font-semibold">
            <Diamond className="size-5" />
            Shopify Management
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function BrandPoint({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="size-7 rounded-lg bg-background/10 backdrop-blur flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </span>
      <span>{label}</span>
    </li>
  );
}
