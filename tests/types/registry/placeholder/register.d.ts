// What a generator writes before its first run: the same registration, with
// no keys.

interface TranslationSchema {}

declare namespace SvelteKitI18n {
  interface Register {
    schema: TranslationSchema;
  }
}
