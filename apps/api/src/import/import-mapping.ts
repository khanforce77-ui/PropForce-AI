/**
 * Turns one spreadsheet row (header → cell text) into the body the normal create endpoints accept.
 * Headers are matched loosely ("Full Name", "full_name" and "Client name" all work) so exports from
 * other CRMs and portals can be imported without renaming columns. Anything not understood is
 * reported back per row; nothing is guessed silently.
 */

export type RawRow = Record<string, string | null | undefined>;
export interface Mapped<T> {
  value: T;
  /** Cell-level problems found while mapping (schema validation happens afterwards). */
  problems: string[];
  /** Email of the agent the row should go to, if a column names one. */
  agentEmail: string | null;
}

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Looks a field up by any of its aliases. */
function picker(row: RawRow) {
  const cells = new Map<string, string>();
  for (const [h, v] of Object.entries(row)) {
    const text = (v ?? '').trim();
    if (text) cells.set(key(h), text);
  }
  return (...aliases: string[]): string | null => {
    for (const a of aliases) {
      const v = cells.get(key(a));
      if (v) return v;
    }
    return null;
  };
}

const list = (v: string | null) =>
  v
    ? v
        .split(/[;|,]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

function number(v: string | null, field: string, problems: string[]): number | null | undefined {
  if (v == null) return undefined;
  const cleaned = v.replace(/aed|sq\.?\s*ft|sqft|,|\s/gi, '');
  if (/^studio$/i.test(cleaned)) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    problems.push(`${field}: "${v}" is not a number`);
    return undefined;
  }
  return n;
}

function int(v: string | null, field: string, problems: string[]) {
  const n = number(v, field, problems);
  if (n == null) return n;
  if (!Number.isInteger(n)) {
    problems.push(`${field}: "${v}" must be a whole number`);
    return undefined;
  }
  return n;
}

function oneOf<T extends string>(
  v: string | null,
  field: string,
  map: Record<string, T>,
  problems: string[],
): T | undefined {
  if (v == null) return undefined;
  const hit = map[key(v)];
  if (!hit) problems.push(`${field}: "${v}" is not recognised`);
  return hit;
}

const PROPERTY_TYPES: Record<string, string> = {
  apartment: 'apartment',
  apartments: 'apartment',
  flat: 'apartment',
  studio: 'apartment',
  hotelapartment: 'apartment',
  duplex: 'apartment',
  villa: 'villa',
  villas: 'villa',
  townhouse: 'townhouse',
  townhouses: 'townhouse',
  penthouse: 'penthouse',
  office: 'office',
  retail: 'retail',
  shop: 'retail',
  showroom: 'retail',
  commercial: 'commercial',
  warehouse: 'commercial',
  building: 'commercial',
  wholebuilding: 'commercial',
  land: 'land',
  plot: 'land',
  other: 'other',
};

const EMIRATES: Record<string, string> = {
  dubai: 'Dubai',
  dxb: 'Dubai',
  abudhabi: 'Abu Dhabi',
  auh: 'Abu Dhabi',
  sharjah: 'Sharjah',
  ajman: 'Ajman',
  rasalkhaimah: 'Ras Al Khaimah',
  rak: 'Ras Al Khaimah',
  fujairah: 'Fujairah',
  ummalquwain: 'Umm Al Quwain',
};
const emirate = (v: string | null) => (v ? (EMIRATES[key(v)] ?? v) : undefined);

function types(v: string | null, problems: string[]) {
  const items = list(v);
  if (!items) return undefined;
  const out = new Set<string>();
  for (const t of items) {
    const hit = PROPERTY_TYPES[key(t)];
    if (hit) out.add(hit);
    else problems.push(`Property type: "${t}" is not recognised`);
  }
  return [...out];
}

export interface ContactRow {
  contact: Record<string, unknown>;
  /** Present when the row describes what the client is looking for. */
  lead: Record<string, unknown> | null;
}

