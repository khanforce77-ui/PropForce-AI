/**
 * Shared Dubai real estate knowledge for PropForce's AI assistants (WhatsApp replies and AI
 * calls). It is general, publicly known market information, written so the assistant can answer
 * common questions without inventing anything about a specific property, person or price.
 *
 * Rules for editing this file:
 * - Dubai only. No figures for a specific listing, building or area price: those come from the
 *   agency's own listings (tools) or from the agent.
 * - Every AED amount written here must also be listed in {@link KNOWLEDGE_AMOUNTS_AED}, because
 *   the WhatsApp grounding check rejects any AED figure that no tool or source backs.
 * - Phrase rules as "usually" / "generally" where practice varies, and point to the deciding
 *   authority (DLD, RERA, the bank, ICP/GDRFA) for anything personal.
 */

export const DUBAI_KNOWLEDGE_VERSION = 'dubai-kb/2026-11-26.1';

/** AED amounts that appear in the knowledge text; replies may repeat them. */
export const KNOWLEDGE_AMOUNTS_AED: readonly number[] = [2_000_000, 5_000_000];

const SECTIONS: readonly (readonly [string, readonly string[]])[] = [
  [
    'Who can buy and where',
    [
      'Foreigners of any nationality can buy freehold property in Dubai’s designated freehold areas, with full ownership and a DLD title deed. Residency is not needed to buy.',
      'Well-known freehold areas include Downtown Dubai, Business Bay, Dubai Marina, JBR, JLT, Palm Jumeirah, Dubai Hills Estate, Jumeirah Village Circle (JVC), Jumeirah Village Triangle (JVT), Arabian Ranches, DAMAC Hills, Dubai Creek Harbour, Emaar Beachfront, Mohammed Bin Rashid City (MBR City), Meydan, Al Furjan, Town Square, Dubai South, Dubai Sports City, Motor City, Arjan, Dubai Silicon Oasis and International City.',
      'Older areas such as parts of Deira, Bur Dubai and Jumeirah are mostly not freehold for foreign buyers, though anyone can rent there.',
    ],
  ],
  [
    'Buying a ready (resale) property',
    [
      'Typical steps: agree the price, sign the MOU (RERA Form F) and give the seller a security cheque (often 10% of the price), the seller gets a No Objection Certificate (NOC) from the developer, then both sides complete the transfer at a DLD Trustee Office and the new title deed is issued. A cash deal often completes in a few weeks; with a mortgage it takes longer because of bank approval and valuation.',
      'Main buying costs: the DLD transfer fee of 4% of the price plus small admin fees, the Trustee Office fee, the agency commission (commonly 2% of the price plus 5% VAT), and for mortgage buyers the mortgage registration fee (0.25% of the loan) plus bank valuation and arrangement fees. Exact figures come only from the cost calculator tool or the agent.',
      'Before buying, the buyer should check the title deed, that service charges are paid up, and whether the unit is vacant or tenanted (a tenant’s lease continues after a sale).',
    ],
  ],
  [
    'Off-plan (new launch) property',
    [
      'Off-plan means buying from a developer before completion. The sale is registered on DLD’s Oqood (interim) register, and the DLD 4% fee is usually paid at booking.',
      'Payments go into a project escrow account regulated by DLD/RERA; buyers should only buy RERA-registered projects from registered developers.',
      'Payment plans vary by project, for example a share during construction and the rest on handover, and some offer post-handover plans paid over a few years. Only quote the plan, handover date and price that the agency’s listing data shows.',
      'Reselling before handover (assignment) usually needs the developer’s NOC and a minimum share of the price paid, which differs by developer.',
      'Risks to mention honestly when asked: completion can be delayed, and the finished unit or market price may differ from expectations. Never promise returns or capital growth.',
    ],
  ],
  [
    'Mortgages (general UAE Central Bank rules)',
    [
      'For expatriates buying a first home worth up to AED 5 million, banks generally lend up to 80% of the value, so the buyer needs at least 20% down plus the buying costs. Above AED 5 million the limit is generally 70%. UAE nationals can usually borrow a bit more, and second homes and off-plan property have lower limits (off-plan is often around 50%).',
      'The longest term is generally 25 years, and monthly debt payments are generally capped at 50% of income. Fixed and variable rates are both common.',
      'A mortgage pre-approval from a bank or broker is the usual first step. Whether someone qualifies, and at what rate, is decided only by the bank: never say a person will be approved.',
    ],
  ],
  [
    'Golden Visa through property',
    [
      'A property investment with a total value of at least AED 2 million can make the owner eligible for the 10-year renewable UAE Golden Visa. Several properties can be combined, mortgaged and some off-plan properties can qualify under conditions.',
      'Eligibility and the documents needed are decided by the immigration authorities (ICP/GDRFA), so the assistant can explain the general rule but must not confirm that a specific person will get a visa.',
    ],
  ],
  [
    'Renting in Dubai',
    [
      'Tenancy contracts are usually for 12 months and must be registered on Ejari. Rent is often paid by 1 to 4 cheques, sometimes more by agreement.',
      'Usual move-in costs: a refundable security deposit (commonly 5% of the annual rent for unfurnished and 10% for furnished), the agency fee (commonly 5% of the annual rent plus VAT), Ejari registration, and a refundable DEWA (electricity and water) connection deposit. Tenants also pay a municipality housing fee of 5% of the annual rent, added monthly to the DEWA bill.',
      'Rent increases on renewal are limited by the DLD Rental Index (the RERA rent calculator) and need 90 days’ notice before the contract ends. A landlord who wants the property back for own use or sale must generally give 12 months’ notice by notary public or registered mail. Disputes go to the Rental Dispute Settlement Centre.',
      'Short-term holiday-home renting needs a permit from Dubai’s Department of Economy and Tourism.',
    ],
  ],
  [
    'Selling or letting through an agency',
    [
      'Owners sign a listing agreement with a RERA-licensed agency (RERA Form A for sales). Every advert needs a valid DLD/Trakheesi permit, and agents must hold a RERA broker card (BRN).',
      'Sellers with a mortgage need the bank’s liability letter and the loan settled at transfer. The agent can suggest a price based on recent DLD transactions; the assistant must not value a property itself.',
      'Owners pay annual service charges to the owners’ association, approved by RERA through the Mollak system.',
    ],
  ],
  [
    'Areas in brief (character only, never prices)',
    [
      'Dubai Marina and JBR: waterfront towers, beach, tram and metro, popular for rentals.',
      'Downtown Dubai and Business Bay: city centre near Burj Khalifa and Dubai Mall, apartments and serviced residences.',
      'Palm Jumeirah: luxury beachfront apartments and villas.',
      'Dubai Hills Estate: master community with villas, apartments, golf course, park and mall.',
      'JVC, JVT and Arjan: more affordable apartments and townhouses, popular with families and investors.',
      'Arabian Ranches, DAMAC Hills and Town Square: villa and townhouse communities with schools and parks.',
      'Dubai Creek Harbour, MBR City and Meydan: newer master communities with many off-plan launches.',
      'Dubai South and Expo City: near Al Maktoum airport, many newer and off-plan projects.',
      'JLT: towers around lakes with metro access, mixed residential and offices.',
      'Dubai Silicon Oasis, Sports City, Motor City and International City: value-focused areas.',
    ],
  ],
];

/** The knowledge as prompt text, ready to sit inside trusted instructions. */
export const dubaiKnowledge = (): string =>
  [
    `Dubai real estate knowledge (${DUBAI_KNOWLEDGE_VERSION}). General information you may share; say it is general guidance and that the agent, bank or authority confirms personal cases:`,
    ...SECTIONS.flatMap(([title, lines]) => [`## ${title}`, ...lines.map((l) => `- ${l}`)]),
  ].join('\n');
