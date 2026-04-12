const { z } = require('zod')

const RequiredStatusChecks = z
  .object({
    strict: z.boolean().optional(),
    contexts: z.union([z.literal('ALL'), z.array(z.string())]).optional(),
    checks: z
      .array(z.object({ context: z.string(), app_id: z.number().optional() }))
      .optional(),
  })
  .nullable()
  .optional()

const RequiredPullRequestReviews = z
  .object({
    dismiss_stale_reviews: z.boolean().optional(),
    require_code_owner_reviews: z.boolean().optional(),
    required_approving_review_count: z.number().int().min(0).max(6).optional(),
    require_last_push_approval: z.boolean().optional(),
  })
  .nullable()
  .optional()

const BranchProtection = z.object({
  branch: z.string(),
  required_status_checks: RequiredStatusChecks,
  enforce_admins: z.boolean().nullable().optional(),
  required_pull_request_reviews: RequiredPullRequestReviews,
  required_linear_history: z.boolean().optional(),
  allow_force_pushes: z.boolean().nullable().optional(),
  allow_deletions: z.boolean().optional(),
  required_conversation_resolution: z.boolean().optional(),
  lock_branch: z.boolean().optional(),
  allow_fork_syncing: z.boolean().optional(),
  block_creations: z.boolean().optional(),
  restrictions: z
    .object({
      users: z.array(z.string()),
      teams: z.array(z.string()),
      apps: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
})

const RulesetRule = z.object({
  type: z.string(),
  parameters: z.record(z.string(), z.unknown()).optional(),
})

const Ruleset = z.object({
  name: z.string(),
  target: z.enum(['branch', 'tag', 'push']).default('branch'),
  enforcement: z.enum(['active', 'evaluate', 'disabled']).default('active'),
  conditions: z
    .object({
      ref_name: z
        .object({
          include: z.array(z.string()),
          exclude: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  rules: z.array(RulesetRule),
  bypass_actors: z
    .array(
      z.object({
        actor_id: z.number().optional(),
        actor_type: z.string(),
        bypass_mode: z.enum(['always', 'pull_request']).optional(),
      }),
    )
    .optional(),
})

const RepoConfig = z
  .object({
    vulnerabilityAlerts: z.boolean().optional(),
    automatedSecurityFixes: z.boolean().optional(),
    secretScanning: z.boolean().optional(),
    secretScanningPushProtection: z.boolean().optional(),
    privateVulnerabilityReporting: z.boolean().optional(),
    dependabotSecurityUpdates: z.boolean().optional(),
    branchProtection: z.array(BranchProtection).optional(),
    rulesets: z.array(Ruleset).optional(),
    repo: z.record(z.string(), z.unknown()).optional(),
    files: z
      .union([
        z.literal(false),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.object({
              content: z.string(),
              visibility: z.enum(['public', 'private', 'internal']).optional(),
            }),
          ]),
        ),
      ])
      .optional(),
  })
  .strict()

const formatIssues = (error) =>
  error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '(root)'
    return `- [ ] \`${path}\`: ${issue.message}`
  })

module.exports = {
  RepoConfig,
  formatIssues,
}
