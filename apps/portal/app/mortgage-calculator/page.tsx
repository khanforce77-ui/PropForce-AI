import type { Metadata } from 'next';
import { MortgageCalculator } from '@/components/mortgage-calculator';

export const metadata: Metadata = {
  title: 'Mortgage calculator UAE',
  description:
    'Estimate your monthly mortgage payment and the one-off costs of buying a home in Dubai or Abu Dhabi.',
  alternates: { canonical: '/mortgage-calculator' },
};

export default function MortgagePage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Mortgage calculator</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        See what a home would cost you each month, and what to budget for fees on the day.
      </p>
      <div className="rounded-2xl border border-border p-5">
        <MortgageCalculator />
      </div>
    </div>
  );
}
