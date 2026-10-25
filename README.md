# Quiz App

A live trivia game. A Host generates a Quiz with AI, reviews it, and runs a Game in real time while Players answer on their own devices. It runs on AWS serverless services in ap-southeast-2.

- [`GLOSSARY.md`](./GLOSSARY.md): the domain language. Code uses these terms exactly.
- [`docs/PRD.md`](./docs/PRD.md): requirements
- [`docs/PLAN.md`](./docs/PLAN.md): architecture and milestones
- [`docs/adr/`](./docs/adr/): architectural decisions

## Layout

| Path                 | What                                                                |
| -------------------- | ------------------------------------------------------------------- |
| `packages/domain`    | Pure Game rules: no I/O, no AWS SDK                                 |
| `packages/contracts` | Shared zod schemas for the HTTP API, events and agent I/O           |
| `packages/api`       | Lambda handlers                                                     |
| `packages/agent`     | The Strands generation agent (AgentCore Runtime container)          |
| `packages/web`       | React SPA                                                           |
| `infra/`             | CloudFormation templates (SAM transform where Lambdas are packaged) |

## Local development

You need Node 22 or later. pnpm is provided by corepack, so you don't install it separately.

```sh
corepack enable
pnpm install
pnpm test          # vitest across all packages
pnpm typecheck     # tsc -b
pnpm lint
pnpm format:check
pnpm --filter @quizapp/web dev
```

To lint the templates, you also need cfn-lint (`pip install cfn-lint`). Then run `pnpm lint:infra`.

## Deploying

The **dev** environment is AWS account `587736032611`, reached through the `quizdash` CLI profile. That profile has no default region, so every command passes `--region ap-southeast-2`. The prod account is not yet decided.

Every push to `main` runs `.github/workflows/deploy.yml`, which deploys to dev:

1. **CI**: format, lint, typecheck, tests, and the web build.
2. **foundation**: the `quizapp-dev-foundation` stack.
3. **agent-image**: bundles the agent and pushes an arm64 image to ECR, tagged with the commit SHA.
4. **agent**: the `quizapp-dev-agent` stack, then a smoke test that invokes the agent and expects "Canberra" in the reply (Spike A).
5. **spike-events**: the `quizapp-dev-spike-events` stack (Spike B). This runs in parallel with steps 3 and 4.

You can also run it from the Actions tab (**Deploy → Run workflow**).

### One-time setup

**1. Bootstrap the account (by hand, with admin credentials):**

```sh
aws cloudformation deploy --profile quizdash --region ap-southeast-2 \
  --stack-name quizapp-dev-bootstrap \
  --template-file infra/bootstrap/github-oidc.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides Env=dev GitHubRepository=cirruscape/quizdash-app \
    GitHubSubjectPrefix=repo:cirruscape@235645298/quizdash-app@1432826993
```

`GitHubSubjectPrefix` must match the start of the OIDC `sub` claim GitHub sends. This repo uses GitHub's immutable subject format, which includes the owner and repo IDs. Look it up with `curl -s https://api.github.com/repos/cirruscape/quizdash-app/actions/oidc/customization/sub` (`sub_claim_prefix`). For a repo using the classic format, leave the parameter out.

The GitHub OIDC provider exists only once per AWS account. If the account already has one, add `CreateOidcProvider=false ExistingOidcProviderArn=<arn>`.

**2. Create a GitHub Environment named `dev`** (Settings → Environments). Add these variables, copied from the bootstrap stack's outputs:

| Variable                 | Bootstrap output      |
| ------------------------ | --------------------- |
| `AWS_DEPLOY_ROLE_ARN`    | `DeployRoleArn`       |
| `CFN_EXECUTION_ROLE_ARN` | `CfnExecutionRoleArn` |
| `ARTIFACTS_BUCKET`       | `ArtifactsBucketName` |

The deploy role trusts only jobs that run in this Environment.

**3. Bedrock model access.** The agent currently uses **Amazon Nova 2 Lite**, through the global inference profile `global.amazon.nova-2-lite-v1:0`, because the account doesn't have Anthropic access yet. The intended model is Claude Opus 5.5 (`au.anthropic.claude-opus-5-5`). To switch, edit the environment's `ModelId` and `FoundationModelId` in the `Models` mapping at the top of `infra/agent.yaml`, then push. No code change is needed (ADR 0005). Don't make the model a stack parameter: `aws cloudformation deploy` keeps a parameter's previous value, so a changed default never reaches an existing stack.

**4. Existing Spike B stack:** `quizapp-dev-spike-events` was first deployed by hand. The pipeline takes it over: later updates run through the CloudFormation execution role.

### Manual deploys

These are useful when debugging a stack outside the pipeline.

```sh
# Foundation
aws cloudformation deploy --profile quizdash --region ap-southeast-2 \
  --stack-name quizapp-dev-foundation \
  --template-file infra/foundation.yaml \
  --capabilities CAPABILITY_AUTO_EXPAND \
  --parameter-overrides Env=dev

# Spike B (disposable)
pnpm --filter @quizapp/api bundle
sam deploy --profile quizdash --region ap-southeast-2 \
  --template-file infra/spikes/events-auth.yaml \
  --stack-name quizapp-dev-spike-events \
  --resolve-s3 --capabilities CAPABILITY_IAM

# Tear down Spike B when finished
aws cloudformation delete-stack --profile quizdash --region ap-southeast-2 \
  --stack-name quizapp-dev-spike-events
```

The agent stack needs an image in ECR, so deploy it through the pipeline. Building the image locally requires Docker with arm64 support.
