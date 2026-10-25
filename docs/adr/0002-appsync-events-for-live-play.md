# Live play pushes updates via AppSync Events; commands go over HTTP

Games need server-to-client pushes (Question opened/closed, scores revealed) to the Host and every Player. We use AWS AppSync Events with one channel per Game for pushes, while all commands (join, submit Answer, advance, close Question) go through a plain HTTP API to Lambda, which updates DynamoDB and then publishes. We rejected API Gateway WebSocket APIs because they require managing connection IDs and fan-out ourselves, and IoT Core MQTT because it's an unusual fit for a browser app. Clients never publish to channels directly, so the server stays the single source of truth.

## Consequences

- Anonymous Players need channel access without a Cognito identity. The join call returns a signed Player token, and a Lambda authoriser on AppSync Events allows that token to subscribe only, and only to its own Game's channel. Hosts subscribe with Cognito, and only the backend publishes, using IAM. The same token is the Player's reconnect credential, and removing the Player invalidates it.
