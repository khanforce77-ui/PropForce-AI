import type { AgencyDocumentType } from '@propforce/db';
import { DOCUMENT_LABELS, type KycChecklist } from './kyc-rules';
import { kycReadingSchema, type KycReading } from './kyc-reader';

export type FindingSeverity = 'problem' | 'warning' | 'info';
export interface KycFinding {
  severity: FindingSeverity;
  documentId?: string;
  subject: string;
  message: string;
}

interface FindingDoc {
  id: string;
  type: AgencyDocumentType;
  ownerId: string | null;
  employeeId: string | null;
  label: string | null;
  documentNumber: string | null;
  expiresAt: Date | null;
  status: string;
  aiStatus: string;
  aiResult: unknown;
}
interface FindingInput {
  agency: { name: string; tradeLicenseNo: string | null; orn: string | null };
  owners: { id: string; fullName: string }[];
  employees: { id: string; fullName: string; brn: string | null; isBroker: boolean }[];
  documents: FindingDoc[];
  checklist?: KycChecklist;
  now?: Date;
}

/** What each of our document types should be read as. */
const EXPECTED_KIND: Record<AgencyDocumentType, KycReading['documentKind'][]> = {
  trade_license: ['trade_license'],
  moa: ['moa'],
  ejari: ['ejari'],
  orn_certificate: ['orn_certificate'],
  owner_passport: ['passport'],
  owner_emirates_id: ['emirates_id'],
  employee_brn_card: ['broker_card'],
  employee_emirates_id: ['emirates_id'],
  permit: ['permit', 'orn_certificate', 'other'],
  employee_list: ['employee_list', 'other'],
};
const KIND_NAMES: Record<KycReading['documentKind'], string> = {
  trade_license: 'a trade licence',
  moa: 'an MOA',
  ejari: 'an Ejari',
  orn_certificate: 'an ORN card',
  passport: 'a passport',
  emirates_id: 'an Emirates ID',
  broker_card: 'a broker card',
  permit: 'a permit',
  employee_list: 'an employee list',
  other: 'some other document',
  unreadable: 'an unreadable file',
};

const STOP = new Set([
  'llc',
  'l',
  'c',
  'fze',
  'fzco',
  'fz',
  'est',
  'establishment',
  'real',
  'estate',
  'estates',
  'property',
  'properties',
  'broker',
  'brokers',
  'brokerage',
  'co',
  'company',
  'the',
  'and',
  'of',
  'bin',
  'al',
  'el',
  'sole',
  'proprietorship',
  'one',
  'person',
  'single',
  'owner',
]);
const tokens = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));

/** Names match when every meaningful word of the shorter one appears in the longer one. */
export function namesMatch(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const [short, long] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  const hits = short.filter((t) => long.has(t)).length;
  return hits === short.length || (hits >= 2 && hits / short.length >= 0.66);
}
const anyNameMatches = (name: string, names: string[]) => names.some((n) => namesMatch(name, n));
const normNumber = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const numbersMatch = (a: string, b: string) => {
  const x = normNumber(a);
  const y = normNumber(b);
  return x.length > 0 && (x === y || x.endsWith(y) || y.endsWith(x));
};
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function readingOf(doc: { aiStatus: string; aiResult: unknown }): KycReading | null {
  if (doc.aiStatus !== 'checked') return null;
  const parsed = kycReadingSchema.safeParse(doc.aiResult);
  return parsed.success ? parsed.data : null;
}

/**
 * Cross-checks the AI read-outs against what the agency entered and against each other. Output is
 * advice for the reviewer, in plain words; PropForce staff still decide every document.
 */
