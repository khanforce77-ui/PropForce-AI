import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('handles quotes, commas and line breaks inside fields, and a BOM', () => {
    const csv =
      String.fromCharCode(0xfeff) +
      'Name,Notes,Budget\r\n"Khan, Ali","Line 1\nsaid ""hi""","2,000,000"\r\nSara,,\r\n\r\n';
    expect(parseCsv(csv)).toEqual({
      headers: ['Name', 'Notes', 'Budget'],
      rows: [
        { Name: 'Khan, Ali', Notes: 'Line 1\nsaid "hi"', Budget: '2,000,000' },
        { Name: 'Sara', Notes: '', Budget: '' },
      ],
    });
  });

  it('detects semicolon and tab separators', () => {
    expect(parseCsv('a;b\n1;2').rows).toEqual([{ a: '1', b: '2' }]);
    expect(parseCsv('a\tb\n1\t2').rows).toEqual([{ a: '1', b: '2' }]);
  });
});
