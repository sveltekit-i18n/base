import type { serverHalf as ServerHalf } from './server.js';

const serverOnly = (): never => {
  throw new Error('[i18n]: `handle` and the server branch of `load` run on the server only.');
};

// What `#kit-server` resolves to under the `browser` condition: the browser
// bundle carries this instead of the server half.
export const serverHalf: typeof ServerHalf = () => ({ handle: serverOnly, load: serverOnly });
