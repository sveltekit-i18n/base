import { I18n } from '@sveltekit-i18n/base';

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

// Mapped types with an `as` clause: TypeScript instantiates the name type once
// per key each time it reads `keyof` of one, so a call that reads the whole key
// set shows in the instantiation count. A key starting with `0` takes no
// payload.
type Payload<K extends string> = K extends `0${string}` ? never : { name: string };
type Flat<N extends string> = { [K in N as `k${K}`]: Payload<K> };
type Namespaced<N extends string> = { [K in N as K extends `${infer A}${infer B}${infer C}` ? `ns${A}${B}.k${C}` : never]: Payload<K> };

// A payload of its own per key, as a generator writes them, each naming a
// property of its own: a key outside the schema types the payload over every
// key, an intersection that does not collapse.
type Distinct<N extends string> = { [K in N as `k${K}`]: { [P in `name${K}`]: string } };

const parser = { parse: (value: unknown) => `${value}` };

const flat1k = new I18n({ parser, schema: {} as Flat<`${Digit}${Digit}${Digit}`> });
const flat10k = new I18n({ parser, schema: {} as Flat<`${Digit}${Digit}${Digit}${Digit}`> });
const namespaced10k = new I18n({ parser, schema: {} as Namespaced<`${Digit}${Digit}${Digit}${Digit}`> });
const distinct1k = new I18n({ parser, schema: {} as Distinct<`${Digit}${Digit}${Digit}`> });

// The first call of each shape — the method, and whether it passes a payload —
// instantiates what that shape needs once per subject; the second is the one
// measured, each on digits no earlier call used, since the checker caches a
// conditional type by its arguments and every subject's payload reads them. `checker.ts` reads the subject and the
// call from each statement.
flat1k.t('k999', { name: 'x' });
flat1k.t('k123', { name: 'x' });
flat1k.t('k099');
flat1k.t('k012');
flat1k.l('en', 'k888', { name: 'x' });
flat1k.l('en', 'k456', { name: 'x' });

flat10k.t('k9999', { name: 'x' });
flat10k.t('k1234', { name: 'x' });
flat10k.t('k0999');
flat10k.t('k0123');
flat10k.l('en', 'k8888', { name: 'x' });
flat10k.l('en', 'k4567', { name: 'x' });

namespaced10k.t('ns98.k76', { name: 'x' });
namespaced10k.t('ns23.k45', { name: 'x' });
namespaced10k.t('ns07.k65');
namespaced10k.t('ns02.k34');
namespaced10k.l('en', 'ns87.k65', { name: 'x' });
namespaced10k.l('en', 'ns56.k78', { name: 'x' });

// A call on a key outside the schema is measured as it comes, after a call that
// instantiates the signature: a second one would find the payload over every
// key cached.
distinct1k.t('k999', { name999: 'x' });
// @ts-expect-error The key is not in the schema.
distinct1k.t('missing');
