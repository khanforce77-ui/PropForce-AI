import { Inject, Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/env';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM encryption for small secrets stored in the database (TOTP seeds, later OAuth
 * tokens). Layout: [version:1][iv:12][tag:16][ciphertext]. The key comes from the secrets
 * manager in deployed environments; development and tests use a fixed, public dev key.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (config.dataEncryptionKey) {
      this.key = config.dataEncryptionKey;
    } else {
      this.key = createHash('sha256').update('propforce-development-only-key').digest();
      if (config.nodeEnv !== 'test') {
        new Logger(EncryptionService.name).warn(
          'DATA_ENCRYPTION_KEY not set: using the public development key. Never use this with real data.',
        );
      }
    }
  }

  encrypt(plaintext: string, associatedData: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
  }

  /** Throws if the data was tampered with or bound to different associated data. */
  decrypt(payload: Uint8Array, associatedData: string): string {
    const buf = Buffer.from(payload);
    if (buf[0] !== VERSION) throw new Error('Unsupported ciphertext version');
    const iv = buf.subarray(1, 1 + IV_BYTES);
    const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(1 + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /** Keyed hash for lookup values such as recovery codes. */
  hmac(value: string): string {
    return createHmac('sha256', this.key).update(value, 'utf8').digest('base64url');
  }
}
