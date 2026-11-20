const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

interface Summary {
  ID: string;
  Subject: string;
  Created: string;
}

/** Waits for the newest email to `to` whose subject matches, and returns the first link in it. */
export async function linkFromEmail(
  to: string,
  subject: RegExp,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const body = (await res.json()) as { messages: Summary[] };
    const match = body.messages.find((m) => subject.test(m.Subject));
    if (match) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${match.ID}`)).json()) as {
        Text: string;
      };
      const link = msg.Text.match(/https?:\/\/\S+/)?.[0];
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email to ${to} matching ${subject}`);
}
