/**
 * Short buyer and tenant guides for Dubai. Plain, general information only: figures are given as
 * "usually" ranges and every guide tells readers to confirm with Dubai Land Department (DLD),
 * their bank or a lawyer. Update REVIEWED whenever the text is checked again.
 */
export interface Guide {
  slug: string;
  title: string;
  summary: string;
  audience: 'Buying' | 'Renting' | 'Off-plan' | 'Safety';
  minutes: number;
  sections: { heading: string; points: string[] }[];
}

export const GUIDES_REVIEWED = 'November 2026';

export const GUIDES: Guide[] = [
  {
    slug: 'buying-a-home-in-dubai',
    title: 'Buying a home in Dubai, step by step',
    summary: 'From budget and mortgage to the title deed: what happens, in order.',
    audience: 'Buying',
    minutes: 5,
    sections: [
      {
        heading: '1. Work out your full budget',
        points: [
          'Besides the price, plan for the DLD transfer fee (4% of the price) plus registration and trustee office fees.',
          'Agency commission is agreed with the agent; it is commonly around 2% of the price plus VAT.',
          'With a mortgage, add bank arrangement, valuation and mortgage registration fees.',
        ],
      },
      {
        heading: '2. Get mortgage pre-approval (if you need a loan)',
        points: [
          'A pre-approval tells you how much a bank will lend before you make an offer.',
          'How much you can borrow depends on your residency, income, the price and whether it is your first home, so ask your bank for the current limits.',
        ],
      },
      {
        heading: '3. Choose a listing you can trust',
        points: [
          'Every listing on this site shows its advertising permit. Check that the details match the home you see.',
          'Look for the agent’s BRN (broker number) and the Verified agent badge.',
        ],
      },
      {
        heading: '4. View, agree the price and sign the MOU',
        points: [
          'Once you agree a price, buyer and seller sign a Memorandum of Understanding (Form F).',
          'A deposit, often 10% of the price, is usually held by the agency or trustee until transfer.',
        ],
      },
      {
        heading: '5. Transfer and title deed',
        points: [
          'The seller gets a No Objection Certificate (NOC) from the developer.',
          'Buyer and seller (or their representatives) complete the transfer at a DLD trustee office, and the new title deed is issued in the buyer’s name.',
        ],
      },
    ],
  },
  {
    slug: 'renting-in-dubai',
    title: 'Renting in Dubai: what to know',
    summary: 'Deposits, cheques, Ejari and rent increases explained simply.',
    audience: 'Renting',
    minutes: 4,
    sections: [
      {
        heading: 'Costs at the start',
        points: [
          'Rent is quoted per year and is often paid in 1 to 4 cheques; fewer cheques can help you negotiate.',
          'A refundable security deposit is common, often around 5% of the yearly rent for unfurnished homes and more for furnished ones.',
          'Agency fees and DEWA (water and electricity) connection are extra; ask for the full amount before you agree.',
        ],
      },
      {
        heading: 'Ejari registration',
        points: [
          'Every tenancy contract in Dubai must be registered in Ejari. You need it for DEWA, visas for family and other services.',
        ],
      },
      {
        heading: 'Rent increases and disputes',
        points: [
          'Rent increases at renewal are limited by the official RERA rental index, which you can check on the Dubai Land Department website.',
          'Disputes go to the Rental Dispute Settlement Centre.',
        ],
      },
      {
        heading: 'Before you pay anything',
        points: [
          'View the home in person or by live video, and check the listing permit and the agent’s BRN.',
          'Make cheques out to the landlord or the licensed agency named in the contract, never to a private person you have not verified.',
        ],
      },
    ],
  },
  {
    slug: 'buying-off-plan',
    title: 'Buying off-plan safely',
    summary: 'Escrow, Oqood, payment plans and handover dates.',
    audience: 'Off-plan',
    minutes: 4,
    sections: [
      {
        heading: 'Check the project and developer',
        points: [
          'Off-plan projects in Dubai must be registered with DLD/RERA. Ask for the project’s registration and the developer’s details.',
          'Payments for off-plan units should go into the project’s escrow account, not a personal account.',
        ],
      },
      {
        heading: 'Register your purchase (Oqood)',
        points: [
          'Off-plan sales are registered with DLD in the Oqood system, which records you as the buyer before the title deed exists.',
        ],
      },
      {
        heading: 'Understand the payment plan',
        points: [
          'Payment plans split the price into instalments tied to construction stages or dates. Check what is due before and after handover.',
          'Handover dates are estimates and can change. Read what the contract says about delays.',
        ],
      },
    ],
  },
  {
    slug: 'spot-a-genuine-listing',
    title: 'How to spot a genuine listing',
    summary: 'Permits, verified agents and the warning signs to watch for.',
    audience: 'Safety',
    minutes: 3,
    sections: [
      {
        heading: 'What we check on this site',
        points: [
          'Listings only appear while they have a valid advertising permit, and they are taken down when the permit expires.',
          'The Verified agent badge means we checked the agent’s DLD broker card and it has not expired.',
          'Listings come only from licensed agencies, and new agencies’ listings are reviewed before they go live.',
        ],
      },
      {
        heading: 'What you can check yourself',
        points: [
          'Scan the permit QR code on the listing where shown; it opens the official government page.',
          'Make sure the agency name, agent and price you are told match the listing.',
        ],
      },
      {
        heading: 'Warning signs',
        points: [
          'A price far below similar homes nearby.',
          'Pressure to pay a deposit before you have viewed the home or signed a contract.',
          'Requests to pay into a personal account or by gift cards or crypto.',
          'If something looks wrong, use “Report this listing” on the listing page.',
        ],
      },
    ],
  },
];

export const guideBySlug = (slug: string) => GUIDES.find((g) => g.slug === slug) ?? null;
