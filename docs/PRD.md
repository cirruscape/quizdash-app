# Quiz App: Product Requirements

- **Status:** Draft v1
- **Date:** 2026-10-25
- **Glossary:** [`GLOSSARY.md`](../GLOSSARY.md). Capitalised terms (Quiz, Game, Host, Player, …) are used exactly as defined there.
- **Decisions:** [`docs/adr/`](./adr/)

## 1. Summary

Quiz App is a live trivia game. A **Host** asks AI to generate a **Quiz** on any **Topic** and **Difficulty**, reviews it, then runs a **Game** of it in real time. **Players** join from their own phones or laptops with a **Join Code** and a **Nickname**, with no account needed. They answer multiple-choice **Questions** against the clock and compete on a speed-weighted **Leaderboard**. Every device shows the full Question, so a Game works just as well in one room as over a video call.

This is a learning project for a small number of users. It will be built entirely on AWS serverless services.

## 2. Goals and non-goals

### Goals

1. A Host can go from "I want a quiz about X" to a playable, reviewed Quiz in a couple of minutes, without writing any Questions themselves.
2. Live play feels responsive and fair. Everyone sees the same thing at the same time, and speed is measured by the server, not by client clocks.
3. Joining is effortless for Players: a code and a Nickname, nothing else.
4. Generated trivia is trustworthy enough that Players aren't arguing with the screen.
5. The system runs on AWS serverless resources with minimal operational overhead and near-zero cost when idle.

### Non-goals (v1)

- Self-study, spaced repetition, or async "take this quiz later" modes.
- Player accounts, profiles or cross-Game history for Players.
- Hand-writing or hand-editing Questions. Importing Quizzes from files.
- A shared library of Quizzes across Hosts.
- Question types other than single-answer multiple choice.
- Shuffled Question order or Question pools.
- A Kahoot-style "big screen shows the Question, phones show buttons" mode.
- Multiple simultaneous Games per Host.
- Multi-region deployment, high availability beyond AWS service defaults, or scale beyond the limits in §7.

## 3. Users

| Role       | Who                                                                                                          | Identity                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| **Host**   | Creates Quizzes and runs Games of them. Writes and runs their own Quizzes; there is no separate author role. | Signed-in account (email and password)             |
| **Player** | Takes part in one Game.                                                                                      | Anonymous; known only by Nickname within that Game |

## 4. User stories

### Host

- **H1.** As a Host, I can sign up and sign in with email and password.
- **H2.** As a Host, I can generate a new Quiz by entering a Topic, a Difficulty, a number of Questions and a default Time Limit.
- **H3.** As a Host, I can watch the progress of a Quiz being generated, and I'm told clearly if the Topic couldn't be generated.
- **H4.** As a Host, I can review a Draft Quiz, discard any Question or regenerate it individually, and then approve the Quiz so it becomes Ready.
- **H5.** As a Host, I can override the Time Limit for an individual Question while the Quiz is a Draft.
- **H6.** As a Host, I can see my Ready Quizzes and start a Game from any of them.
- **H7.** As a Host, I can show a Join Code and watch Players arrive in the Lobby, then start the Game.
- **H8.** As a Host, I control the pace: I open each Question, then advance from Reveal to the next Question.
- **H9.** As a Host, I see at Reveal how many Players chose each Option, plus the full Leaderboard.
- **H10.** As a Host, I can remove a disruptive Player at any time.
- **H11.** As a Host, if my device drops out, I can resume my Game from any device I'm signed in on.
- **H12.** As a Host, I can browse the history of my Finished Games.
- **H13.** As a Host, I can delete a Ready Quiz I no longer want, without losing the history of Games that used it.

### Player

- **P1.** As a Player, I can join a Game in its Lobby by entering a Join Code and a Nickname, without creating an account.
- **P2.** As a Player, if my Nickname is taken or not acceptable, I'm asked to choose another.
- **P3.** As a Player, I see each Question and its Options on my own device, along with a countdown.
- **P4.** As a Player, I can submit one Answer per Question; faster correct Answers earn more points.
- **P5.** As a Player, at Reveal I see the correct Option, the points I just earned and my current rank.
- **P6.** As a Player, if my phone locks or my browser reloads, I'm silently put back into the Game with my Nickname and Score intact.
- **P7.** As a Player, I see the final Leaderboard when the Game is Finished.

## 5. Functional requirements

### 5.1 Host accounts

- **FR-1.1** Hosts sign up and sign in with email and password, managed by Amazon Cognito.
- **FR-1.2** Every Quiz, Game and history record belongs to exactly one Host, and only that Host can see it.

### 5.2 Quiz generation

