// DynamoDB GameRepository (ADR 0006), on the single table from the foundation stack.
//
//   Quiz          PK HOST#{hostId}       SK QUIZ#{quizId}     quiz
//   Game          PK GAME#{gameId}       SK META              game, version, GSI1PK/GSI1SK*
//   Join Code     PK JOINCODE#{code}     SK META              gameId
//   Active Game   PK HOST#{hostId}       SK ACTIVE_GAME       gameId
//   History       PK HOST#{hostId}       SK HISTORY#{gameId}  record
//   Generations   PK HOST#{hostId}       SK QUOTA#{day}       used, ttl (FR-2.7)
//
// * Unfinished Games carry GSI1PK=UNFINISHED and GSI1SK=lastActivityAt, a sparse index the
//   abandonment sweeper queries (FR-8.4, M4).
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Game, Quiz } from '@quizapp/domain';
import {
  ConflictError,
  type GameRepository,
  type HistoryRecord,
  type StoredGame,
} from './repository.js';

const META = 'META';

export class DynamoRepository implements GameRepository {
  private readonly db: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    client: DynamoDBClient = new DynamoDBClient({}),
  ) {
    this.db = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async putQuiz(hostId: string, quiz: Quiz): Promise<void> {
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { PK: `HOST#${hostId}`, SK: `QUIZ#${quiz.quizId}`, quiz, version: 1 },
      }),
    );
  }

  async getStoredQuiz(hostId: string, quizId: string) {
    const res = await this.db.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `HOST#${hostId}`, SK: `QUIZ#${quizId}` },
        ConsistentRead: true,
      }),
    );
    if (!res.Item) return null;
    // Quizzes seeded before versioning existed count as version 1.
    return { quiz: res.Item.quiz as Quiz, version: (res.Item.version as number | undefined) ?? 1 };
  }

  async saveQuiz(hostId: string, quiz: Quiz, expectedVersion: number): Promise<number> {
    const version = expectedVersion + 1;
    await this.conditional(
      new PutCommand({
        TableName: this.tableName,
        Item: { PK: `HOST#${hostId}`, SK: `QUIZ#${quiz.quizId}`, quiz, version },
        ConditionExpression:
          expectedVersion === 1
            ? 'attribute_exists(PK) AND (attribute_not_exists(version) OR version = :expected)'
            : 'version = :expected',
        ExpressionAttributeValues: { ':expected': expectedVersion },
      }),
      `quiz ${quiz.quizId} is not at version ${expectedVersion}`,
    );
    return version;
  }

  async deleteQuiz(hostId: string, quizId: string): Promise<void> {
    await this.db.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: `HOST#${hostId}`, SK: `QUIZ#${quizId}` },
      }),
    );
  }

  async useGeneration(hostId: string, day: string, limit: number, now: number): Promise<boolean> {
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `HOST#${hostId}`, SK: `QUOTA#${day}` },
          UpdateExpression: 'ADD used :one SET #ttl = if_not_exists(#ttl, :ttl)',
          ConditionExpression: 'attribute_not_exists(used) OR used < :limit',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: {
            ':one': 1,
            ':limit': limit,
            // Kept a few days past the day it counts, then removed by DynamoDB TTL.
            ':ttl': Math.floor(now / 1000) + 3 * 24 * 60 * 60,
          },
        }),
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return false;
      throw err;
    }
  }

  async getQuiz(hostId: string, quizId: string): Promise<Quiz | null> {
    const res = await this.db.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `HOST#${hostId}`, SK: `QUIZ#${quizId}` },
      }),
    );
    return (res.Item?.quiz as Quiz | undefined) ?? null;
  }

  async listQuizzes(hostId: string): Promise<Quiz[]> {
    return this.queryAll<Quiz>(`HOST#${hostId}`, 'QUIZ#', 'quiz');
  }

  async getGame(gameId: string): Promise<StoredGame | null> {
    const res = await this.db.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `GAME#${gameId}`, SK: META },
        ConsistentRead: true, // the version we read must be current for the conditional save
      }),
    );
    if (!res.Item) return null;
    return { game: res.Item.game as Game, version: res.Item.version as number };
  }

  async createGame(game: Game): Promise<void> {
    await this.conditional(
      new PutCommand({
        TableName: this.tableName,
        Item: gameItem(game, 1),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
      `game ${game.gameId} exists`,
    );
  }

  async saveGame(game: Game, expectedVersion: number): Promise<number> {
    const version = expectedVersion + 1;
    await this.conditional(
      new PutCommand({
        TableName: this.tableName,
        Item: gameItem(game, version),
        ConditionExpression: 'version = :expected',
        ExpressionAttributeValues: { ':expected': expectedVersion },
      }),
      `game ${game.gameId} is not at version ${expectedVersion}`,
    );
    return version;
  }

  async claimJoinCode(joinCode: string, gameId: string): Promise<boolean> {
    return this.claim({ PK: `JOINCODE#${joinCode}`, SK: META, gameId });
  }

  async findGameIdByJoinCode(joinCode: string): Promise<string | null> {
    return this.claimHolder({ PK: `JOINCODE#${joinCode}`, SK: META });
  }

  async releaseJoinCode(joinCode: string): Promise<void> {
    await this.db.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: `JOINCODE#${joinCode}`, SK: META },
      }),
    );
  }

  async claimActiveGame(hostId: string, gameId: string): Promise<boolean> {
    return this.claim({ PK: `HOST#${hostId}`, SK: 'ACTIVE_GAME', gameId });
  }

  async getActiveGameId(hostId: string): Promise<string | null> {
    return this.claimHolder({ PK: `HOST#${hostId}`, SK: 'ACTIVE_GAME' });
  }

  async releaseActiveGame(hostId: string, gameId: string): Promise<void> {
    try {
      await this.db.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { PK: `HOST#${hostId}`, SK: 'ACTIVE_GAME' },
          ConditionExpression: 'gameId = :gameId',
          ExpressionAttributeValues: { ':gameId': gameId },
        }),
      );
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
      // Held by a different Game (or nobody): nothing to release.
    }
  }

  async listIdleGameIds(cutoff: number): Promise<string[]> {
    // GSI1 is sparse: only unfinished Games carry GSI1PK/GSI1SK (see gameItem).
    const ids: string[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :unfinished AND GSI1SK <= :cutoff',
          ExpressionAttributeValues: {
            ':unfinished': 'UNFINISHED',
            ':cutoff': activityKey(cutoff),
          },
          ExclusiveStartKey,
        }),
      );
      for (const item of res.Items ?? []) ids.push(String(item.PK).replace(/^GAME#/, ''));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return ids;
  }

  async putHistory(record: HistoryRecord): Promise<void> {
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { PK: `HOST#${record.hostId}`, SK: `HISTORY#${record.gameId}`, record },
      }),
    );
  }

  async listHistory(hostId: string): Promise<HistoryRecord[]> {
    // Small per Host, so sorting by finish time in memory is fine at this scale.
    const records = await this.queryAll<HistoryRecord>(`HOST#${hostId}`, 'HISTORY#', 'record');
    return records.sort((a, b) => b.finishedAt - a.finishedAt);
  }

  async getHistory(hostId: string, gameId: string): Promise<HistoryRecord | null> {
    const res = await this.db.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `HOST#${hostId}`, SK: `HISTORY#${gameId}` },
      }),
    );
    return (res.Item?.record as HistoryRecord | undefined) ?? null;
  }

  /** Every item under a partition whose sort key starts with `prefix`, paging as needed. */
  private async queryAll<T>(pk: string, prefix: string, attribute: string): Promise<T[]> {
    const items: T[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix },
          ExclusiveStartKey,
        }),
      );
      for (const item of res.Items ?? []) items.push(item[attribute] as T);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  /** Puts a claim item unless one exists; false if it was already claimed. */
  private async claim(item: { PK: string; SK: string; gameId: string }): Promise<boolean> {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return false;
      throw err;
    }
  }

  private async claimHolder(key: { PK: string; SK: string }): Promise<string | null> {
    const res = await this.db.send(
      new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }),
    );
    return (res.Item?.gameId as string | undefined) ?? null;
  }

  private async conditional(command: PutCommand, conflictMessage: string): Promise<void> {
    try {
      await this.db.send(command);
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) throw new ConflictError(conflictMessage);
      throw err;
    }
  }
}

function gameItem(game: Game, version: number): Record<string, unknown> {
  const unfinished =
    game.phase === 'FINISHED'
      ? {}
      : { GSI1PK: 'UNFINISHED', GSI1SK: activityKey(game.lastActivityAt) };
  return { PK: `GAME#${game.gameId}`, SK: META, game, version, ...unfinished };
}

/** Fixed-width, so the index's string sort key orders by time. */
function activityKey(at: number): string {
  return String(at).padStart(15, '0');
}
