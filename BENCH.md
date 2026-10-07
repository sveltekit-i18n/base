# Benchmark

What `npm run bench` measured on `@sveltekit-i18n/base` 3.3.2, written by the release that published it. A pull request compares its branch with its base in a comment; this file keeps the figures of each release beside its code.

Node v24.21.0, linux x64; times and heap readings are medians of 11 processes, a time each the median of its rounds; a spread leaves out the lowest and the highest quarter of them, rounded down.

## Counts

Calls, keys, effect runs, and checker instantiations and relations: the same on every machine. A pull request that grows one fails its benchmark job unless it carries the `bench-accepted` label.

| Row | Value |
| --- | ---: |
| instantiations, t with a payload (1,000 flat keys) | 101 instantiations |
| instantiations, t without a payload (1,000 flat keys) | 74 instantiations |
| instantiations, l with a payload (1,000 flat keys) | 101 instantiations |
| instantiations, t with a payload (10,000 flat keys) | 101 instantiations |
| instantiations, t without a payload (10,000 flat keys) | 74 instantiations |
| instantiations, l with a payload (10,000 flat keys) | 101 instantiations |
| instantiations, t with a payload (10,000 keys in namespaces) | 101 instantiations |
| instantiations, t without a payload (10,000 keys in namespaces) | 74 instantiations |
| instantiations, l with a payload (10,000 keys in namespaces) | 101 instantiations |
| instantiations, t with a key outside the schema (1,000 keys, a payload of its own each) | 46,027 instantiations |
| relations, t with a key outside the schema (1,000 keys, a payload of its own each) | 4,001 relations |
| keys preprocessed, a namespace filled by 1 loader delivered again (beside 10,000 keys) | 10,020 keys |
| keys preprocessed, a namespace filled by 10 loaders delivered again (beside 10,000 keys) | 10,200 keys |
| keys preprocessed, a namespace filled by 50 loaders delivered again (beside 10,000 keys) | 11,000 keys |
| loader calls, 10 concurrent loads of 100 namespaces | 100 calls |
| loader calls, loading 100 loaded namespaces again | 0 calls |
| weak collection entries, 1,000 navigations to new params | 0 entries |
| loader calls, 100 navigations to new params, a loader with cache: false | 100 calls |
| loader calls, 100 navigations to new params, a cached loader | 100 calls |
| effect runs, an effect of 500 t calls, on setLocale to a loaded locale | 1 runs |
| parser calls, an effect of 500 t calls, on setLocale to a loaded locale | 500 calls |
| effect runs, an effect of 500 t calls, on a namespace landing | 1 runs |
| parser calls, an effect of 500 t calls, on a namespace landing | 500 calls |
| effect runs, an effect of 500 t calls, on another locale landing | 1 runs |
| parser calls, an effect of 500 t calls, on another locale landing | 500 calls |
| loader runs of a cache: false loader, a first page in the browser without a hand-off | 1 runs |

## Sizes

Bytes: the same on every machine.

| Row | Value |
| --- | ---: |
| snapshot({ records: true }) as devalue writes it (10,000 keys) | 234,549 B |
| browser bundle of the entry, minified | 30,398 B |
| browser bundle of the entry, minified and gzipped | 10,730 B |
| browser bundle of /utils, minified | 4,902 B |
| browser bundle of /utils, minified and gzipped | 2,425 B |
| browser bundle of /kit, minified | 36,972 B |
| browser bundle of /kit, minified and gzipped | 13,520 B |

## Times

Milliseconds and microseconds, of one machine at one time: compare them only with figures measured beside them.

