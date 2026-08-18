import type { Logger } from './types.js';

const loggerLevels = ['error', 'warn', 'debug'] as const;

export const loggerFactory = ({ logger = console, level = loggerLevels[1], prefix = '[i18n]: ' }: Logger.FactoryProps) => {
  // An unknown level would otherwise yield indexOf === -1 and silence everything.
  const levelIndex = loggerLevels.includes(level) ? loggerLevels.indexOf(level) : loggerLevels.indexOf('warn');

  return loggerLevels.reduce((acc, key, i) => ({
    ...acc,
    [key]: (value: any) => {
      if (levelIndex < i) return undefined;
      try {
        // Inside the `try`: the logger is consumer code — it can be null, omit
        // a level, or throw. Several call sites log from promise handlers that
        // nothing awaits, where a throw would become an unhandled rejection.
        if (typeof logger[key] !== 'function') return undefined;

        return logger[key](`${prefix}${value}`);
      } catch (error) {
        return undefined;
      }
    },
  }), {} as Logger.T);
};

export let logger = loggerFactory({});

export const setLogger = (l: Logger.T) => { logger = l; };

// Single shape for every reported failure: context first, then the error,
// which the configured logger formats like any other value.
export const logError = (message: string, error?: any) => {
  logger.error(message);
  logger.error(error);
};
