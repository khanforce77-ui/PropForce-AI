'use client';

import { CheckCircle2, Download, FileUp, Upload } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { parseCsv } from '@/lib/csv';
import { cn } from '@/lib/utils';

type Kind = 'contacts' | 'listings';
type Status = 'ready' | 'created' | 'duplicate' | 'error';
interface RowResult {
  row: number;
  status: Status;
  errors: string[];
  label: string;
  id?: string;
}
interface ImportResponse {
  dryRun: boolean;
  summary: Record<Status, number>;
  results: RowResult[];
}

const MAX_ROWS = 2000;
/** Rows per request; the API takes up to 500. */
const BATCH = 200;

const TEMPLATES: Record<Kind, { file: string; csv: string; columns: string }> = {
  contacts: {
    file: 'propforce-contacts-template.csv',
    csv:
      'Full Name,Mobile,Email,Nationality,Tags,Notes,Agent Email,Looking to,Emirate,Community,Property Type,Bedrooms,Min Budget,Max Budget\n' +
      'Omar Khan,+971 50 123 4567,omar@example.com,Pakistan,investor,Met at expo,,Buy,Dubai,Dubai Marina; JBR,Apartment,2,1500000,2500000\n',
    columns:
      'Name and a mobile or email are required. "Looking to" (Buy, Rent, Sell, Let) also creates a lead with the requirement columns.',
  },
  listings: {
    file: 'propforce-listings-template.csv',
    csv:
      'Reference,Purpose,Property Type,Emirate,Community,Sub Community,Building,Unit,Bedrooms,Bathrooms,Size,Price,Rent Period,Furnishing,Title,Description,Agent Email\n' +
      'AR-101,Sale,Apartment,Dubai,Dubai Marina,,Marina Gate 1,1203,2,2,1250,2350000,,Furnished,Sea view 2BR,Bright unit with balcony,\n',
    columns:
      'Purpose (Sale or Rent), Property Type and Emirate are required. Listings come in as drafts: add photos and a permit to publish them.',
  },
};

