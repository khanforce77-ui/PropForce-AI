import { describe, expect, it } from 'vitest';
import { escapeHtml, renderEmail } from './templates';

describe('renderEmail', () => {
  const email = renderEmail(
    {
      preheader: 'Join <b>Evil</b>',
      heading: 'Join "Agency" & co',
      paragraphs: ['Hello <script>alert(1)</script>', 'Line one\nline two'],
      details: [['Name', '<img src=x onerror=1>']],
      quote: 'Hi <a href="javascript:x">there</a>',
      button: { label: 'Accept', url: 'https://app.propforce.io/accept-invite?token=abc_123' },
      footnote: 'Expires in 7 days.',
    },
    'https://app.propforce.io/',
  );

  it('escapes everything that came from a user', () => {
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).not.toContain('<b>Evil</b>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('Join &quot;Agency&quot; &amp; co');
    expect(email.html).toContain('Line one<br>line two');
  });

  it('has the logo, the button link and a plain-text version with the full link', () => {
    expect(email.html).toContain('https://app.propforce.io/brand/propforce-email-logo.png');
    expect(email.html).toContain('href="https://app.propforce.io/accept-invite?token=abc_123"');
    expect(email.text).toContain('Accept: https://app.propforce.io/accept-invite?token=abc_123');
    expect(email.text).toContain('Hello <script>alert(1)</script>');
    expect(email.text).toContain('Name: <img src=x onerror=1>');
    expect(email.text).not.toContain('<table');
  });

  it('drops non-http button links', () => {
    const bad = renderEmail(
      {
        preheader: 'x',
        heading: 'x',
        paragraphs: [],
        button: { label: 'Go', url: 'javascript:alert(1)' },
      },
      'https://app.propforce.io',
    );
    expect(bad.html).not.toContain('javascript:');
    expect(bad.text).not.toContain('javascript:');
  });

  it('escapes quotes for attributes', () => {
    expect(escapeHtml(`"'<>&`)).toBe('&quot;&#39;&lt;&gt;&amp;');
  });
});