- **FR-2.1** To generate a Quiz, the Host provides:

  | Input               | Constraint           | Default |
  | ------------------- | -------------------- | ------- |
  | Topic               | Free text            | none    |
  | Difficulty          | Easy, Medium or Hard | none    |
  | Number of Questions | 5–20                 | 10      |
  | Default Time Limit  | 5–120 seconds        | 20 s    |

- **FR-2.2** Generation is asynchronous. Submitting the inputs immediately creates a **Draft Quiz** in a _generating_ state. The Host's client polls its status every few seconds until it is ready for review or has failed.
- **FR-2.3** Every generated Question is multiple choice, with 2–4 Options and exactly one correct.
- **FR-2.4** **Generate, then verify.** After producing Questions, the generator checks each one: is exactly one Option defensibly correct, and is the Question unambiguous? Questions that fail are dropped and regenerated before the Draft is offered for review.
- **FR-2.5** **No repeats.** The generator receives the text of the Host's existing Questions on similar Topics and avoids repeating them.
- **FR-2.6** If the model declines a Topic, the Draft fails with a plain message: "We couldn't generate a quiz on this topic. Try a different one."
- **FR-2.7** **Rate limit.** Each Host may run at most 20 generations per day. Generating a whole Quiz counts as one, and regenerating a single Question also counts as one. Once the limit is reached, the Host sees a clear message saying when it resets.

### 5.3 Review and the Quiz lifecycle

- **FR-3.1** A Quiz is either a **Draft Quiz** or a **Ready Quiz**.
- **FR-3.2** While a Quiz is a Draft, the Host can:
  - see every Question, its Options and which Option is correct;
  - discard a Question;
  - regenerate a single Question, which goes through the same verify step and counts toward the rate limit;
  - override the Time Limit of an individual Question, within 5–120 seconds;
  - approve the Draft, making it Ready, provided it still has **at least 5 Questions**. If discards take it below 5, the Host regenerates individual Questions to get back up to 5;
  - delete the Draft.

  Hosts cannot hand-edit Question or Option text.

- **FR-3.3** A Ready Quiz is immutable: its Questions, Options, order and Time Limits never change. To get a different Quiz, the Host generates a new one.
- **FR-3.4** A Host can delete a Ready Quiz. History records of Games that used it are kept and still show the Questions as they were played.
- **FR-3.5** A Draft can only be played once it has been approved.

### 5.4 Starting a Game and the Lobby

- **FR-4.1** A Host can start a Game from any of their own Ready Quizzes.
- **FR-4.2** A Host can have at most one unfinished Game at a time. Starting a new Game is blocked until the current one is Finished.
- **FR-4.3** Starting a Game creates it in the **Lobby** phase with a **Join Code**:
  - six uppercase characters, letters and digits, leaving out the look-alikes `0`, `O`, `1` and `I`;
  - unique among unfinished Games, so it may be reused once a Game is Finished.
- **FR-4.4** During the Lobby, the Host sees the Join Code and a live list of Players who have joined.
- **FR-4.5** Players can join **only** during the Lobby. Late joining is not supported. Once the first Question opens, new joins are rejected with a "This game has already started" message.
- **FR-4.6** A Game has at most 50 Players. Join attempts beyond that are rejected with a "This game is full" message.
- **FR-4.7** The Host starts the Game from the Lobby, which opens the first Question. It needs at least one Player who hasn't been removed.

### 5.5 Nicknames

- **FR-5.1** A Nickname must be 2–16 characters, using unaccented ASCII letters (A–Z, a–z), digits and spaces only, so "Zoë" is not allowed. It is trimmed before checking.
- **FR-5.2** A Nickname must be unique within its Game. The comparison ignores case and treats repeated spaces as one, so "Sam Smith", "sam smith" and "Sam Smith" clash. The Nickname is displayed as the Player typed it, trimmed.
- **FR-5.3** Every Nickname is checked with Amazon Comprehend toxic-content detection. It is rejected if any toxicity category scores **≥ 0.5**. This threshold is configurable without a code change.
- **FR-5.4** Nicknames are also checked against a small maintained blocklist, to catch obvious leetspeak or short forms the classifier misses.
- **FR-5.5** A rejected Nickname gets a generic prompt, "Please choose a different nickname", which doesn't say why.
- **FR-5.6** The Host can remove any Player at any time, as a backstop for anything the checks miss. A removed Player's device cannot rejoin that Game. Their Nickname stays taken for the rest of that Game.

### 5.6 Live play

