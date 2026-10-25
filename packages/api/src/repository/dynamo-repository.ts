// DynamoDB GameRepository (ADR 0006), on the single table from the foundation stack.
//
//   Quiz          PK HOST#{hostId}       SK QUIZ#{quizId}     quiz
//   Game          PK GAME#{gameId}       SK META              game, version, GSI1PK/GSI1SK*
//   Join Code     PK JOINCODE#{code}     SK META              gameId
//   Active Game   PK HOST#{hostId}       SK ACTIVE_GAME       gameId
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
} from '@aws-sdk/lib-dynamodb';
import type { Game, Quiz } from '@quizapp/domain';
import { ConflictError, type GameRepository, type StoredGame } from './repository.js';

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
        Item: { PK: `HOST#${hostId}`, SK: `QUIZ#${quiz.quizId}`, quiz },
      }),
    );
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
    const quizzes: Quiz[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :quiz)',
          ExpressionAttributeValues: { ':pk': `HOST#${hostId}`, ':quiz': 'QUIZ#' },
          ExclusiveStartKey,
        }),
      );
      for (const item of res.Items ?? []) quizzes.push(item.quiz as Quiz);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return quizzes;
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
      : { GSI1PK: 'UNFINISHED', GSI1SK: String(game.lastActivityAt).padStart(15, '0') };
  return { PK: `GAME#${game.gameId}`, SK: META, game, version, ...unfinished };
}
