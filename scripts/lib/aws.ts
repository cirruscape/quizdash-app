// Shared helpers for the seed and smoke scripts: stack outputs and a signed-in test Host.
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomBytes } from 'node:crypto';

export const APP_ENV = process.env.APP_ENV ?? 'dev';
export const REGION = process.env.AWS_REGION ?? 'ap-southeast-2';

const cfn = new CloudFormationClient({ region: REGION });
const cognito = new CognitoIdentityProviderClient({ region: REGION });

/** All outputs of quizapp-{env}-{stack}, keyed by output name. */
export async function stackOutputs(stack: string): Promise<Record<string, string>> {
  const res = await cfn.send(
    new DescribeStacksCommand({ StackName: `quizapp-${APP_ENV}-${stack}` }),
  );
  const outputs: Record<string, string> = {};
  for (const o of res.Stacks?.[0]?.Outputs ?? []) {
    if (o.OutputKey && o.OutputValue) outputs[o.OutputKey] = o.OutputValue;
  }
  return outputs;
}

/** The Cognito user ID (sub) for an email, or null if there's no such Host. */
export async function hostIdForEmail(userPoolId: string, email: string): Promise<string | null> {
  try {
    const user = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }),
    );
    return user.UserAttributes?.find((a) => a.Name === 'sub')?.Value ?? null;
  } catch (err) {
    if (err instanceof UserNotFoundException) return null;
    throw err;
  }
}

/**
 * Signs in the dedicated smoke-test Host, creating it on first use. Its password is reset to a
 * fresh random value on every run and never stored anywhere.
 */
export async function signInSmokeHost(
  userPoolId: string,
  clientId: string,
): Promise<{ hostId: string; idToken: string }> {
  const email = `smoke-host+${APP_ENV}@quizapp.invalid`;
  if (!(await hostIdForEmail(userPoolId, email))) {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
      }),
    );
  }
  const password = `Sm0ke-${randomBytes(18).toString('base64url')}`;
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  );
  const auth = await cognito.send(
    new AdminInitiateAuthCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );
  const idToken = auth.AuthenticationResult?.IdToken;
  const hostId = await hostIdForEmail(userPoolId, email);
  if (!idToken || !hostId) throw new Error('smoke Host sign-in failed');
  return { hostId, idToken };
}
