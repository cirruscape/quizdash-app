import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { HealthResponse } from '@quizapp/contracts';

/** GET /api/health — confirms the HTTP API, Lambda and CloudFront routing are wired up. */
export const handler = async (): Promise<APIGatewayProxyResultV2> => {
  const body = HealthResponse.parse({ status: 'ok', env: process.env.APP_ENV ?? 'local' });
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
};
