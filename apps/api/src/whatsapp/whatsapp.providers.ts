import type { Provider } from '@nestjs/common';
import {
  CloudApiClient,
  FakeEmbeddedSignup,
  FakeWhatsAppClient,
  MetaEmbeddedSignup,
  type EmbeddedSignupPort,
  type WhatsAppClient,
} from '@propforce/whatsapp';
import { APP_CONFIG, type AppConfig } from '../config/env';

export const WHATSAPP_CLIENT = Symbol('WHATSAPP_CLIENT');
export const EMBEDDED_SIGNUP = Symbol('EMBEDDED_SIGNUP');

/** `null` when WhatsApp is not configured; callers answer INTEGRATION_NOT_CONFIGURED. */
export const whatsappProviders: Provider[] = [
  {
    provide: WHATSAPP_CLIENT,
    inject: [APP_CONFIG],
    useFactory: (c: AppConfig): WhatsAppClient | null =>
      c.whatsapp.provider === 'fake'
        ? new FakeWhatsAppClient()
        : c.whatsapp.provider === 'meta'
          ? new CloudApiClient({ graphVersion: c.whatsapp.graphVersion })
          : null,
  },
  {
    provide: EMBEDDED_SIGNUP,
    inject: [APP_CONFIG],
    useFactory: (c: AppConfig): EmbeddedSignupPort | null =>
      c.whatsapp.provider === 'fake'
        ? new FakeEmbeddedSignup()
        : c.whatsapp.provider === 'meta'
          ? new MetaEmbeddedSignup({
              appId: c.whatsapp.appId!,
              appSecret: c.whatsapp.appSecret!,
              graphVersion: c.whatsapp.graphVersion,
            })
          : null,
  },
];
