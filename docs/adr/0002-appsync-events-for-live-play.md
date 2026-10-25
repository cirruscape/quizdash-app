# Live play pushes updates via AppSync Events; commands go over HTTP

Games need server-to-client pushes (Question opened/closed, scores revealed) to the Host and every Player. We use AWS AppSync Events with one channel per Game for pushes, while all commands (join, submit Answer, advance, close Question) go through a plain HTTP API to Lambda, which updates DynamoDB and then publishes. We rejected API Gateway WebSocket APIs because they require managing connection IDs and fan-out ourselves, and IoT Core MQTT because it's an unusual fit for a browser app. Clients never publish to channels directly, so the server stays the single source of truth.

## Consequences

- Anonymous Players need channel access without a Cognito identity. The join call returns a signed Player token, and a Lambda authoriser on AppSync Events allows that token to subscribe only, and only to its own Game's channel. Hosts subscribe with Cognito, and only the backend publishes, using IAM. The same token is the Player's reconnect credential, and removing the Player invalidates it.
- **AppSync Events delivers at most once, on a best-effort basis.** The first smoke-test runs against dev lost real events: all three bot Players missed one event that the Host's subscription to the same channel received. In isolation, 3 subscribers × 20 events all arrived. Events are therefore notifications, never the record. The snapshot endpoints are the source of truth (PLAN §2). Every client must:
  - re-fetch its snapshot on load, on reconnect, and whenever an event's `version` skips a number;
  - re-fetch when an expected event is overdue. For example, poll briefly once a Question's deadline has passed without a Reveal, or after the Host acts without an event following.

  The smoke test does exactly this, and reports how many events it had to recover.
