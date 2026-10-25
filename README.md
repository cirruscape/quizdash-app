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

## Deploying (manual, until the pipeline exists in M5)

### 1. Bootstrap (once per environment, by hand)

Deploy the bootstrap stack with admin credentials.

```sh
aws cloudformation deploy --region ap-southeast-2 \
  --stack-name quizapp-dev-bootstrap \
  --template-file infra/bootstrap/github-oidc.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides Env=dev GitHubRepository=<owner>/<repo>
```

Then set the stack's `DeployRoleArn` output as the `AWS_DEPLOY_ROLE_ARN` variable on the `dev` GitHub Environment.

When bootstrapping the second environment, the account's GitHub OIDC provider already exists. Pass `CreateOidcProvider=false ExistingOidcProviderArn=<arn>`.

### 2. Foundation

```sh
aws cloudformation deploy --region ap-southeast-2 \
  --stack-name quizapp-dev-foundation \
  --template-file infra/foundation.yaml \
  --capabilities CAPABILITY_AUTO_EXPAND \
  --role-arn <CfnExecutionRoleArn from bootstrap> \
  --parameter-overrides Env=dev
```
