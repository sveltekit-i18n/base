import { I18n, type Schema } from '@sveltekit-i18n/base';
import { defineI18n } from '@sveltekit-i18n/base/kit';

const parser = { parse: (_value: unknown, _params: unknown[], _locale: string, key: string) => key };

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

const assert = <T extends true>(): T | void => undefined;

// A registration without keys types nothing: keys stay plain strings.
const i18n = new I18n({ parser });

i18n.t('any.key', 'anything', 1);
defineI18n({ parser }).get().t('any.key', 'anything', 1);

assert<Equal<Schema.Registered, never>>();
assert<Equal<Schema.FromInstance<typeof i18n>, never>>();
