import type { Logger } from './types';

const loggerLevels = ['error', 'warn', 'debug'] as const;

export const loggerFactory = ({ logger = console, level = loggerLevels[1], prefix = '[i18n]: ' }: Logger.FactoryProps) => {
  // An unknown level would otherwise yield indexOf === -1 and silence everything.
  const levelIndex = loggerLevels.includes(level) ? loggerLevels.indexOf(level) : loggerLevels.indexOf('warn');

  return loggerLevels.reduce((acc, key, i) => ({
    ...acc,
    [key]: (value: any) => {
      if (levelIndex < i) return;
      try {
        // Inside the `try`: reading the method is consumer-controlled too — the
        // logger itself can be null, or expose the level through an accessor.
        // Custom loggers may not implement every level; skip rather than throw.
        if (typeof logger[key] !== 'function') return undefined;

        return logger[key](`${prefix}${value}`);
      } catch (error) {
        // A consumer's logger must never be able to take the library down.
        // Several call sites log from promise handlers that nothing awaits,
        // where a throw would surface as an unhandled rejection.
        return undefined;
      }
    },
  }), {} as Logger.T);
};

export let logger = loggerFactory({});

export const setLogger = (l: Logger.T) => { logger = l; };

// Single shape for every reported failure: context first, then the error, which
// the configured logger formats like any other value. Cannot throw —
// `loggerFactory` contains a custom logger's failures.
//
// Deliberately not deduplicated: a shared error object (a module-level
// constant, a cached rejection) would then be reported once for the whole
// process, and a failure nobody awaits has no other signal.
export const logError = (message: string, error?: any) => {
  logger.error(message);
  logger.error(error);
};
