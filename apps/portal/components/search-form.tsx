import type { Facets } from '@/lib/api';
import { FURNISHING_LABEL, TYPE_LABEL, type Purpose } from '@/lib/format';

type Values = Record<string, string | undefined>;

const field =
  'h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus:outline-2 focus:outline-primary';

const PRICE_STEPS: Record<Purpose, number[]> = {
  sale: [
    500_000, 750_000, 1_000_000, 1_500_000, 2_000_000, 3_000_000, 5_000_000, 10_000_000, 20_000_000,
  ],
  rent: [30_000, 50_000, 75_000, 100_000, 150_000, 200_000, 300_000, 500_000],
};

const money = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}K`);

/**
 * Plain HTML form (works without JavaScript); /search sends it on to /for-sale or /for-rent so
 * results have stable, shareable, crawlable URLs.
 */
export function SearchForm({
  facets,
  values = {},
  purpose = 'sale',
  compact = false,
}: {
  facets: Facets | null;
  values?: Values;
  purpose?: Purpose;
  compact?: boolean;
}) {
  const v = (k: string) => values[k] ?? '';
  return (
    <form
      action="/search"
      method="get"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
      role="search"
    >
      <label className="sr-only" htmlFor="purpose">
        Buy or rent
      </label>
      <select id="purpose" name="purpose" defaultValue={purpose} className={field}>
        <option value="sale">Buy</option>
        <option value="rent">Rent</option>
      </select>

      <label className="sr-only" htmlFor="community">
        Location
      </label>
      <input
        id="community"
        name="community"
        list="communities"
        placeholder="Community, e.g. Dubai Marina"
        defaultValue={v('community')}
        className={`${field} lg:col-span-2`}
        autoComplete="off"
      />
      <datalist id="communities">
        {facets?.communities.map((c) => (
          <option key={`${c.emirate}-${c.community}`} value={c.community}>
            {c.emirate} ({c.count})
          </option>
        ))}
      </datalist>

      <label className="sr-only" htmlFor="type">
        Property type
      </label>
      <select id="type" name="type" defaultValue={v('type')} className={field}>
        <option value="">All types</option>
        {Object.entries(TYPE_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="beds">
        Bedrooms
      </label>
      <select id="beds" name="beds" defaultValue={v('beds')} className={field}>
        <option value="">Any beds</option>
        <option value="0">Studio</option>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <option key={n} value={n}>
            {n} {n === 1 ? 'Bed' : 'Beds'}
          </option>
        ))}
        <option value="7">7+ Beds</option>
      </select>

      <button
        type="submit"
        className="h-11 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        Search
      </button>

      {compact ? null : (
        <>
          <label className="sr-only" htmlFor="emirate">
            Emirate
          </label>
          <select id="emirate" name="emirate" defaultValue={v('emirate')} className={field}>
            <option value="">All emirates</option>
            {facets?.emirates.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="minPrice">
            Minimum price
          </label>
          <select id="minPrice" name="minPrice" defaultValue={v('minPrice')} className={field}>
            <option value="">Min price (AED)</option>
            {PRICE_STEPS[purpose].map((n) => (
              <option key={n} value={n}>
                {money(n)}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="maxPrice">
            Maximum price
          </label>
          <select id="maxPrice" name="maxPrice" defaultValue={v('maxPrice')} className={field}>
            <option value="">Max price (AED)</option>
            {PRICE_STEPS[purpose].map((n) => (
              <option key={n} value={n}>
                {money(n)}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="completion">
            Completion
          </label>
          <select
            id="completion"
            name="completion"
            defaultValue={v('completion')}
            className={field}
          >
            <option value="">Ready and off-plan</option>
            <option value="ready">Ready</option>
            <option value="off_plan">Off-plan</option>
          </select>
          <label className="sr-only" htmlFor="furnished">
            Furnishing
          </label>
          <select id="furnished" name="furnished" defaultValue={v('furnished')} className={field}>
            <option value="">Any furnishing</option>
            {Object.entries(FURNISHING_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="baths">
            Bathrooms
          </label>
          <select id="baths" name="baths" defaultValue={v('baths')} className={field}>
            <option value="">Any baths</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}+ {n === 1 ? 'Bath' : 'Baths'}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="minArea">
            Minimum area (sqft)
          </label>
          <input
            id="minArea"
            name="minArea"
            type="number"
            min={0}
            step={50}
            inputMode="numeric"
            placeholder="Min area (sqft)"
            defaultValue={v('minArea')}
            className={field}
          />
          <label className="sr-only" htmlFor="maxArea">
            Maximum area (sqft)
          </label>
          <input
            id="maxArea"
            name="maxArea"
            type="number"
            min={0}
            step={50}
            inputMode="numeric"
            placeholder="Max area (sqft)"
            defaultValue={v('maxArea')}
            className={field}
          />
          {facets?.amenities && facets.amenities.length > 0 ? (
            <>
              <label className="sr-only" htmlFor="amenity">
                Amenity
              </label>
              <select id="amenity" name="amenity" defaultValue={v('amenity')} className={field}>
                <option value="">Any amenities</option>
                {facets.amenities.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name} ({a.count})
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <label className="sr-only" htmlFor="q">
            Keywords
          </label>
          <input
            id="q"
            name="q"
            type="search"
            maxLength={100}
            placeholder="Keywords, building or reference"
            defaultValue={v('q')}
            className={`${field} lg:col-span-2`}
          />
          <label className="sr-only" htmlFor="sort">
            Sort
          </label>
          <select id="sort" name="sort" defaultValue={v('sort') || 'newest'} className={field}>
            <option value="newest">Newest</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
          </select>
          {values.agency ? <input type="hidden" name="agency" value={values.agency} /> : null}
          {values.agent ? <input type="hidden" name="agent" value={values.agent} /> : null}
        </>
      )}
    </form>
  );
}
