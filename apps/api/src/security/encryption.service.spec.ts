import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env';
import { EncryptionService } from './encryption.service';

const svc = new EncryptionService(
  loadConfig({ NODE_ENV: 'test', DATA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') }),
);

describe('EncryptionService', () => {
  it('round-trips and never stores plaintext', () => {
    const ct = svc.encrypt('JBSWY3DPEHPK3PXP', 'ctx');
    expect(ct.toString('utf8')).not.toContain('JBSWY3DPEHPK3PXP');
    expect(svc.decrypt(ct, 'ctx')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a fresh IV for every encryption', () => {
    expect(svc.encrypt('same', 'ctx').equals(svc.encrypt('same', 'ctx'))).toBe(false);
  });

  it('rejects tampered ciphertext and mismatched associated data', () => {
    const ct = svc.encrypt('secret', 'user:a');
    expect(() => svc.decrypt(ct, 'user:b')).toThrow();
    const tampered = Buffer.from(ct);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => svc.decrypt(tampered, 'user:a')).toThrow();
  });

  it('cannot decrypt with a different key', () => {
    const other = new EncryptionService(
      loadConfig({ NODE_ENV: 'test', DATA_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64') }),
    );
    expect(() => other.decrypt(svc.encrypt('secret', 'ctx'), 'ctx')).toThrow();
  });
});