- **FR-6.1** A Game moves through these phases:

  ```mermaid
  stateDiagram-v2
    [*] --> Lobby
    Lobby --> QuestionOpen: Host starts Game
    QuestionOpen --> Reveal: Time Limit expires / all Players answered
    Reveal --> QuestionOpen: Host advances (more Questions)
    Reveal --> Finished: Host advances (last Question)
    Lobby --> Finished: abandoned 24h
    QuestionOpen --> Finished: abandoned 24h
    Reveal --> Finished: abandoned 24h
  ```

- **FR-6.2** Questions are played in the Quiz's fixed order.
- **FR-6.3** **During Question Open**, every Player's device shows:
  - the full Question text;
  - all of its Options;
  - a countdown based on that Question's Time Limit.

  The Host has a control view showing a live "N of M answered" count. It doesn't show which Options were chosen until Reveal.

- **FR-6.4** **Answers.**
  - Each Player may submit one Answer per Question, and it cannot be changed.
  - Any further Answer from the same Player is rejected.
  - The server rejects Answers received after the deadline.
- **FR-6.5** **Server time is the authority.** The server records when each Question opens and the time it receives each Answer. Client clocks are never used for scoring or deadlines.
- **FR-6.6** **Closing a Question.**
  - The Question closes as soon as every Player in the Game has answered. Removed Players don't count. Disconnected Players still count, so a dead phone just means the Question runs to its Time Limit.
  - Otherwise it closes when its Time Limit expires. The Host's client asks the server to close it at the deadline.
  - The server ignores close requests sent before the deadline, unless every Player has answered.
- **FR-6.7** **Reveal.**
  - Each Player sees the correct Option, the points they earned on this Question and their current rank.
  - The Host sees how many Players chose each Option, plus the full Leaderboard.
- **FR-6.8** The Host advances from Reveal to the next Question. After the last Question, advancing finishes the Game.
- **FR-6.9** When the Game is **Finished**, the final Leaderboard is shown to the Host and every Player.
- **FR-6.10** All state changes, such as Players joining, Questions opening and closing, and Reveal, are pushed to the Host and every Player in real time.

### 5.7 Scoring and Leaderboard

- **FR-7.1** A correct Answer earns `round(1000 − 500 × elapsed / timeLimit)` points. `elapsed` runs from when the Question opens to when the server receives the Answer. So an instant Answer earns 1000 points and one at the deadline earns 500, falling in a straight line.
- **FR-7.2** A wrong Answer, or no Answer, earns 0 points. There are no penalties.
- **FR-7.3** A Player's **Score** is the sum of their points across the Game.
- **FR-7.4** The **Leaderboard** ranks Players by Score, highest first. Players with equal Scores share a rank, e.g. 1, 2, 2, 4.

### 5.8 Resilience

- **FR-8.1** **Player reconnect.**
  - When a Player joins, their device stores their Player token (see §8). Removing the Player invalidates it.
  - If the page reloads or the connection drops, the device silently rejoins as the same Player, with the same Nickname and Score, and resumes at the current phase.
  - This works in any phase, including after the Lobby. It counts as a reconnect, not a late join.
- **FR-8.2** A Player on a different device can't recover their identity, and can't join once the Lobby has closed.
- **FR-8.3** **Host resume.**
  - The Host can resume their unfinished Game from any device where they are signed in.
  - While the Host is away, the Game simply waits: no Question closes or advances without them.
  - If a Question's deadline passes while the Host is away, Answers are already rejected by the deadline (FR-6.4). The Question moves to Reveal as soon as the Host resumes.
- **FR-8.4** **Abandonment.** A Game with no activity for 24 hours is automatically Finished. Its partial Leaderboard is recorded in history. Answers to a Question that was still open aren't scored, so the partial Leaderboard reflects revealed Questions only.

### 5.9 Game history

- **FR-9.1** Every Finished Game is recorded in its Host's history, with:
  - the Quiz played, as a snapshot of its Questions;
  - the date and time;
  - the final Leaderboard: Nicknames, Scores and ranks;
  - for each Question, how many Players chose each Option.
- **FR-9.2** Only the Host who ran the Game can see its history. Players have no access after the Game.
- **FR-9.3** History is kept indefinitely.

## 6. User experience outline

There is one web app, with separate routes for three areas.

| Area             | Who    | Key screens                                                                                                                                     |
| ---------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authoring**    | Host   | Sign in, My Quizzes, Generate Quiz form, generation progress, Draft review                                                                      |
| **Game control** | Host   | Lobby (Join Code, Player list, remove), Question Open (countdown, answered count), Reveal (Option counts, Leaderboard, Next), Finished, History |
| **Play**         | Player | Join (code, Nickname), Lobby wait, Question (text, Options, countdown), Reveal (correct Option, points, rank), Finished (final Leaderboard)     |

The Player screens must work well on a phone at around 400 px wide.

## 7. Non-functional requirements

