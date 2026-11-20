import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">This property is no longer available</h1>
      <p className="mt-2 text-muted-foreground">
        It may have been sold, rented or taken off the market.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
      >
        Search other properties
      </Link>
    </div>
  );
}
