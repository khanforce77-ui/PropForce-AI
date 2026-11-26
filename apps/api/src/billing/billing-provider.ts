/**
 * Payment provider adapter. The provider (Stripe, Checkout.com, Telr or PayTabs) is not chosen
 * yet (PRD Q2), so the only implementation is `PendingBillingProvider`, which refuses every
 * call. A real adapter implements this interface and is bound to BILLING_PROVIDER.
 */
export interface BillingProvider {
  /** Short name shown to admins, e.g. "stripe". Null while pending. */
  readonly name: string | null;
  readonly configured: boolean;
  /** Hosted checkout for a plan change; returns the URL to send the owner to. */
  createCheckout(input: {
    tenantId: string;
    planCode: string;
    customerEmail: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  /** Hosted page where the owner updates the card, downloads invoices or cancels. */
  createPortal(input: { providerCustomerId: string; returnUrl: string }): Promise<{ url: string }>;
}

export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER');

export class BillingNotConfiguredError extends Error {
  constructor() {
    super('No payment provider is configured.');
  }
}

export class PendingBillingProvider implements BillingProvider {
  readonly name = null;
  readonly configured = false;
  createCheckout(): Promise<{ url: string }> {
    return Promise.reject(new BillingNotConfiguredError());
  }
  createPortal(): Promise<{ url: string }> {
    return Promise.reject(new BillingNotConfiguredError());
  }
}
