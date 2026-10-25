// The signed-in Host's Cognito ID token, refreshed by Amplify as needed. Used for the HTTP API
// (its JWT authoriser) and for AppSync Events (our Lambda authoriser).
import { fetchAuthSession } from 'aws-amplify/auth';

export async function hostToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error('not signed in');
  return token;
}
