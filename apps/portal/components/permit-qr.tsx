import QRCode from 'qrcode';

/** Only https links on UAE government hosts are drawn (the API enforces the same rule). */
export function isGovLink(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (host === 'gov.ae' || host.endsWith('.gov.ae'));
  } catch {
    return false;
  }
}

/** The regulator's permit QR code, drawn on the server as inline SVG from the permit link. */
export async function PermitQr({ url, label }: { url: string; label: string }) {
  if (!isGovLink(url)) return null;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-block rounded-lg border border-border bg-white p-1"
      aria-label={label}
      title={label}
    >
      <span
        className="block h-28 w-28 [&>svg]:h-full [&>svg]:w-full"
        // The SVG comes from the qrcode library, built from a validated URL.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </a>
  );
}
