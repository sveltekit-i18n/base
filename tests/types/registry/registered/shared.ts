export const parser = { parse: (_value: unknown, _params: unknown[], _locale: string, key: string) => key };

export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

export const assert = <T extends true>(): T | void => undefined;
