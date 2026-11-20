import { z } from 'zod';
import type { PropertyFact } from '../types';

/**
 * Structured final output the model must return. `claims` lists every property fact the reply
 * states, so the validator can check them against this turn's tool results.
 */
export const finalOutputSchema = z
  .object({
    reply: z.string().trim().min(1).max(1500),
    language: z.enum(['en', 'ar']),
    citedPropertyIds: z.array(z.string()).max(10),
    claims: z
      .array(
        z
          .object({
            propertyId: z.string(),
            field: z.enum(['price', 'bedrooms', 'areaSqft', 'community', 'status']),
            value: z.union([z.string().max(200), z.number()]),
          })
          .strict(),
      )
      .max(50),
    requestHandover: z.boolean(),
  })
  .strict();
export type FinalOutput = z.infer<typeof finalOutputSchema>;

/** Everything the reply may state as fact: tool-returned facts plus figures the client said. */
export interface FactLedger {
  readonly properties: ReadonlyMap<string, PropertyFact>;
  /** Other amounts returned by tools this turn (e.g. fee estimate lines), in AED. */
  readonly amountsAed: ReadonlySet<number>;
  /** Raw text the client wrote this turn; numbers in it may be echoed back. */
  readonly clientText: string;
}

export type GroundingResult =
  | { readonly ok: true; readonly output: FinalOutput }
  | { readonly ok: false; readonly reasons: readonly string[] };

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const toLatinDigits = (s: string) =>
  s
    .replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');

const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};
const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const UNIT = String.raw`\s?(k|mn|m|million|bn|b|billion)?(?![a-z])`;
const CURRENCY = String.raw`(?:aed|dhs?|dirhams?|د\.?\s?إ|درهم)`;

const parseAmount = (num: string, unit: string | undefined): number =>
  Number(num.replace(/,/g, '')) * (unit ? (MULTIPLIERS[unit.toLowerCase()] ?? 1) : 1);

/** Extracts AED amounts written as "AED 1.85M", "1,850,000 AED", "2 million dirhams", "د.إ 900k". */
export const extractAedAmounts = (text: string): number[] => {
  const t = toLatinDigits(text);
  const out: number[] = [];
  const before = new RegExp(`${CURRENCY}\\s?${NUM}${UNIT}`, 'giu');
  const after = new RegExp(`${NUM}${UNIT}\\s?${CURRENCY}`, 'giu');
  for (const m of t.matchAll(before)) out.push(parseAmount(m[1]!, m[2]));
  for (const m of t.matchAll(after)) out.push(parseAmount(m[1]!, m[2]));
  return out;
};

export const extractSqft = (text: string): number[] =>
  [
    ...toLatinDigits(text).matchAll(
      new RegExp(`${NUM}\\s?(?:sq\\.?\\s?ft|sqft|square\\s+feet|قدم\\s?مربع)`, 'giu'),
    ),
  ].map((m) => Number(m[1]!.replace(/,/g, '')));

export const extractBedrooms = (text: string): number[] =>
  [
    ...toLatinDigits(text).matchAll(
      /(\d{1,2})\s?-?\s?(?:br|bed(?:room)?s?|غرف(?:ة)?(?:\s?نوم)?)(?![a-z])/giu,
    ),
  ].map((m) => Number(m[1]));

/** Relative tolerance for rounded figures such as "AED 1.85M" for 1,849,500. */
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);

/**
 * Backstop for topics the AI must hand over instead of answering (PRD §8.2). The system prompt is
 * the primary control; this catches replies that slipped through.
 */
const ADVICE_PATTERNS: readonly RegExp[] = [
  /\b(guarantee[ds]?|guaranteed)\b.{0,40}\b(return|roi|yield|profit|approval|visa|appreciation)/i,
  /\byou (will|’ll|'ll) (definitely |certainly )?(get|qualify for|be eligible for)\b.{0,30}\b(visa|mortgage|loan|residency)/i,
  /\b(your|the) (mortgage|loan) (is|will be) approved\b/i,
  /\b(legal|tax) advice\b(?!.{0,40}\b(agent|specialist|lawyer|advisor|adviser)\b)/i,
];

const lower = (s: string) => s.trim().toLowerCase();

export const validateGrounding = (raw: unknown, ledger: FactLedger): GroundingResult => {
  const parsed = finalOutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reasons: ['Output did not match the required schema'] };
  const out = parsed.data;
  const reasons: string[] = [];

  for (const id of out.citedPropertyIds) {
    if (!ledger.properties.has(id))
      reasons.push(`Cited property ${id.slice(0, 40)} was not returned by a tool this turn`);
  }

  for (const c of out.claims) {
    const fact = ledger.properties.get(c.propertyId);
    if (!fact) {
      reasons.push(`Claim about unknown property ${c.propertyId.slice(0, 40)}`);
      continue;
    }
    const ok =
      c.field === 'price'
        ? fact.priceAed !== undefined &&
          typeof c.value === 'number' &&
          close(c.value, fact.priceAed)
        : c.field === 'bedrooms'
          ? fact.bedrooms !== undefined && Number(c.value) === fact.bedrooms
          : c.field === 'areaSqft'
            ? fact.areaSqft !== undefined &&
              typeof c.value === 'number' &&
              close(c.value, fact.areaSqft)
            : c.field === 'community'
              ? fact.community !== undefined && lower(String(c.value)) === lower(fact.community)
              : fact.status !== undefined && lower(String(c.value)) === lower(fact.status);
    if (!ok) reasons.push(`Claim ${c.field} for ${fact.reference} does not match the listing`);
  }

  // Free-text scan: every figure in the reply must come from tool results or the client's words.
  const facts = [...ledger.properties.values()];
  const knownAmounts = [
    ...facts.flatMap((f) => (f.priceAed !== undefined ? [f.priceAed] : [])),
    ...ledger.amountsAed,
    ...extractAedAmounts(ledger.clientText),
  ];
  for (const a of extractAedAmounts(out.reply)) {
    if (!knownAmounts.some((k) => close(a, k)))
      reasons.push(`Amount AED ${a} is not backed by a tool result`);
  }
  const knownSqft = [
    ...facts.flatMap((f) => (f.areaSqft !== undefined ? [f.areaSqft] : [])),
    ...extractSqft(ledger.clientText),
  ];
  for (const s of extractSqft(out.reply)) {
    if (!knownSqft.some((k) => close(s, k)))
      reasons.push(`Size ${s} sqft is not backed by a tool result`);
  }
  const knownBeds = new Set([
    ...facts.flatMap((f) => (f.bedrooms !== undefined ? [f.bedrooms] : [])),
    ...extractBedrooms(ledger.clientText),
  ]);
  for (const b of extractBedrooms(out.reply)) {
    if (!knownBeds.has(b)) reasons.push(`${b} bedrooms is not backed by a tool result`);
  }

  if (ADVICE_PATTERNS.some((re) => re.test(out.reply))) {
    reasons.push(
      'Reply gives advice the AI must hand over (legal, visa, mortgage, guaranteed returns)',
    );
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, output: out };
};
