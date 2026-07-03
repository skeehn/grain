// Test preload: point all ~/.grain state at a throwaway temp dir so tests
// never touch the user's real config, sessions, or skills.
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.GRAIN_HOME = mkdtempSync(join(tmpdir(), 'grain-test-'));
