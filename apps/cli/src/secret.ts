import { Keypair } from '@stellar/stellar-sdk';

/** The only way to give Keepalive a secret key. A command-line option would end up in shell history. */
export const SECRET_ENV = 'KEEPALIVE_SECRET';

export function readKeypair(env: Record<string, string | undefined>): Keypair {
  const secret = env[SECRET_ENV]?.trim();
  if (secret === undefined || secret === '') {
    throw new Error(
      `Set ${SECRET_ENV} to the secret key (it starts with S) of the account that pays the fee. ` +
        'It is only read from the environment, never from an option.',
    );
  }
  try {
    return Keypair.fromSecret(secret);
  } catch {
    // Never put the value in the message: it may be a real key with a typo.
    throw new Error(`${SECRET_ENV} is not a valid secret key. (Its value is not shown.)`);
  }
}