/** A contact and, when an intent column is filled, a lead for them. */
export function mapContactRow(row: RawRow): Mapped<ContactRow> {
  const get = picker(row);
  const problems: string[] = [];
  const first = get('first name', 'firstname');
  const last = get('last name', 'lastname', 'surname');
  const fullName =
    get('name', 'full name', 'client name', 'contact name', 'customer name') ??
    ([first, last].filter(Boolean).join(' ') || null);

  const contact: Record<string, unknown> = {
    fullName: fullName ?? '',
    phone:
      get('phone', 'mobile', 'phone number', 'mobile number', 'whatsapp', 'contact number') ?? null,
    email: get('email', 'email address', 'e-mail')?.toLowerCase() ?? null,
    nationality: get('nationality') ?? undefined,
    preferredLanguage: get('language', 'preferred language') ?? undefined,
    tags: list(get('tags', 'tag', 'labels')),
    notes: get('notes', 'note', 'comments', 'remarks') ?? undefined,
    source: 'import',
  };

  const intent = oneOf(
    get('intent', 'looking to', 'lead type', 'requirement', 'purpose'),
    'Intent',
    {
      buy: 'buy',
      buyer: 'buy',
      sale: 'buy',
      purchase: 'buy',
      rent: 'rent',
      tenant: 'rent',
      rental: 'rent',
      lease: 'rent',
      sell: 'sell',
      seller: 'sell',
      let: 'let',
      landlord: 'let',
    },
    problems,
  );
  let lead: Record<string, unknown> | null = null;
  if (intent) {
    const beds = int(get('bedrooms', 'beds'), 'Bedrooms', problems);
    const budget = number(get('budget'), 'Budget', problems);
    lead = {
      intent,
      source: 'import',
      emirate: emirate(get('emirate', 'city')),
      communities: list(get('communities', 'community', 'area', 'location', 'areas')),
      propertyTypes: types(get('property type', 'property types', 'type'), problems),
      bedroomsMin:
        int(get('beds min', 'min beds', 'bedrooms min', 'min bedrooms'), 'Min beds', problems) ??
        beds,
      bedroomsMax:
        int(get('beds max', 'max beds', 'bedrooms max', 'max bedrooms'), 'Max beds', problems) ??
        beds,
      budgetMin: number(get('budget min', 'min budget', 'min price'), 'Min budget', problems),
      budgetMax:
        number(get('budget max', 'max budget', 'max price'), 'Max budget', problems) ?? budget,
    };
    for (const k of Object.keys(lead)) if (lead[k] === undefined) delete lead[k];
  }
  for (const k of Object.keys(contact)) if (contact[k] === undefined) delete contact[k];
  return {
    value: { contact, lead },
    problems,
    agentEmail: get('agent email', 'agent', 'assigned to', 'owner email')?.toLowerCase() ?? null,
  };
}

/** A listing, always created as a draft (going live needs a permit). */
export function mapListingRow(row: RawRow): Mapped<Record<string, unknown>> {
  const get = picker(row);
  const problems: string[] = [];
  const listingType = oneOf(
    get('listing type', 'purpose', 'offering type', 'for', 'type of listing'),
    'Listing type',
    {
      sale: 'sale',
      sell: 'sale',
      buy: 'sale',
      forsale: 'sale',
      rs: 'sale',
      cs: 'sale',
      rent: 'rent',
      rental: 'rent',
      forrent: 'rent',
      tolet: 'rent',
      lease: 'rent',
      rr: 'rent',
      cr: 'rent',
    },
    problems,
  );
  const ptype = get('property type', 'type', 'category');
  const propertyType = ptype ? oneOf(ptype, 'Property type', PROPERTY_TYPES, problems) : undefined;
  const value: Record<string, unknown> = {
    reference:
      get('reference', 'ref', 'reference number', 'ref no', 'listing reference') ?? undefined,
    title: get('title', 'listing title', 'headline') ?? undefined,
    listingType,
    propertyType,
    completion: oneOf(
      get('completion', 'completion status'),
      'Completion',
      { ready: 'ready', completed: 'ready', offplan: 'off_plan' },
      problems,
    ),
    emirate: emirate(get('emirate', 'city')),
    community: get('community', 'area', 'location') ?? undefined,
    subCommunity: get('sub community', 'subcommunity', 'sub-community') ?? undefined,
    building: get('building', 'tower', 'building name') ?? undefined,
    unitNo: get('unit', 'unit no', 'unit number') ?? undefined,
    bedrooms: int(get('bedrooms', 'beds'), 'Bedrooms', problems),
    bathrooms: int(get('bathrooms', 'baths'), 'Bathrooms', problems),
    areaSqft: number(
      get('size', 'area sqft', 'size sqft', 'built up area', 'bua'),
      'Size',
      problems,
    ),
    price: number(get('price', 'price aed', 'asking price', 'rent'), 'Price', problems),
    rentPeriod: oneOf(
      get('rent period', 'rent frequency', 'frequency'),
      'Rent period',
      {
        yearly: 'yearly',
        year: 'yearly',
        annual: 'yearly',
        annually: 'yearly',
        monthly: 'monthly',
        month: 'monthly',
      },
      problems,
    ),
    furnishing: oneOf(
      get('furnishing', 'furnished'),
      'Furnishing',
      {
        unfurnished: 'unfurnished',
        no: 'unfurnished',
        semifurnished: 'semi_furnished',
        partlyfurnished: 'semi_furnished',
        furnished: 'furnished',
        yes: 'furnished',
      },
      problems,
    ),
    parking: int(get('parking', 'parking spaces'), 'Parking', problems),
    view: get('view') ?? undefined,
    developer: get('developer') ?? undefined,
    description: get('description', 'details') ?? undefined,
    amenities: list(get('amenities', 'features')),
  };
  for (const k of Object.keys(value)) if (value[k] === undefined) delete value[k];
  return {
    value,
    problems,
    agentEmail: get('agent email', 'agent', 'assigned to')?.toLowerCase() ?? null,
  };
}
