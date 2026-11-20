import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-border bg-background p-6 shadow-sm', className)}
      {...props}
    />
  );
}

export function Alert({
  tone = 'error',
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: 'error' | 'success' | 'info' }) {
  const tones = {
    error:
      'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
    success:
      'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    info: 'border-border bg-muted text-foreground',
  };
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-lg border px-3 py-2 text-sm', tones[tone], className)}
      {...props}
    />
  );
}
