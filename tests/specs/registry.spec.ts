import { describeRegistry } from '../utils/registry.js';

// The fixtures under tests/types/registry/ are programs of their own; this
// spec compiles them. The second copy of the core they meet is the build, so
// it runs after `npm run build`, as `npm test` does.
describeRegistry('source');
