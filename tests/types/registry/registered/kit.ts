import { defineI18n } from '@sveltekit-i18n/base/kit';

import { parser } from './shared.js';

// The wiring's instances are typed by the registry as `new I18n` is.
const { get, use } = defineI18n({ parser });

get().t('home.greeting', { name: 'Ada' });
use(() => ({})).t('home.title');

// @ts-expect-error an unknown key
get().t('home.nope');
// @ts-expect-error a missing payload
use(() => ({})).t('home.greeting');
