// @ts-check
import { I18n } from '@sveltekit-i18n/base';

import { parser } from './shared.js';

// A JavaScript app is typed by the same registry.
const i18n = new I18n({ parser });

i18n.t('home.greeting', { name: 'Ada' });

// @ts-expect-error an unknown key
i18n.t('home.nope');
