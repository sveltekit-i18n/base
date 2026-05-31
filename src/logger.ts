import type { Logger } from './types';

const loggerLevels = ['error', 'warn', 'debug'] as const;

export const loggerFactory = ({ logger = console, level = loggerLevels[1], prefix = '[i18n]: ' }: Logger.FactoryProps) => {
  // An unknown level would otherwise yield indexOf === -1 and silence everything.
  const levelIndex = loggerLevels.includes(level) ? loggerLevels.indexOf(level) : loggerLevels.indexOf('warn');

  return loggerLevels.reduce((acc, key, i) => ({
    ...acc,
    [key]: (value: any) => {
      if (levelIndex < i) return;
      // Custom loggers may not implement every level; skip rather than throw.
      if (typeof logger[key] !== 'function') return;
      return logger[key](`${prefix}${value}`);
    },
  }), {} as Logger.T);
};

export let logger = loggerFactory({});

export const setLogger = (l: Logger.T) => { logger = l; };
