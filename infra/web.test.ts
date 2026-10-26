// The web stack's viewer-request CloudFront Function, run from the template itself, so the
// tested code is exactly what deploys (M6: www redirects to the canonical domain).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface ViewerRequest {
  uri: string;
  querystring: Record<string, { value: string; multiValue?: { value: string }[] }>;
  headers: Record<string, { value: string }>;
}
type Handler = (event: { request: ViewerRequest }) => unknown;

/** The function's code from web.yaml, with the stack's DomainName parameter substituted. */
function viewerRequest(domainName: string): Handler {
  const template = readFileSync(new URL('./web.yaml', import.meta.url), 'utf8');
  const block = /^ {6}FunctionCode: !Sub \|\n((?: {8}.*\n|\n)+)/m.exec(template);
  if (!block?.[1]) throw new Error('No FunctionCode block in web.yaml');
  const code = block[1].replace(/^ {8}/gm, '').replaceAll('${DomainName}', domainName);
  return new Function(`${code}\nreturn handler;`)() as Handler;
}

function request(host: string, uri: string, query: ViewerRequest['querystring'] = {}) {
  return { request: { uri, querystring: query, headers: { host: { value: host } } } };
}

describe('viewer-request function', () => {
  const handler = viewerRequest('trivolt.app');

  it('serves index.html for app routes, and files as they are', () => {
    expect(handler(request('trivolt.app', '/play/game'))).toMatchObject({ uri: '/index.html' });
    expect(handler(request('trivolt.app', '/assets/app-1a2b.js'))).toMatchObject({
      uri: '/assets/app-1a2b.js',
    });
  });

  it('redirects www to the canonical domain, keeping the path and query', () => {
    const response = handler(
      request('www.trivolt.app', '/join', {
        code: { value: 'ABC234' },
        tag: { value: 'a', multiValue: [{ value: 'a' }, { value: 'b' }] },
      }),
    );
    expect(response).toEqual({
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: 'https://trivolt.app/join?code=ABC234&tag=a&tag=b' } },
    });
  });

  it('redirects without a trailing "?" when there is no query', () => {
    expect(handler(request('www.trivolt.app', '/'))).toMatchObject({
      headers: { location: { value: 'https://trivolt.app/' } },
    });
  });

  it('never redirects when the stack has no domain', () => {
    const noDomain = viewerRequest('');
    expect(noDomain(request('d123.cloudfront.net', '/host'))).toMatchObject({
      uri: '/index.html',
    });
  });
});
