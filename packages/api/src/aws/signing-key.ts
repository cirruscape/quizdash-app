// The Player token signing key, read once per Lambda container from Secrets Manager.
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const secrets = new SecretsManagerClient({});
let keyPromise: Promise<string> | undefined;

export function playerTokenKey(): Promise<string> {
  keyPromise ??= secrets
    .send(new GetSecretValueCommand({ SecretId: process.env.PLAYER_TOKEN_SECRET_ARN }))
    .then((res) => {
      if (!res.SecretString) throw new Error('Player token secret is empty');
      return res.SecretString;
    })
    .catch((err: unknown) => {
      keyPromise = undefined; // retry on the next request rather than caching a failure
      throw err;
    });
  return keyPromise;
}
