import type { Interval } from './slots';

/**
 * Calendar provider port plus Google adapter and fake.
 *
 * STATUS: PENDING. No Google OAuth client exists yet; the Google adapter is only checked offline
 * (request shapes, response parsing). Verify with a real client and test account before use.
 * Tokens are passed in per call; the caller stores them encrypted per agent and refreshes.
 */

export interface TokenSet {
  readonly accessToken: string;
  /** Only returned on first consent (and on forced re-consent). */
  readonly refreshToken?: string;
  readonly expiresAt: Date;
  readonly scope?: string;
}

export interface ViewingEvent {
  readonly start: Date;
  readonly end: Date;
  /** Shown in the agent's calendar. Must not contain client contact details beyond a first name. */
  readonly summary: string;
  readonly description?: string;
  readonly location?: string;
  /** Our viewing id, stored on the event so we can reconcile and dedupe. */
  readonly viewingId: string;
}

export interface CalendarProvider {
  exchangeCode(code: string, codeVerifier: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  revoke(token: string): Promise<void>;
  freeBusy(accessToken: string, range: Interval): Promise<Interval[]>;
  createEvent(accessToken: string, ev: ViewingEvent): Promise<{ eventId: string }>;
  updateEvent(accessToken: string, eventId: string, ev: ViewingEvent): Promise<void>;
  deleteEvent(accessToken: string, eventId: string): Promise<void>;
}

export class CalendarProviderError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    /** True when the grant is gone (revoked/expired refresh token): agent must reconnect. */
    readonly reconnectRequired = false,
  ) {
    super(`Calendar provider request failed with HTTP ${status}`);
  }
}

export interface GoogleConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

const EVENT_ID = /^[a-v0-9]{5,1024}$/;

export class GoogleCalendarProvider implements CalendarProvider {
  private readonly f: typeof fetch;
  private readonly now: () => number;
  constructor(private readonly cfg: GoogleConfig) {
    if (!cfg.clientId || !cfg.clientSecret)
      throw new Error('Google OAuth client is not configured');
    this.f = cfg.fetch ?? fetch;
    this.now = cfg.now ?? Date.now;
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.f(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new CalendarProviderError(0, true);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      throw new CalendarProviderError(
        res.status,
        res.status === 429 || res.status >= 500,
        body.error === 'invalid_grant' || res.status === 401,
      );
    }
    return res;
  }

  private async token(params: Record<string, string>): Promise<TokenSet> {
    const res = await this.call('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        ...params,
      }),
    });
    const j = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!j.access_token || typeof j.expires_in !== 'number')
      throw new CalendarProviderError(502, true);
    return {
      accessToken: j.access_token,
      ...(j.refresh_token ? { refreshToken: j.refresh_token } : {}),
      // Refresh a minute early.
      expiresAt: new Date(this.now() + (j.expires_in - 60) * 1000),
      ...(j.scope ? { scope: j.scope } : {}),
    };
  }

  exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
    return this.token({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: this.cfg.redirectUri,
    });
  }

  refresh(refreshToken: string): Promise<TokenSet> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async revoke(token: string): Promise<void> {
    await this.call('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
  }

  async freeBusy(accessToken: string, range: Interval): Promise<Interval[]> {
    const res = await this.call('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        timeMin: range.start.toISOString(),
        timeMax: range.end.toISOString(),
        items: [{ id: 'primary' }],
      }),
    });
    const j = (await res.json()) as {
      calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }>;
    };
    const cal = j.calendars?.['primary'];
    // Fail closed: if Google could not compute busy times, treat the calendar as unavailable.
    if (!cal || (cal.errors && cal.errors.length > 0)) throw new CalendarProviderError(502, true);
    return (cal.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }

  /** Event body. Uses a deterministic event id from the viewing id so retries cannot duplicate. */
  buildEvent(ev: ViewingEvent): Record<string, unknown> {
    return {
      id: googleEventId(ev.viewingId),
      summary: ev.summary.slice(0, 200),
      ...(ev.description ? { description: ev.description.slice(0, 2000) } : {}),
      ...(ev.location ? { location: ev.location.slice(0, 300) } : {}),
      start: { dateTime: ev.start.toISOString() },
      end: { dateTime: ev.end.toISOString() },
      extendedProperties: { private: { propforceViewingId: ev.viewingId } },
      reminders: { useDefault: true },
    };
  }

  async createEvent(accessToken: string, ev: ViewingEvent): Promise<{ eventId: string }> {
    const body = this.buildEvent(ev);
    try {
      await this.call(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
    } catch (e) {
      // 409: an event with this id already exists, i.e. a retry of a create that succeeded.
      if (!(e instanceof CalendarProviderError && e.status === 409)) throw e;
    }
    return { eventId: body.id as string };
  }

  async updateEvent(accessToken: string, eventId: string, ev: ViewingEvent): Promise<void> {
    if (!EVENT_ID.test(eventId)) throw new Error('Invalid event id');
    const body = this.buildEvent(ev);
    delete body.id; // the id of an existing event cannot change
    await this.call(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=none`,
      {
        method: 'PATCH',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  }

  async deleteEvent(accessToken: string, eventId: string): Promise<void> {
    if (!EVENT_ID.test(eventId)) throw new Error('Invalid event id');
    try {
      await this.call(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=none`,
        { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } },
      );
    } catch (e) {
      // Already gone is success for a cancel.
      if (!(e instanceof CalendarProviderError && (e.status === 404 || e.status === 410))) throw e;
    }
  }
}

/**
 * Google event ids allow base32hex characters (a-v, 0-9), length 5 to 1024. A UUID without dashes
 * is lowercase hex, which is a subset, so it maps directly.
 */
export const googleEventId = (viewingId: string): string => {
  const id = `pf${viewingId.toLowerCase().replace(/-/g, '')}`.replace(/[^a-v0-9]/g, '');
  if (!EVENT_ID.test(id)) throw new Error('Viewing id cannot be mapped to an event id');
  return id;
};

/** In-memory provider for tests and local development. */
export class FakeCalendarProvider implements CalendarProvider {
  readonly events = new Map<string, ViewingEvent>();
  busy: Interval[] = [];
  revoked: string[] = [];
  async exchangeCode(code: string): Promise<TokenSet> {
    if (code === 'invalid') throw new CalendarProviderError(400, false, true);
    return {
      accessToken: `at-${code}`,
      refreshToken: `rt-${code}`,
      expiresAt: new Date(Date.now() + 3_000_000),
      scope:
        'https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events',
    };
  }
  async refresh(rt: string): Promise<TokenSet> {
    if (this.revoked.includes(rt)) throw new CalendarProviderError(400, false, true);
    return { accessToken: `at-refreshed`, expiresAt: new Date(Date.now() + 3_000_000) };
  }
  async revoke(token: string) {
    this.revoked.push(token);
  }
  async freeBusy(_at: string, range: Interval) {
    return [
      ...this.busy,
      ...[...this.events.values()].map((e) => ({ start: e.start, end: e.end })),
    ].filter((b) => b.start < range.end && range.start < b.end);
  }
  async createEvent(_at: string, ev: ViewingEvent) {
    const eventId = googleEventId(ev.viewingId);
    this.events.set(eventId, ev);
    return { eventId };
  }
  async updateEvent(_at: string, id: string, ev: ViewingEvent) {
    if (!this.events.has(id)) throw new CalendarProviderError(404, false);
    this.events.set(id, ev);
  }
  async deleteEvent(_at: string, id: string) {
    this.events.delete(id);
  }
}
