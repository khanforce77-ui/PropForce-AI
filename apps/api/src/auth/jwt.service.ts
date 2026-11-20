import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type CryptoKey,
} from 'jose';
import { APP_CONFIG, type AppConfig } from '../config/env';

export interface AccessTokenClaims {
  /** User id */
  sub: string;
  /** Session id, checked against the database so revocation is immediate. */
  sid: string;
}

const ALG = 'EdDSA';

@Injectable()
export class JwtService implements OnModuleInit {
  private readonly logger = new Logger(JwtService.name);
  private privateKey!: CryptoKey;
  private publicKey!: CryptoKey;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    const { privateKeyPem, publicKeyPem } = this.config.jwt;
    if (privateKeyPem && publicKeyPem) {
      this.privateKey = await importPKCS8(privateKeyPem, ALG);
      this.publicKey = await importSPKI(publicKeyPem, ALG);
      return;
    }
    // Development/test only (config validation forbids this in staging/production).
    const pair = await generateKeyPair(ALG, { extractable: true });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    if (this.config.nodeEnv !== 'test') {
      this.logger.warn(
        'JWT keys not configured: using an ephemeral key pair (tokens reset on restart)',
      );
    }
  }

  async sign(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ sid: claims.sid })
      .setProtectedHeader({ alg: ALG })
      .setSubject(claims.sub)
      .setIssuer(this.config.jwt.issuer)
      .setAudience('propforce-web')
      .setIssuedAt()
      .setExpirationTime(`${this.config.jwt.accessTtlSeconds}s`)
      .sign(this.privateKey);
  }

  /** Returns claims, or null for any invalid, expired or malformed token. */
  async verify(token: string): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: [ALG],
        issuer: this.config.jwt.issuer,
        audience: 'propforce-web',
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
      return { sub: payload.sub, sid: payload.sid };
    } catch {
      return null;
    }
  }
}

/** Helper for operators: prints a fresh key pair as PEM. */
export async function generatePemKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const pair = await generateKeyPair(ALG, { extractable: true });
  return {
    privateKey: await exportPKCS8(pair.privateKey),
    publicKey: await exportSPKI(pair.publicKey),
  };
}
