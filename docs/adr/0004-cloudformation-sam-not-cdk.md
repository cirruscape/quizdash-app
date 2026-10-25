# Infrastructure is CloudFormation (with the SAM transform), not CDK

Although the whole project is TypeScript, infrastructure is written as CloudFormation templates using the AWS SAM transform, not AWS CDK. The developers are highly skilled in CloudFormation and not in CDK, and prefer templates as the reviewable artifact. SAM is used only to simplify packaging and deploying Lambda code; everything remains plain CloudFormation stacks (foundation, agent, api, web), deployed per environment (dev, prod) from GitHub Actions via OIDC.

## Consequences

- The agent's container image is built and pushed to ECR outside CloudFormation, between the foundation and agent stacks.
