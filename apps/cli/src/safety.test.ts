import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { SECRET_ENV } from './secret.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = resolve(HERE, '../dist/index.js');
const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const UNREACHABLE_RPC = 'http://127.0.0.1:1';

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env[SECRET_ENV];
  delete env['GOOGLE_CLOUD_PROJECT'];

  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      process.execPath,
      [CLI_ENTRY, ...args],
      { env, timeout: 20_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          rejectPromise(error);
          return;
        }
        resolvePromise({
          code: error ? (error.code as number) : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

describe('CLI safety refusals (built binary, no network, no key)', () => {
  it('has built apps/cli/dist/index.js before running tests', () => {
    expect(existsSync(CLI_ENTRY)).toBe(true);
  });

  for (const command of ['extend', 'restore'] as const) {
    describe(command, () => {
      it(
        'exits 1 without --network and states that --network is required',
        async () => {
          const result = await runCli([command, CONTRACT_ID, '--rpc', UNREACHABLE_RPC]);

          expect(result.code).toBe(1);
          expect(result.stdout).toBe('');
          expect(result.stderr).toMatch(new RegExp(`${command} needs --network`));
        },
        20_000,
      );

      it(
        'exits 1 with --network mainnet and states that mainnet is not supported yet',
        async () => {
          const result = await runCli([
            command,
            CONTRACT_ID,
            '--network',
            'mainnet',
            '--rpc',
            UNREACHABLE_RPC,
          ]);

          expect(result.code).toBe(1);
          expect(result.stdout).toBe('');
          expect(result.stderr).toContain('mainnet is not supported yet');
        },
        20_000,
      );

      it(
        'exits 1 with --network testnet when --keys-file is missing',
        async () => {
          const result = await runCli([
            command,
            CONTRACT_ID,
            '--network',
            'testnet',
            '--rpc',
            UNREACHABLE_RPC,
          ]);

          expect(result.code).toBe(1);
          expect(result.stdout).toBe('');
          expect(result.stderr).toContain('--keys-file');
        },
        20_000,
      );
    });
  }
});