| Row | Median | Spread |
| --- | ---: | --- |
| the first page in the browser without a hand-off, its first commit until settled (10,000 keys) | 1.81 ms | 1.71 ms to 1.9 ms |
| t, a hit (10,000 keys) | 0.742 µs | 0.726 µs to 0.753 µs |
| t, a missing key (10,000 keys) | 0.807 µs | 0.784 µs to 0.822 µs |
| t, from fallbackLocale (10,000 keys) | 0.792 µs | 0.772 µs to 0.802 µs |
| t, with params (10,000 keys) | 0.713 µs | 0.698 µs to 0.73 µs |
| l, a hit (10,000 keys) | 1.1 µs | 1.07 µs to 1.12 µs |
| l, a hit in a locale Intl rejects | 1.04 µs | 1.02 µs to 1.06 µs |
| Object.keys of a loaded table of 200 keys | 4.2 µs | 4.16 µs to 4.24 µs |
| new I18n, 2,000 loader descriptors of 5 locales each | 15.3 ms | 15.2 ms to 15.6 ms |
| addTranslations, preprocess 'full' (10,000 nested keys) | 2.46 ms | 2.39 ms to 2.5 ms |
| addTranslations, preprocess 'preserveArrays' (10,000 nested keys) | 2.45 ms | 2.41 ms to 2.48 ms |
| addTranslations, preprocess 'none' (10,000 nested keys) | 0.015 ms | 0.0139 ms to 0.0156 ms |
| addTranslations, preprocess 'full' (100,000 nested keys) | 37.9 ms | 35.8 ms to 38.7 ms |
| addTranslations, preprocess 'preserveArrays' (100,000 nested keys) | 37.2 ms | 36.1 ms to 39.2 ms |
| addTranslations, preprocess 'none' (100,000 nested keys) | 0.0176 ms | 0.0163 ms to 0.0273 ms |
| addTranslations, a seed over a flat namespace of 2,000 delivered keys | 5.46 ms | 5.38 ms to 5.72 ms |
| a namespace delivered again, filled by 1 loader (beside 10,000 keys) | 3.49 ms | 3.44 ms to 3.79 ms |
| a namespace delivered again, filled by 10 loaders (beside 10,000 keys) | 4.21 ms | 4.09 ms to 4.4 ms |
| a namespace delivered again, filled by 50 loaders (beside 10,000 keys) | 13.9 ms | 13.3 ms to 13.9 ms |
| loadTranslations, 100 namespaces | 1.03 ms | 1.02 ms to 1.04 ms |
| setRoute, to new params among 200 routes | 0.137 ms | 0.136 ms to 0.14 ms |
| a navigation to new params, a loader with cache: false beside a cached one | 0.132 ms | 0.128 ms to 0.133 ms |
| setRoute, to new params among 200 routes of 50 locales (10,000 loaders) | 0.126 ms | 0.124 ms to 0.131 ms |
| loadTranslations of a new instance, 100 namespaces of 100 locales (10,000 loaders) | 1.2 ms | 1.19 ms to 1.23 ms |
| loadTranslations again, 100 namespaces of 100 locales (10,000 loaders) | 1.68 ms | 1.68 ms to 1.7 ms |
| setLocale, between two loaded locales (10,000 keys) | 0.595 ms | 0.564 ms to 0.671 ms |
| snapshot({ records: true }) (10,000 keys) | 1.75 ms | 1.72 ms to 1.84 ms |
| snapshot({ records: true }), a locale and its fallback of 10 seeded namespaces of 5 keys | 70.8 µs | 70.7 µs to 71.2 µs |
| snapshot(), a level of 2,000 keys holding an own __proto__ key | 0.684 ms | 0.681 ms to 1.1 ms |
| hydrate() (10,000 keys) | 10.2 ms | 9.75 ms to 10.5 ms |
| the server load, a page render (10,000 keys) | 23.1 ms | 22.8 ms to 23.3 ms |
| the universal load, a page render after its server load (10,000 keys) | 0.312 ms | 0.308 ms to 0.318 ms |

## Heap

Bytes of heap retained, read in a process of their own without V8's compilers: they move by a few bytes from process to process, differ from one Node version to another, and a reading near zero, on either side of it, means nothing retained.

| Row | Median | Spread |
| --- | ---: | --- |
| heap retained by 10,000 navigations to new params | -184 B | -184 B to -184 B |
| heap retained per additional instance holding a table of the same 200 keys | 21,340 B | 21,340 B to 21,340 B |
| heap retained per additional instance holding a table of the same 1,000 keys | 71,426 B | 71,426 B to 71,426 B |
