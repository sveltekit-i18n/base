# API Docs

[Config](#config)\
[Properties and methods](#instance-methods-and-properties)


## Config

### `translations`?: __[Translations.T](https://github.com/sveltekit-i18n/base/blob/master/src/types.ts)__
This property defines translations, which should be in place before `loaders` will trigger. It's useful for synchronous translations (e.g. locally defined language names which are same for all language mutations).

### `loaders`?: __[Loader.LoaderModule[]](https://github.com/sveltekit-i18n/base/blob/master/src/types.ts)__
You can use `loaders` to define your asyncronous translation load. All loaded data are stored so loader is triggered only once – in case there is no previous version of the translation. It can get refreshed according to `config.cache`.\
Each loader can include:

`locale`: __string__ – locale (e.g. `en`, `de`) which is this loader for.

`key`: __string__ – represents the translation namespace. This key is used as a translation prefix so it should be module-unique. You can access your translation later using `$t('key.yourTranslation')`. It shouldn't include `.` (dot) character.

`loader`:__() => Promise<Record<any, any>>__ – is a function returning a `Promise` with translation data. You can use it to load files locally, fetch it from your API etc...

`routes`?: __Array<string | RegExp>__ – can define routes this loader should be triggered for. You can use Regular expressions too. For example `[/\/.ome/]` will be triggered for `/home` and `/rome` route as well (but still only once). Leave this `undefined` in case you want to load this module with any route (useful for common translations).

### `preprocess`?: __'full' | 'preserveArrays' | 'none' | (input: Translations.Input) => any__
Defines a preprocess strategy or a custom preprocess function. Preprocessor runs immediately after the translation data load. This is set to `'full'` by default.

Examples for input:
```json
{"a": {"b": [{"c": {"d": 1}}, {"c": {"d": 2}}]}}
```

`'full'` (default) setting will result in:
```json
{"a.b.0.c.d": 1, "a.b.1.c.d": 2}
```

`'preserveArrays'` in:
```json
{"a.b": [{"c.d": 1}, {"c.d": 2}]}
```

`'none'` (nothing's changed):
```json
{"a": {"b": [{"c": {"d": 1}}, {"c": {"d": 2}}]}}
```

Custom preprocess function `(input) => JSON.parse(JSON.stringify(input).replace('1', '"🦄"'))` will output:

```json
{"a": {"b": [{"c": {"d": "🦄"}}, {"c": {"d": 2}}]}}
```


### `parser`: __[Parser.T](https://github.com/sveltekit-i18n/base/blob/master/src/types.ts)__
This property defines translation syntax you want to use. For more, see [Parsers](https://github.com/sveltekit-i18n/parsers#readme).

### `initLocale`?: __string__
If you set this property, translations will be initialized immediately using this locale.

### `fallbackLocale`?: __string__
If you set this property, translations are automatically loaded not for current `$locale` only, but for this locale as well. In case there is no translation for current `$locale`, fallback locale translation is used instead of translation key placeholder. This is also used as a fallback when unknown locale is set.

Note that it's not recommended to use this property if you don't really need it. It may affect your data load.

### `fallbackValue`?: __any__
By default, translation key is returned in case no translation is found for given translation key. For example, `$t('unknown.key')` will result in `'unknown.key'` output. You can set this output value using this config prop.

### `cache`?: __number__
When you are running your app on Node.js server, translations are loaded only once during the SSR. This property allows you to setup a refresh period in milliseconds when your translations are refetched on the server. The default value is `86400000` (24 hours).

Tip: You can set to `Number.POSITIVE_INFINITY` to disable server-side refreshing.

### `log.level`?: __'error' | 'warn' | 'debug'__
You can manage log level using this property (default: `'warn'`).

### `log.prefix`?: __string__
You can prefix output logs using this property (default: `'[i18n]: '`).

### `log.logger`?: __[Logger.T](https://github.com/sveltekit-i18n/base/blob/master/src/types.ts)__
You can setup your custom logger using this property (default: `console`).

## Instance methods and properties

Each `sveltekit-i18n` instance includes these properties and methods:

### `loading`: __Readable\<boolean> & { toPromise: () => Promise<void[]>; get: () => boolean; }__ 
This readable store indicates wheter translations are loading or not. It can be converted to promise using `.toPromise()` method.

### `initialized`: __Readable\<boolean>__
This readable store returns `true` after first translation successfully initialized.

### `locale`: __Writable\<string> & { get: () => string }__
You can obtain and set current locale using this writable store.

### `locales`: __Readable<string[]>__
Readable store, containing all instance locales.

### `translations`: __Readable\<{ [locale: string]: { [key: string]: string; } }> & { get: () => string; }__
Readable store, containing all loaded translations in dot-notation format.

### `t`: __Readable<(key: string, vars?: Record<any, any>) => string> & { get: (key: string; vars?: Record<any, any>) => string; }__
This readable store returns a function you can use to obtain your (previously loaded) translations for given translation key and interpolation variables (you can use it like `$t('my.key', { variable: 'value' })` in Svelte files). You can also use `t.get` method to get the translation (e.g. `t.get('my.key', { variable: 'value' })`), which is handy in `.js` (or `.ts`) files.

### `l`: __Readable<(locale: string, key: string, vars?: Record<any, any>) => string> & { get: (locale: string, key: string, vars?: Record<any, any>) => string; }__
This readable store returns a function you can use to obtain your (previously loaded) translations for given locale, translation key and interpolation variables (you can use it like `$l('en', 'my.key', { variable: 'value' })` in Svelte files). You can also use `l.get` method to get the translation (e.g. `l.get('en', 'my.key', { variable: 'value' })`), which is handy in `.js` (or `.ts`) files.

### `loadConfig`: __(config: Config) => Promise\<void>__
You can load a new `config` using this method.

### `setLocale`: __(locale: string) => Promise<void>__
This method sets a locale safely. It prevents uppercase characters and doesn't set it in case the locale does not exist in `loaders` config or `translations` store.

### `setRoute`: __(route: string) => Promise<void>__
Sets a new route value, if given value is not equal to current value.

### `getTranslationProps`: __(locale: string, route?: string) => Promise\<Array<{ [locale: string]: Record<string, string>; }, Record<string, string[]>>>__
According to input props (`locale` and `route`), this method triggers `loaders`, which haven't been already triggered, and returns appropriate `translations` and `keys`. This output can be used later as input parameters of `addTranslations` method.

### `addTranslations`: __(translations?: { [locale: string]: Record<string, any>; }, keys?: Record<string, string[]> | undefined) => void__
This method allows you to store loaded translations in `translations` readable.

`translations` – this parameter should contain an object, containing translations objects for locales you want to add.

For example: 
```jsonc
{
  "en": {
    "common": {
      "title": "text"
    }
  }
}
```

or with dot notation:
```json
{
  "en": {
    "common.text": "Enghlish text"
  },
  "es": {
    "common.text": "Spanish text"
  }
}
```

`keys` – this parameter should contain corresponding keys from your `loaders` config, so the translation is not loaded duplicitly in future. If `keys` are not provided, translation keys are taken automatically from the `translations` parameter as the first key (or value before the first dot in dot notation) under every locale.

For example, for the previous case it would be:
```json
{
  "en": ["common"],
  "es": ["common"]
}
```

### `loadTranslations`: __(locale: string, route?: string) => Promise\<void>__
This method encapsulates `setLocale` and `setRoute` methods. According on changes, `getTranslationProps` and `addTranslations` methods are called and new translations are stored in `translations` readable.
