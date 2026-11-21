'use client';

import Script from 'next/script';
import { useEffect, useRef } from 'react';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

/** True once Cloudflare Turnstile keys are configured; until then forms rely on honeypot + rate limits. */
export const captchaEnabled = Boolean(SITE_KEY);

/**
 * Cloudflare Turnstile check. Renders nothing until NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. The
 * token goes to onToken; it is single-use, so call the returned reset after each submit.
 */
export function Turnstile({
  onToken,
  resetSignal = 0,
}: {
  onToken: (token: string | null) => void;
  /** Change this number to get a fresh token (tokens are single-use). */
  resetSignal?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const tokenCb = useRef(onToken);
  tokenCb.current = onToken;

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;
    const mount = () => {
      if (cancelled || widget.current || !box.current) return;
      if (!window.turnstile) {
        setTimeout(mount, 200);
        return;
      }
      widget.current = window.turnstile.render(box.current, {
        sitekey: SITE_KEY,
        callback: (t: string) => tokenCb.current(t),
        'expired-callback': () => tokenCb.current(null),
        'error-callback': () => tokenCb.current(null),
      });
    };
    mount();
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetSignal && widget.current && window.turnstile) {
      window.turnstile.reset(widget.current);
      tokenCb.current(null);
    }
  }, [resetSignal]);

  if (!SITE_KEY) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
      />
      <div ref={box} />
    </>
  );
}
