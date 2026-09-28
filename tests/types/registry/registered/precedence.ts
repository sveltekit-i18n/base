import { type Config, I18n, type Parser, type Schema } from '@sveltekit-i18n/base';

import { assert, type Equal, parser } from './shared.js';

type Other = { 'other.key': { count: number } };

// A closed schema the config states wins over the registry.
const explicit = new I18n({ parser, schema: {} as Other });

explicit.t('other.key', { count: 1 });
// @ts-expect-error a registered key the stated schema does not know
explicit.t('home.title');

assert<Equal<Schema.FromInstance<typeof explicit>, Other>>();

// So does one a `Config.T` annotation carries, and one that may be undefined.
const closedConfig: Config.T<Parser.Params, string, Other> = { parser, schema: {} as Other };
const closed = new I18n(closedConfig);
const maybe = new I18n({ parser, schema: {} as Other | undefined });

assert<Equal<Schema.FromInstance<typeof closed>, Other>>();
assert<Equal<Schema.FromInstance<typeof maybe>, Other>>();

// A plain `Config.T` annotation states no schema: the registry types it.
const annotatedConfig: Config.T = { parser };
const annotated = new I18n(annotatedConfig);

annotated.t('home.title');
// @ts-expect-error an unknown key
annotated.t('home.nope');

assert<Equal<Schema.FromInstance<typeof annotated>, TranslationSchema>>();

// A schema without a closed key set opts out: keys stay plain strings.
const open: Record<string, unknown> = {};
const optedOut = new I18n({ parser, schema: {} });
const openKeys = new I18n({ parser, schema: open });

optedOut.t('any.key', 'anything', 1);
openKeys.t('any.key', 'anything', 1);

assert<Equal<Schema.FromInstance<typeof optedOut>, never>>();
assert<Equal<Schema.FromInstance<typeof openKeys>, never>>();

// A union of configs keeps the union of their schemas.
type Third = { 'third.key': never };

assert<Equal<Schema.FromConfig<{ schema: Other } | { schema: Third }>, Other | Third>>();