| Area                  | Requirement                                                                                                                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scale**             | Small user base. Up to 50 Players per Game, and a handful of concurrent Games.                                                                                                                                                                            |
| **Real-time latency** | State changes reach all clients within about 1 second under normal network conditions.                                                                                                                                                                    |
| **Fairness**          | Answer speed is measured on server receipt time (FR-6.5).                                                                                                                                                                                                 |
| **Cost**              | Serverless, pay-per-use. Near-zero cost when idle. Generation is rate-limited (FR-2.7).                                                                                                                                                                   |
| **Region**            | Everything deploys to **ap-southeast-2** (Sydney).                                                                                                                                                                                                        |
| **Security**          | Hosts authenticate with Cognito. Players hold a per-Game credential only. Clients never publish to real-time channels directly: every command goes through the API, and the server is the single source of truth. There are no long-lived AWS keys in CI. |
| **Privacy**           | Players are anonymous. History contains only Nicknames and Scores. Prompts sent to the model contain Topics and trivia, and no personal data.                                                                                                             |
| **Availability**      | AWS managed-service defaults. No multi-region failover.                                                                                                                                                                                                   |

## 8. Technical approach

This section summarises the decisions; the ADRs hold the rationale.

- **Repository:** a single TypeScript monorepo, with workspaces for the frontend, the API Lambdas and the generation agent.
- **Frontend:** a React single-page app, hosted on S3 behind CloudFront.
- **Auth:** an Amazon Cognito user pool for Hosts.
- **Commands:** an HTTP API to Lambda, for actions such as join, submit Answer, start, advance, close Question, remove Player and generate. Each Lambda writes to DynamoDB, then publishes the change.
- **Real-time pushes:** AWS AppSync Events, with one channel per Game. See [ADR 0002](./adr/0002-appsync-events-for-live-play.md).
  - **Players** subscribe with a signed Player token that the join call returns, bound to that Player and Game. A Lambda authoriser allows subscribing only, and only to that Game's channel. The same token is the reconnect credential.
  - **Hosts** subscribe with their Cognito token.
  - **Publishing** is done only by the backend, using IAM.
- **Timing:** the server keeps the time, and the Host's client triggers each Question's close. See [ADR 0003](./adr/0003-server-time-host-triggered-close.md).
- **Storage:** DynamoDB for Quizzes, Games, Players, Answers and history.
- **Quiz generation:** a Strands Agents (TypeScript) agent, hosted on Amazon Bedrock AgentCore Runtime, calling **Claude Opus 5.5** on Amazon Bedrock to both generate and verify Questions. It uses the Australia geographic inference profile `au.anthropic.claude-opus-5-5`, which routes between Sydney and Melbourne, because Opus 5.5 has no in-region model ID. See [ADR 0001](./adr/0001-quiz-generation-agent-on-agentcore.md). _Temporarily, until the account has Anthropic access, the agent uses Amazon Nova 2 Lite (`global.amazon.nova-2-lite-v1:0`). Every model call goes through the Bedrock Converse API, and the model is configuration, so switching back needs no code change (ADR 0005)._
- **Nickname moderation:** Amazon Comprehend toxic-content detection, plus a blocklist.
- **Infrastructure as code:** CloudFormation with the SAM transform, split into these stacks:
  - **foundation**: DynamoDB, Cognito, ECR;
  - **agent**: AgentCore Runtime;
  - **api**: HTTP API, Lambdas, AppSync Events;
  - **web**: S3, CloudFront.

  See [ADR 0004](./adr/0004-cloudformation-sam-not-cdk.md).

- **Environments and CI/CD:**
  - two environments, **dev** and **prod**, as parameterised stacks in one AWS account;
  - deployed from GitHub Actions using OIDC;
  - deployment order: foundation, then build and push the agent image, then agent, api and web.

## 9. Open questions

None. Every assumption in the first draft was confirmed or decided on 2026-10-25 and has been folded into the requirements above:

- the scoring formula (FR-7.1);
- Time Limit bounds (FR-2.1, FR-3.2);
- Nickname uniqueness (FR-5.2);
- the 5-Question minimum to approve (FR-3.2);
- Player real-time auth (§8);
- the rule for when everyone has answered (FR-6.6);
- the Host's answered count (FR-6.3);
- what happens when a deadline passes while the Host is away (FR-8.3);
- the Opus 5.5 inference profile (§8).

## 10. Future considerations (not v1)

- Web-search fact-checking in the verify pass.
- Importing Quizzes, or authoring them by hand.
- A shared Quiz library across Hosts, with moderation.
- More Question types: typed answers, images.
- A big-screen presentation mode.
- Players opting in to an account to keep their own history.
