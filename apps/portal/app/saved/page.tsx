import type { Metadata } from 'next';
import { SavedList } from './saved-list';

export const metadata: Metadata = { title: 'Saved properties', robots: { index: false } };

export default function SavedPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">Saved properties</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Kept in this browser only. Clearing your browser data removes them.
      </p>
      <SavedList />
    </div>
  );
}
