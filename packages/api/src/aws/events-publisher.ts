// Publishes to AppSync Events over HTTP, signed with the Lambda's IAM role (ADR 0002): the
// backend is the only publisher. AppSync accepts up to five events per request.
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import type { ChannelMessage, Publish } from '../service/events.js';

const MAX_EVENTS_PER_REQUEST = 5;

export function createEventsPublisher(httpDomain: string, region: string): Publish {
  const signer = new SignatureV4({
    service: 'appsync',
    region,
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  return async (messages) => {
    // Consecutive messages for the same channel are batched, preserving overall order.
    for (const batch of batches(messages)) {
      const body = JSON.stringify({
        channel: batch.channel,
        events: batch.events.map((e) => JSON.stringify(e)),
      });
      const signed = await signer.sign(
        new HttpRequest({
          method: 'POST',
          protocol: 'https:',
          hostname: httpDomain,
          path: '/event',
          headers: { host: httpDomain, 'content-type': 'application/json' },
          body,
        }),
      );
      const res = await fetch(`https://${httpDomain}/event`, {
        method: 'POST',
        headers: signed.headers as Record<string, string>,
        body,
      });
      if (!res.ok) {
        throw new Error(`AppSync publish failed: ${res.status} ${await res.text()}`);
      }
    }
  };
}

function batches(messages: ChannelMessage[]): { channel: string; events: unknown[] }[] {
  const out: { channel: string; events: unknown[] }[] = [];
  for (const { channel, event } of messages) {
    const last = out.at(-1);
    if (last && last.channel === channel && last.events.length < MAX_EVENTS_PER_REQUEST) {
      last.events.push(event);
    } else {
      out.push({ channel, events: [event] });
    }
  }
  return out;
}
