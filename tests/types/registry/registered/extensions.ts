import { type Extension, I18n, type Schema } from '@sveltekit-i18n/base';

import { assert, type Equal, parser } from './shared.js';

interface WithFlag extends Extension.Operator {
  readonly output: this['input'] & { flag: true };
}

const withFlag: Extension.Generic<WithFlag> = (input: I18n) => Object.assign(input, { flag: true as const });

// An operator keeps the registered schema behind the pipe.
const piped = new I18n({ parser, extensions: [withFlag] });

piped.t('home.greeting', { name: 'Ada' });
// @ts-expect-error an unknown key
piped.t('home.nope');

assert<Equal<Schema.FromInstance<typeof piped>, TranslationSchema>>();
assert<Equal<typeof piped.flag, true>>();

// A fixed return type erases it, as it erases a stated schema.
const erased = new I18n({ parser, extensions: [(input: I18n) => input] });

erased.t('any.key', 'anything', 1);

assert<Equal<typeof erased, I18n>>();
