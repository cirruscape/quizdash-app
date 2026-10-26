// The Nickname toxicity check (FR-5.3): Amazon Comprehend's DetectToxicContent. A Nickname is
// rejected if any category, or the overall toxicity, scores at or above the threshold, which is
// read from SSM (so it can be tuned without a deploy) and cached for five minutes.
import { ComprehendClient, DetectToxicContentCommand } from '@aws-sdk/client-comprehend';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const THRESHOLD_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_THRESHOLD = 0.5;

export function createToxicityCheck(thresholdParameterName: string | undefined) {
  const comprehend = new ComprehendClient({});
  const ssm = new SSMClient({});
  let cached: { value: number; at: number } | undefined;

  async function threshold(): Promise<number> {
    if (!thresholdParameterName) return DEFAULT_THRESHOLD;
    if (cached && Date.now() - cached.at < THRESHOLD_CACHE_MS) return cached.value;
    const res = await ssm.send(new GetParameterCommand({ Name: thresholdParameterName }));
    const value = Number(res.Parameter?.Value);
    cached = { value: Number.isFinite(value) ? value : DEFAULT_THRESHOLD, at: Date.now() };
    return cached.value;
  }

  return async (nickname: string): Promise<boolean> => {
    const [limit, res] = await Promise.all([
      threshold(),
      comprehend.send(
        new DetectToxicContentCommand({ TextSegments: [{ Text: nickname }], LanguageCode: 'en' }),
      ),
    ]);
    const result = res.ResultList?.[0];
    const scores = [result?.Toxicity ?? 0, ...(result?.Labels ?? []).map((l) => l.Score ?? 0)];
    return scores.some((score) => score >= limit);
  };
}
