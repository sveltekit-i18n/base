import { describe, expect, it } from 'vitest';

import { compile } from '../utils/tsc.js';

// The program under tests/types/strict/ compiles the build, so it runs after
// `npm run build`, as `npm test` does.
describe('the declarations, under the options an app may add to `strict`', () => {
  it('take what `preload()` resolves as the commit\'s token', async () => {
    expect(await compile('strict/tsconfig.json')).toBe('');
  }, 60_000);
});
