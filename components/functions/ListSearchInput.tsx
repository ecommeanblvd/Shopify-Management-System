/**
 * Tiny server-renderable search input. Submits the form to the parent
 * page via a `q=` query param; clearing navigates back to the bare URL.
 * No client JS — relies on default browser form submission so the URL
 * stays canonical and the search is bookmarkable.
 *
 * The `formAction` is the URL of the page rendering the input — the
 * caller passes it explicitly so the input doesn't have to read
 * the route from React context.
 */

import Link from 'next/link';
import { Search, X } from 'lucide-react';

interface ListSearchInputProps {
  formAction: string;
  currentQuery?: string;
  placeholder?: string;
}

export function ListSearchInput({ formAction, currentQuery, placeholder }: ListSearchInputProps) {
  return (
    <form action={formAction} method="get" className="flex items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="search"
          name="q"
          defaultValue={currentQuery ?? ''}
          placeholder={placeholder ?? 'Search…'}
          className="pl-8 pr-3 py-1.5 text-xs w-48 md:w-64 rounded-md border border-border bg-transparent focus:outline-none focus:ring-1 focus:ring-foreground/20"
          autoComplete="off"
        />
      </div>
      {currentQuery && (
        <Link
          href={formAction}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <X className="size-3" />
          Clear
        </Link>
      )}
    </form>
  );
}
