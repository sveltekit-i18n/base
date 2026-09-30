import { I18n, type Parser, type Schema, type Translations } from '@sveltekit-i18n/base';

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

// A mapped type with an `as` clause: TypeScript instantiates its name type once
// per key each time it reads `keyof` of it, so a call that reads the whole key
// set shows in the instantiation count. Off an interface, which a generator
// writes, the same read shows in check time only.
type Probe<N extends string> = { [K in N as `ns.${K}`]: K extends '0' ? never : K extends '5' ? { name: string } | undefined : { name: string } };

type Small = Probe<Digit>;
type Large = Probe<Digit | `${Digit}${Digit}${Digit}`>;

const parser = { parse: (value: unknown) => `${value}` };

// A wrapper package's spelling of `t`, through the public `Schema` helpers.
type Wrapper<S> = <K extends Schema.Key<S>>(key: K, ...rest: Schema.Params<S, K, Parser.Params>) => Translations.Translated<string>;

// Reads `keyof S` on every call: the control that the count still sees such a
// read on this compiler.
type Control<S> = <K extends Schema.Key<S>>(key: K, ...rest: [K] extends [keyof S] ? [payload?: S[K & keyof S]] : []) => Translations.Translated<string>;

const small = new I18n({ parser, schema: {} as Small });
const large = new I18n({ parser, schema: {} as Large });
declare const wrapperSmall: Wrapper<Small>;
declare const wrapperLarge: Wrapper<Large>;
declare const controlSmall: Control<Small>;
declare const controlLarge: Control<Large>;
declare const pair: 'ns.6' | 'ns.7';

// The first call of each subject instantiates its signature; the calls after
// it are the ones measured, each on a key no earlier call used, since the
// checker caches a conditional type by its arguments.
small.t('ns.9', { name: 'x' });
small.l('en', 'ns.9', { name: 'x' });
wrapperSmall('ns.9', { name: 'x' });
controlSmall('ns.9', { name: 'x' });
large.t('ns.9', { name: 'x' });
large.l('en', 'ns.9', { name: 'x' });
wrapperLarge('ns.9', { name: 'x' });
controlLarge('ns.9', { name: 'x' });

small.t('ns.1', { name: 'x' });
small.t('ns.0');
small.t('ns.5');
small.t(pair, { name: 'x' });
small.l('en', 'ns.2', { name: 'x' });
wrapperSmall('ns.3', { name: 'x' });
controlSmall('ns.4', { name: 'x' });
large.t('ns.1', { name: 'x' });
large.t('ns.0');
large.t('ns.5');
large.t(pair, { name: 'x' });
large.l('en', 'ns.2', { name: 'x' });
wrapperLarge('ns.3', { name: 'x' });
controlLarge('ns.4', { name: 'x' });

// The wrapper's spelling and `t` are one type.
export const wrapped: Wrapper<Small> = small.t;
export const unwrapped: typeof small.t = wrapperSmall;
