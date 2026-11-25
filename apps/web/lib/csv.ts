/**
 * Minimal RFC 4180 CSV parser for spreadsheet imports: quoted fields, escaped quotes ("") and
 * line breaks inside quotes. Detects comma, semicolon or tab separators from the header line and
 * drops a UTF-8 byte-order mark (Excel adds one).
 */
export function parseCsv(input: string): { headers: string[]; rows: Record<string, string>[] } {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].reduce((best, s) =>
    firstLine.split(s).length > firstLine.split(best).length ? s : best,
  );

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === sep) {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ''));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim());
  const rows = nonEmpty.map((r) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) row[h] = (r[i] ?? '').trim();
    });
    return row;
  });
  return { headers, rows };
}
