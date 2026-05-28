import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { loadDotenvFallback } from '../src/env-loader.js';

const tmpRoot = mkdtempSync(join(tmpdir(), 'kie-mcp-env-'));
afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* windows lock */
  }
});

describe('Phase 6 — env-loader eval', () => {
  let originalCwd: string;
  beforeEach(() => {
    originalCwd = process.cwd();
  });
  afterEach(() => {
    process.chdir(originalCwd);
  });

  test('loadDotenvFallback reads .env from cwd', () => {
    const dir = mkdtempSync(join(tmpRoot, 'cwd-'));
    writeFileSync(join(dir, '.env'), 'KIE_TEST_KEY_A=value-from-env\n');
    process.chdir(dir);
    const env: NodeJS.ProcessEnv = {};
    loadDotenvFallback(env);
    expect(env.KIE_TEST_KEY_A).toBe('value-from-env');
  });

  test('process.env real value wins over .env file value', () => {
    const dir = mkdtempSync(join(tmpRoot, 'precedence-'));
    writeFileSync(join(dir, '.env'), 'KIE_TEST_KEY_B=from-file\n');
    process.chdir(dir);
    const env: NodeJS.ProcessEnv = { KIE_TEST_KEY_B: 'from-process' };
    loadDotenvFallback(env);
    expect(env.KIE_TEST_KEY_B).toBe('from-process');
  });

  test('unexpanded placeholder ${VAR} is overridden by .env', () => {
    const dir = mkdtempSync(join(tmpRoot, 'placeholder-'));
    writeFileSync(join(dir, '.env'), 'KIE_API_KEY=real-key-from-env\n');
    process.chdir(dir);
    const env: NodeJS.ProcessEnv = { KIE_API_KEY: '${KIE_API_KEY}' };
    loadDotenvFallback(env);
    expect(env.KIE_API_KEY).toBe('real-key-from-env');
  });

  test('empty-string env is overridden by .env', () => {
    const dir = mkdtempSync(join(tmpRoot, 'empty-'));
    writeFileSync(join(dir, '.env'), 'KIE_TEST_KEY_C=from-file\n');
    process.chdir(dir);
    const env: NodeJS.ProcessEnv = { KIE_TEST_KEY_C: '' };
    loadDotenvFallback(env);
    expect(env.KIE_TEST_KEY_C).toBe('from-file');
  });

  test('comments and blank lines are skipped', () => {
    const dir = mkdtempSync(join(tmpRoot, 'comments-'));
    writeFileSync(
      join(dir, '.env'),
      '# header comment\n\nKIE_TEST_KEY_D=ok\n   \n# trailing\n',
    );
    process.chdir(dir);
    const env: NodeJS.ProcessEnv = {};
    loadDotenvFallback(env);
    expect(env.KIE_TEST_KEY_D).toBe('ok');
  });

  test('quoted values have quotes stripped', () => {
    const dir = mkdtempSync(join(tmpRoot, 'quotes-'));
    writeFileSync(
      join(dir, '.env'),
      'KIE_TEST_KEY_E="quoted-double"\nKIE_TEST_KEY_F=\'quoted-single\'\n',
    );
    process.chdir(dir);
    const env: NodeJS.ProcessEnv = {};
    loadDotenvFallback(env);
    expect(env.KIE_TEST_KEY_E).toBe('quoted-double');
    expect(env.KIE_TEST_KEY_F).toBe('quoted-single');
  });

  test('malformed lines do not throw and do not produce keys', () => {
    const dir = mkdtempSync(join(tmpRoot, 'malformed-'));
    // robOS .env line 71 has a shell-tail bug ("Ulmeanu: command not found")
    // We must tolerate this gracefully.
    writeFileSync(
      join(dir, '.env'),
      'KIE_TEST_KEY_G=good\nthis is not a key=value pair line\n123BAD=also-skipped\nKIE_TEST_KEY_H=also-good\n',
    );
    process.chdir(dir);
    const env: NodeJS.ProcessEnv = {};
    expect(() => loadDotenvFallback(env)).not.toThrow();
    expect(env.KIE_TEST_KEY_G).toBe('good');
    expect(env.KIE_TEST_KEY_H).toBe('also-good');
    expect(env['this is not a key']).toBeUndefined();
    expect(env['123BAD']).toBeUndefined();
  });

  test('absent .env is a silent no-op', () => {
    const dir = mkdtempSync(join(tmpRoot, 'absent-'));
    process.chdir(dir);
    const env: NodeJS.ProcessEnv = { EXISTING: 'untouched' };
    expect(() => loadDotenvFallback(env)).not.toThrow();
    expect(env.EXISTING).toBe('untouched');
  });
});
