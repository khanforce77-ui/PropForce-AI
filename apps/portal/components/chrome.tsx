import { Heart } from 'lucide-react';
import Link from 'next/link';
import { SITE_NAME } from '@/lib/config';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-bold tracking-tight text-primary"
        >
          <img
            src="/brand/propforce-logo.svg"
            alt=""
            width={32}
            height={32}
            className="rounded-md"
          />
          {SITE_NAME}
        </Link>
        <nav className="flex gap-4 text-sm font-medium">
          <Link href="/for-sale" className="hover:text-primary">
            Buy
          </Link>
          <Link href="/for-rent" className="hover:text-primary">
            Rent
          </Link>
          <Link href="/new-projects" className="hidden hover:text-primary sm:inline">
            New projects
          </Link>
        </nav>
        <Link
          href="/saved"
          className="ml-auto inline-flex items-center gap-1 text-sm font-medium hover:text-primary"
        >
          <Heart className="h-4 w-4" aria-hidden /> Saved
        </Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-muted">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 text-sm text-muted-foreground sm:grid-cols-2">
        <div>
          <p className="font-semibold text-foreground">{SITE_NAME}</p>
          <p className="mt-1">
            Listings are published by licensed agencies. Every listing shows its advertising permit,
            the agent&apos;s BRN and the agency&apos;s ORN where provided.
          </p>
        </div>
        <div className="flex gap-4 sm:justify-end">
          <Link href="/new-projects" className="hover:text-foreground">
            New projects
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/for-sale" className="hover:text-foreground">
            Buy
          </Link>
          <Link href="/for-rent" className="hover:text-foreground">
            Rent
          </Link>
        </div>
      </div>
    </footer>
  );
}
