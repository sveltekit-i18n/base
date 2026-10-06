# Benchmark

What `npm run bench` measured on `@sveltekit-i18n/base` 3.3.0, written by the release that published it. A pull request compares its branch with its base in a comment; this file keeps the figures of each release beside its code.

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
| the first page in the browser without a hand-off, its first commit until settled (10,000 keys) | 1.03 ms | 1.01 ms to 1.05 ms |
| t, a hit (10,000 keys) | 0.476 µs | 0.471 µs to 0.509 µs |
| t, a missing key (10,000 keys) | 0.533 µs | 0.516 µs to 0.562 µs |
| t, from fallbackLocale (10,000 keys) | 0.485 µs | 0.471 µs to 0.528 µs |
| t, with params (10,000 keys) | 0.451 µs | 0.436 µs to 0.476 µs |
| l, a hit (10,000 keys) | 0.684 µs | 0.676 µs to 0.732 µs |
| l, a hit in a locale Intl rejects | 0.645 µs | 0.639 µs to 0.745 µs |
| Object.keys of a loaded table of 200 keys | 2.61 µs | 2.49 µs to 2.83 µs |
| new I18n, 2,000 loader descriptors of 5 locales each | 9.95 ms | 9.04 ms to 11 ms |
| addTranslations, preprocess 'full' (10,000 nested keys) | 1.94 ms | 1.9 ms to 1.96 ms |
| addTranslations, preprocess 'preserveArrays' (10,000 nested keys) | 1.91 ms | 1.91 ms to 1.94 ms |
| addTranslations, preprocess 'none' (10,000 nested keys) | 0.00958 ms | 0.00931 ms to 0.00994 ms |
| addTranslations, preprocess 'full' (100,000 nested keys) | 25.6 ms | 25.4 ms to 26 ms |
| addTranslations, preprocess 'preserveArrays' (100,000 nested keys) | 25.6 ms | 25.3 ms to 26.5 ms |
| addTranslations, preprocess 'none' (100,000 nested keys) | 0.00807 ms | 0.00785 ms to 0.00879 ms |
| addTranslations, a seed over a flat namespace of 2,000 delivered keys | 4.26 ms | 4.22 ms to 4.83 ms |
| a namespace delivered again, filled by 1 loader (beside 10,000 keys) | 2.89 ms | 2.87 ms to 3.22 ms |
| a namespace delivered again, filled by 10 loaders (beside 10,000 keys) | 3.25 ms | 3.24 ms to 3.66 ms |
| a namespace delivered again, filled by 50 loaders (beside 10,000 keys) | 9.02 ms | 8.93 ms to 9.12 ms |
| loadTranslations, 100 namespaces | 0.812 ms | 0.794 ms to 0.839 ms |
| setRoute, to new params among 200 routes | 0.0557 ms | 0.0548 ms to 0.0615 ms |
| a navigation to new params, a loader with cache: false beside a cached one | 0.0585 ms | 0.0494 ms to 0.0631 ms |
| setRoute, to new params among 200 routes of 50 locales (10,000 loaders) | 0.0588 ms | 0.0565 ms to 0.0647 ms |
| loadTranslations of a new instance, 100 namespaces of 100 locales (10,000 loaders) | 0.872 ms | 0.859 ms to 0.95 ms |
| loadTranslations again, 100 namespaces of 100 locales (10,000 loaders) | 1.22 ms | 1.19 ms to 1.34 ms |
| setLocale, between two loaded locales (10,000 keys) | 0.406 ms | 0.392 ms to 0.418 ms |
| snapshot({ records: true }) (10,000 keys) | 1.31 ms | 1.3 ms to 1.39 ms |
| snapshot({ records: true }), a locale and its fallback of 10 seeded namespaces of 5 keys | 50.7 µs | 50 µs to 52.8 µs |
| snapshot(), a level of 2,000 keys holding an own __proto__ key | 0.659 ms | 0.633 ms to 0.728 ms |
| hydrate() (10,000 keys) | 6.92 ms | 6.82 ms to 7.2 ms |
| the server load, a page render (10,000 keys) | 13 ms | 12.7 ms to 13.4 ms |
| the universal load, a page render after its server load (10,000 keys) | 0.205 ms | 0.201 ms to 0.226 ms |

## Heap

Bytes of heap retained, read in a process of their own without V8's compilers: they move by a few bytes from process to process, differ from one Node version to another, and a reading near zero, on either side of it, means nothing retained.

| Row | Median | Spread |
| --- | ---: | --- |
| heap retained by 10,000 navigations to new params | -184 B | -184 B to -184 B |
| heap retained per additional instance holding a table of the same 200 keys | 21,340 B | 21,340 B to 21,340 B |
| heap retained per additional instance holding a table of the same 1,000 keys | 71,454 B | 71,454 B to 71,454 B |
