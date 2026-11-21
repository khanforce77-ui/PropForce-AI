'use client';

import { Check, Link2, Share2 } from 'lucide-react';
import { useState } from 'react';

/** Share a listing: the phone's share sheet where there is one, otherwise WhatsApp or copy link. */
export function ShareButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const btn =
    'inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:border-primary hover:text-primary';
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Cancelled: fall through to copying.
      }
    }
    await copy();
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: nothing else to do */
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={share} className={btn}>
        <Share2 className="h-4 w-4" aria-hidden /> Share
      </button>
      <a
        className={btn}
        href={`https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        WhatsApp
      </a>
      <button type="button" onClick={copy} className={btn} aria-live="polite">
        {copied ? (
          <Check className="h-4 w-4" aria-hidden />
        ) : (
          <Link2 className="h-4 w-4" aria-hidden />
        )}
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}
