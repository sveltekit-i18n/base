import type { Logger } from './types.js';

const loggerLevels = ['error', 'warn', 'debug'] as const;

export const loggerFactory = ({ logger = console, level = loggerLevels[1], prefix = '[i18n]: ' }: Logger.FactoryProps) => {
  // An unknown level would otherwise yield indexOf === -1 and silence everything.
  const levelIndex = loggerLevels.includes(level) ? loggerLevels.indexOf(level) : loggerLevels.indexOf('warn');

  return loggerLevels.reduce((acc, key, i) => ({
    ...acc,
    [key]: (message: string, error?: unknown) => {
      if (levelIndex < i) return undefined;
      try {
        // Inside the `try`: the logger is consumer code — it can be null, omit
        // a level, or throw. Several call sites log from promise handlers that
        // nothing awaits, where a throw would become an unhandled rejection.
        if (typeof logger[key] !== 'function') return undefined;

        // The prefix applies to the message only; the error passes through raw
        // so the logger formats its stack (or serializes it) itself. Forwarded
        // only when present — `console` would otherwise print `undefined`.
        if (error === undefined) return logger[key](`${prefix}${message}`);

        return logger[key](`${prefix}${message}`, error);
      } catch {
        return undefined;
      }
    },
  }), {} as Logger.T);
};

export let logger = loggerFactory({});

export const setLogger = (l: Logger.T) => { logger = l; };

// Single shape for every reported failure: the context message first, the raw
// error alongside it, in one call — so a consumer's logger sees them together.
export const logError = (message: string, error?: unknown) => {
  logger.error(message, error);
};
