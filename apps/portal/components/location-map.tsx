/**
 * Approximate location on an OpenStreetMap embed (no API key). The API rounds the coordinates,
 * so the pin marks the area, not the unit.
 */
export function LocationMap({
  lat,
  lng,
  radiusM,
  label,
}: {
  lat: number;
  lng: number;
  radiusM: number;
  label: string;
}) {
  // Show roughly 3x the uncertainty around the point.
  const d = Math.max(0.006, (radiusM * 3) / 111_000);
  const bbox = [lng - d, lat - d * 0.8, lng + d, lat + d * 0.8].map((v) => v.toFixed(5)).join(',');
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  const google = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  return (
    <section aria-labelledby="location">
      <h2 id="location" className="text-lg font-semibold">
        Location
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {label}. The pin shows the area, within about{' '}
        {radiusM >= 1000 ? `${radiusM / 1000} km` : `${radiusM} m`}; ask the agent for the exact
        address.
      </p>
      <iframe
        title={`Map of ${label}`}
        src={src}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="mt-3 h-72 w-full rounded-xl border border-border"
      />
      <div className="mt-2 flex gap-4 text-sm">
        <a href={google} target="_blank" rel="noopener noreferrer" className="text-primary">
          Open in Google Maps
        </a>
        <a
          href={`https://www.google.com/maps/search/schools/@${lat},${lng},15z`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary"
        >
          Schools nearby
        </a>
        <a
          href={`https://www.google.com/maps/search/metro+station/@${lat},${lng},15z`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary"
        >
          Metro nearby
        </a>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Map data ©{' '}
        <a href="https://www.openstreetmap.org/copyright" className="underline">
          OpenStreetMap contributors
        </a>
      </p>
    </section>
  );
}
