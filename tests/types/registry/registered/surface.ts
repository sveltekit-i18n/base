import { type Config, I18n } from '@sveltekit-i18n/base';
import { defineI18n, type Kit } from '@sveltekit-i18n/base/kit';

import { assert, type Equal, parser } from './shared.js';

const loader = async () => ({});

// The registry narrows keys only; the locales the config spells stay as they are.
const i18n = new I18n({ parser, fallbackLocale: 'de', loaders: [{ namespace: 'common', locale: 'en', loader }] });

assert<Equal<typeof i18n.locale, Config.LocaleInput<'en' | 'de'> | undefined>>();
i18n.t('home.title');
// @ts-expect-error an unknown key
i18n.t('home.nope');

// A registered instance still passes where a plain one is expected.
const plain: I18n = i18n;
const wiring: Kit.T = defineI18n({ parser });

export { plain, wiring };
