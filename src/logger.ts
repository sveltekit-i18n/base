import type { Logger } from './types';

const loggerLevels = ['error', 'warn', 'debug'] as const;

export const loggerFactory = ({ logger = console, level = loggerLevels[1], prefix = '[i18n]: ' }: Logger.FactoryProps) => loggerLevels.reduce((acc, key, i) => ({
  ...acc,
  [key]: (value: string) => loggerLevels.indexOf(level) >= i && logger[key](`${prefix}${value}`),
}), {} as Logger.T);

export let logger = loggerFactory({});

export const setLogger = (l: Logger.T) => { logger = l; };
