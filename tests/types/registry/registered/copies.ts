import { I18n as Copy } from 'base-copy';

import { parser } from './shared.js';

// A second copy of the core in the program declares the same global
// interface, so the one registration reaches it too.
const copy = new Copy({ parser });

copy.t('home.greeting', { name: 'Ada' });

// @ts-expect-error an unknown key
copy.t('home.nope');