export function kycFindings(input: FindingInput): KycFinding[] {
  const now = input.now ?? new Date();
  const today = isoDay(now);
  const out: KycFinding[] = [];
  const owners = new Map(input.owners.map((o) => [o.id, o]));
  const employees = new Map(input.employees.map((e) => [e.id, e]));
  // Only the newest file per slot (documents arrive newest first).
  const seen = new Set<string>();
  const docs = input.documents.filter((d) => {
    if (d.type === 'permit' || d.type === 'employee_list') return true;
    const slot = `${d.type}:${d.ownerId ?? ''}:${d.employeeId ?? ''}`;
    if (seen.has(slot)) return false;
    seen.add(slot);
    return true;
  });

  for (const d of docs) {
    const who = d.ownerId
      ? (owners.get(d.ownerId)?.fullName ?? 'Owner')
      : d.employeeId
        ? (employees.get(d.employeeId)?.fullName ?? 'Employee')
        : 'Agency';
    const what = d.type === 'permit' && d.label ? d.label : DOCUMENT_LABELS[d.type];
    const add = (severity: FindingSeverity, message: string) =>
      out.push({ severity, documentId: d.id, subject: `${what} · ${who}`, message });

    if (d.aiStatus === 'not_checked') {
      add('info', 'Not read by AI yet.');
      continue;
    }
    const r = readingOf(d);
    if (!r) {
      add('warning', 'AI could not read this file. Check it by hand.');
      continue;
    }
    if (!r.legible || r.documentKind === 'unreadable') {
      add('problem', 'Hard to read (blurry, cropped or dark). Ask for a clearer copy.');
    }
    if (r.documentKind !== 'unreadable' && !EXPECTED_KIND[d.type].includes(r.documentKind)) {
      add('problem', `This looks like ${KIND_NAMES[r.documentKind]}, not a ${what.toLowerCase()}.`);
    }
    if (r.expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(r.expiryDate)) {
      if (r.expiryDate < today) add('problem', `Expired on ${r.expiryDate}.`);
      if (d.expiresAt && isoDay(d.expiresAt) !== r.expiryDate) {
        add(
          'warning',
          `Expiry entered as ${isoDay(d.expiresAt)} but the document shows ${r.expiryDate}.`,
        );
      }
    } else if (d.expiresAt) {
      add('info', 'AI could not see an expiry date. Check it against the date entered.');
    }

    const number = r.documentNumber;
    const expectNumber =
      d.type === 'trade_license'
        ? input.agency.tradeLicenseNo
        : d.type === 'orn_certificate'
          ? input.agency.orn
          : d.type === 'employee_brn_card'
            ? (employees.get(d.employeeId ?? '')?.brn ?? null)
            : d.documentNumber;
    if (number && expectNumber && !numbersMatch(number, expectNumber)) {
      add('warning', `Number on the document is ${number}, but ${expectNumber} was entered.`);
    }

    const companyDoc = ['trade_license', 'moa', 'ejari', 'orn_certificate'].includes(d.type);
    if (companyDoc && r.companyName && !namesMatch(r.companyName, input.agency.name)) {
      add(
        'warning',
        `Company name on the document is “${r.companyName}”, not “${input.agency.name}”.`,
      );
    }
    if (d.type === 'trade_license' && r.activities.length > 0) {
      const brokerage = r.activities.some((a) =>
        /real\s*estate|brokerage|property|broker/i.test(a),
      );
      if (!brokerage) {
        add('problem', 'The licensed activities do not include real estate brokerage.');
      }
    }
    if (d.ownerId || d.employeeId) {
      if (r.personNames.length === 0) add('warning', 'AI could not read the holder’s name.');
      else if (!anyNameMatches(who, r.personNames)) {
        add('problem', `The name on the document is “${r.personNames[0]}”, not “${who}”.`);
      }
    }
    if (r.concerns.trim()) add('warning', `AI note: ${r.concerns.trim()}`);
  }

  // Owners entered vs owners named on the MOA / trade licence.
  const named = docs
    .filter((d) => d.type === 'moa' || d.type === 'trade_license')
    .map(readingOf)
    .filter((r): r is KycReading => !!r)
    .flatMap((r) => r.personNames);
  if (named.length > 0) {
    for (const o of input.owners) {
      if (!anyNameMatches(o.fullName, named)) {
        out.push({
          severity: 'warning',
          subject: `Owner · ${o.fullName}`,
          message: 'Not named on the MOA or trade licence.',
        });
      }
    }
    const extra = [...new Set(named)].filter(
      (n) => !input.owners.some((o) => namesMatch(o.fullName, n)),
    );
    for (const n of extra.slice(0, 10)) {
      out.push({
        severity: 'info',
        subject: 'Owners',
        message: `“${n}” is named on the MOA or trade licence but not added as an owner (may be a manager).`,
      });
    }
  }

  for (const e of input.employees) {
    if (!e.isBroker) continue;
    const card = docs.find((d) => d.type === 'employee_brn_card' && d.employeeId === e.id);
    const r = card ? readingOf(card) : null;
    if (r?.documentNumber && !e.brn) {
      out.push({
        severity: 'info',
        subject: `Employee · ${e.fullName}`,
        message: `BRN on the card is ${r.documentNumber}.`,
      });
    }
  }

  const order: Record<FindingSeverity, number> = { problem: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** A ready-to-edit message for the agency listing what to fix. */
export function suggestedInstructions(
  findings: KycFinding[],
  checklist: KycChecklist,
  rejected: { label: string; reason: string | null }[],
): string {
  const lines: string[] = [];
  for (const m of checklist.missing) lines.push(`- Upload: ${m}`);
  for (const r of rejected)
    lines.push(`- Upload again: ${r.label}${r.reason ? ` (${r.reason})` : ''}`);
  for (const f of findings.filter((x) => x.severity === 'problem')) {
    lines.push(`- ${f.subject}: ${f.message}`);
  }
  for (const f of findings.filter(
    (x) => x.severity === 'warning' && !x.message.startsWith('AI '),
  )) {
    lines.push(`- Please check ${f.subject}: ${f.message}`);
  }
  if (lines.length === 0) return '';
  return `Please fix the following in your registration documents:\n${[...new Set(lines)].join('\n')}`;
}