const STATUS_STYLE: Record<Status, string> = {
  ready: 'text-emerald-700 dark:text-emerald-400',
  created: 'text-emerald-700 dark:text-emerald-400',
  duplicate: 'text-amber-700 dark:text-amber-400',
  error: 'text-red-600',
};
const STATUS_LABEL: Record<Status, string> = {
  ready: 'Ready',
  created: 'Imported',
  duplicate: 'Skipped (duplicate)',
  error: 'Needs fixing',
};

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImportPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { request } = useAuth();
  const [kind, setKind] = useState<Kind>('contacts');
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFileName(null);
    setRows([]);
    setHeaders([]);
    setResult(null);
    setError(null);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    reset();
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setError('Upload a CSV file. In Excel or Google Sheets use File → Save as / Download → CSV.');
      return;
    }
    const parsed = parseCsv(await file.text());
    if (!parsed.rows.length) {
      setError('That file has no rows under the header line.');
      return;
    }
    if (parsed.rows.length > MAX_ROWS) {
      setError(
        `That file has ${parsed.rows.length} rows. Split it into files of ${MAX_ROWS} or fewer.`,
      );
      return;
    }
    setFileName(file.name);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    await send(parsed.rows, true);
  };

  const send = async (data: Record<string, string>[], dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const all: ImportResponse = {
        dryRun,
        summary: { ready: 0, created: 0, duplicate: 0, error: 0 },
        results: [],
      };
      for (let i = 0; i < data.length; i += BATCH) {
        const r = await request<ImportResponse>(`/import/${kind}`, {
          tenantId: agencyId,
          method: 'POST',
          body: { rows: data.slice(i, i + BATCH), dryRun },
        });
        for (const k of Object.keys(all.summary) as Status[]) all.summary[k] += r.summary[k];
        all.results.push(...r.results.map((x) => ({ ...x, row: x.row + i })));
      }
      setResult(all);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The import did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const t = TEMPLATES[kind];
  const problems = result?.results.filter(
    (r) => r.status === 'duplicate' || r.status === 'error' || r.errors.length > 0,
  );

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <FileUp className="h-6 w-6" aria-hidden /> Bulk import
        </h1>
        <p className="text-sm text-muted-foreground">
          Bring contacts, leads and listings from a spreadsheet or another CRM. You see a preview
          first; nothing is saved until you press Import.
        </p>
      </div>

      <div className="flex gap-2" role="tablist">
        {(['contacts', 'listings'] as const).map((k) => (
          <Button
            key={k}
            role="tab"
            aria-selected={kind === k}
            variant={kind === k ? 'default' : 'outline'}
            onClick={() => {
              setKind(k);
              reset();
            }}
          >
            {k === 'contacts' ? 'Contacts & leads' : 'Listings'}
          </Button>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl text-sm">
            <p>{t.columns}</p>
            <p className="mt-2 text-muted-foreground">
              Column names are flexible (for example &ldquo;Mobile&rdquo;, &ldquo;Phone&rdquo; or
              &ldquo;WhatsApp&rdquo;). Add an &ldquo;Agent Email&rdquo; column to give rows to team
              members. Up to {MAX_ROWS} rows per file.
            </p>
            {kind === 'contacts' ? (
              <p className="mt-2 text-muted-foreground">
                Imported contacts have no recorded consent, so nobody is messaged on WhatsApp until
                you record their consent on the contact.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <label
              className={cn(
                'inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90',
                busy && 'pointer-events-none opacity-60',
              )}
            >
              <Upload className="h-4 w-4" aria-hidden /> Choose CSV file
              <input
                type="file"
                accept=".csv,.tsv,.txt,text/csv"
                className="sr-only"
                onChange={(e) => void onFile(e)}
              />
            </label>
            <Button variant="outline" size="sm" onClick={() => download(t.file, t.csv)}>
              <Download className="h-3.5 w-3.5" aria-hidden /> Download template
            </Button>
          </div>
        </div>
      </Card>

      {error ? <Alert>{error}</Alert> : null}
      {busy ? <p className="text-sm text-muted-foreground">Checking {rows.length} rows…</p> : null}

      {result && fileName ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">
                {result.dryRun ? 'Preview' : 'Import finished'}: {fileName}
              </h2>
              <p className="text-sm text-muted-foreground">
                {rows.length} rows · columns: {headers.join(', ')}
              </p>
            </div>
            {result.dryRun ? (
              <Button
                disabled={busy || result.summary.ready === 0}
                onClick={() => void send(rows, false)}
              >
                Import {result.summary.ready} {kind === 'contacts' ? 'contacts' : 'listings'}
              </Button>
            ) : (
              <span className="inline-flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" aria-hidden /> {result.summary.created} imported
              </span>
            )}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {(result.dryRun
              ? (['ready', 'duplicate', 'error'] as const)
              : (['created', 'duplicate', 'error'] as const)
            ).map((s) => (
              <div key={s} className="rounded-lg border border-border p-3">
                <dt className="text-muted-foreground">{STATUS_LABEL[s]}</dt>
                <dd className={cn('text-xl font-semibold tabular-nums', STATUS_STYLE[s])}>
                  {result.summary[s]}
                </dd>
              </div>
            ))}
          </dl>
          {!result.dryRun ? (
            <p className="mt-3 text-sm">
              <Link
                className="underline"
                href={`/app/${agencyId}/${kind === 'contacts' ? 'contacts' : 'listings'}`}
              >
                Open {kind === 'contacts' ? 'contacts' : 'listings'}
              </Link>
            </p>
          ) : null}
          {problems?.length ? (
            <div className="mt-4">
              <h3 className="text-sm font-medium">Rows to check</h3>
              <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Name / reference</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">What to fix</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {problems.map((r) => (
                      <tr key={r.row}>
                        <td className="px-3 py-2 tabular-nums">{r.row + 1}</td>
                        <td className="px-3 py-2">{r.label}</td>
                        <td className={cn('px-3 py-2', STATUS_STYLE[r.status])}>
                          {STATUS_LABEL[r.status]}
                        </td>
                        <td className="px-3 py-2">{r.errors.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Row numbers match your spreadsheet (row 1 is the header).
              </p>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
