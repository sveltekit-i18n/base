import { I18n, type Schema } from '@sveltekit-i18n/base';

import { assert, type Equal, parser } from './shared.js';

// No schema in the config: the registry types the instance, without a cast.
const i18n = new I18n({ parser });

i18n.t('home.title');
i18n.t('home.greeting', { name: 'Ada' });
i18n.l('en', 'home.greeting', { name: 'Ada' });

// @ts-expect-error an unknown key
i18n.t('home.nope');
// @ts-expect-error a missing payload
i18n.t('home.greeting');
// @ts-expect-error a wrong payload
i18n.t('home.greeting', { name: 1 });
// @ts-expect-error an unknown key through `l`
i18n.l('en', 'home.nope');

assert<Equal<Schema.Registered, TranslationSchema>>();
assert<Equal<Schema.FromInstance<typeof i18n>, TranslationSchema>>();
