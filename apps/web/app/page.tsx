import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6">
      <div className="flex items-center gap-3">
        <img src="/brand/propforce-logo.svg" alt="" width={48} height={48} className="rounded-xl" />
        <p className="text-sm font-medium tracking-wide text-primary uppercase">PropForce AI</p>
      </div>
      <h1 className="text-4xl font-semibold tracking-tight">
        The operating system for UAE real estate brokerages
      </h1>
      <p className="text-lg text-muted-foreground">
        Inventory, CRM, WhatsApp, viewings and deals in one place, with AI that answers only from
        your verified listings.
      </p>
      <div className="flex gap-3">
        <Link
          href="/register"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Create your agency
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
