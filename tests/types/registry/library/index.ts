import { I18n } from '@sveltekit-i18n/base';

const parser = { parse: (_value: unknown, _params: unknown[], _locale: string, key: string) => key };

// A library compiled without a registration: its declarations carry no
// schema, whatever the app that installs it registers.
export const i18n = new I18n({ parser });
