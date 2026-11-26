import { describe, expect, it } from 'vitest';
import { kycFindings, namesMatch } from './kyc-findings';
import { kycChecklist } from './kyc-rules';

const base = {
  agency: { name: 'Alpha Realty', tradeLicenseNo: '1234567', orn: '98765' },
  owners: [{ id: 'o1', fullName: 'Omar Khalid Rahman' }],
  employees: [],
};
const read = (over: object) => ({
  documentKind: 'trade_license',
  legible: true,
  companyName: 'Alpha Realty L.L.C.',
  personNames: ['Omar Khalid Rahman'],
  documentNumber: '1234567',
  issueDate: null,
  expiryDate: '2099-01-01',
  issuer: 'DET',
  activities: ['Real Estate Buying & Selling Brokerage'],
  concerns: '',
  ...over,
});
const doc = (aiResult: object, over: object = {}) => ({
  id: 'd1',
  type: 'trade_license' as const,
  ownerId: null,
  employeeId: null,
  label: null,
  documentNumber: null,
  expiresAt: new Date('2099-01-01'),
  status: 'pending',
  aiStatus: 'checked',
  aiResult,
  ...over,
});

describe('namesMatch', () => {
  it('ignores case, order, punctuation and company suffixes', () => {
    expect(namesMatch('OMAR KHALID RAHMAN', 'Omar Rahman')).toBe(true);
    expect(namesMatch('Alpha Realty L.L.C', 'Alpha Realty Real Estate Brokers')).toBe(true);
    expect(namesMatch('Ahmed Saleh', 'Omar Khalid Rahman')).toBe(false);
  });
});

describe('kycFindings', () => {
  it('finds nothing wrong with a matching trade licence', () => {
    expect(kycFindings({ ...base, documents: [doc(read({}))] })).toEqual([]);
  });

  it('flags wrong kind, expiry, number, company and activity', () => {
    const f = kycFindings({
      ...base,
      now: new Date('2026-11-26'),
      documents: [
        doc(
          read({
            documentKind: 'ejari',
            expiryDate: '2025-01-01',
            documentNumber: '999',
            companyName: 'Beta Homes',
            activities: ['General Trading'],
          }),
        ),
      ],
    });
    const text = f.map((x) => `${x.severity}: ${x.message}`).join('\n');
    expect(text).toMatch(/problem: This looks like an Ejari/);
    expect(text).toMatch(/problem: Expired on 2025-01-01/);
    expect(text).toMatch(/warning: Number on the document is 999/);
    expect(text).toMatch(/warning: Company name/);
    expect(text).toMatch(/problem: The licensed activities/);
    expect(f[0]!.severity).toBe('problem');
  });

  it('flags owners missing from the MOA', () => {
    const f = kycFindings({
      ...base,
      owners: [...base.owners, { id: 'o2', fullName: 'Fatima Noor' }],
      documents: [doc(read({ documentKind: 'moa' }), { type: 'moa', expiresAt: null })],
    });
    expect(f.some((x) => x.subject === 'Owner · Fatima Noor')).toBe(true);
  });

  it('reports unread and failed files without guessing', () => {
    const f = kycFindings({
      ...base,
      documents: [
        doc({}, { aiStatus: 'not_checked' }),
        doc({}, { id: 'd2', type: 'moa', aiStatus: 'failed' }),
      ],
    });
    expect(f.map((x) => x.severity).sort()).toEqual(['info', 'warning']);
  });
});

describe('kycChecklist', () => {
  it('needs a BRN and broker card only for brokers', () => {
    const c = kycChecklist(
      { tradeLicenseNo: 'x', orn: 'y', website: 'https://a.ae', hasLogo: true },
      [],
      [
        { id: 'e1', fullName: 'Broker One', isBroker: true, brn: null },
        { id: 'e2', fullName: 'Office Admin', isBroker: false, brn: null },
      ],
      [],
    );
    expect(c.missing).toContain('BRN number (Broker One)');
    expect(c.missing).toContain('DLD broker card (BRN) (Broker One)');
    expect(c.missing.some((m) => m.includes('Office Admin') && m.includes('BRN'))).toBe(false);
    expect(c.missing).toContain('At least one owner');
  });
});
