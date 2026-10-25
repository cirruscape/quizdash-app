# A Game is stored as one DynamoDB item, written with optimistic locking

The domain's `decide()` works on a whole Game: its Players, the current Question's Answers, and the Quiz snapshot. So each Game is persisted as one DynamoDB item with a `version` attribute. Every command loads the item, runs `decide()`, and writes it back with a conditional put on the version it read, retrying from the load on conflict. This replaces PLAN §4's split into Player, Answer and Nickname items with atomic counters. That design avoided write conflicts, but enforced some rules twice (in the domain and in DynamoDB conditions) and made the repository reassemble the Game for every command. With at most 50 Players, a Game is around 50 KB (the item limit is 400 KB). Simultaneous Answers cost a few retries, not a failure.

## Consequences

- All Game rules live in one place, `decide()`, and storage only guarantees that no write is lost.
- Retries are capped, and conflicts are counted in a CloudWatch metric, so we'd notice if contention ever became a real problem. The fix then would be to move Answers back into separate items.
- Join Codes and each Host's one unfinished Game still need their own small claim items. Those are uniqueness constraints across Games, which one Game item can't enforce.
