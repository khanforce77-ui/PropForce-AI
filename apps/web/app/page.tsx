import { EMIRATES } from '@propforce/contracts';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6">
      <p className="text-sm font-medium tracking-wide text-primary uppercase">PropForce AI</p>
      <h1 className="text-4xl font-semibold tracking-tight">
        The operating system for UAE real estate brokerages
      </h1>
      <p className="text-lg text-muted-foreground">
        Inventory, CRM, WhatsApp, viewings and deals in one place, with AI that answers only from
        your verified listings.
      </p>
      <div className="rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
        Development build. Sign-in and agency onboarding arrive in the next milestone. Supported
        emirates are configured per installation ({EMIRATES.length} available).
      </div>
    </main>
  );
}
