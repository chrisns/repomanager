# Security features reference

Every GitHub repository security feature that repomanager can toggle, mapped
to the YAML key that controls it.

| Feature | YAML key | GitHub REST method | Risk |
| --- | --- | --- | --- |
| Dependabot vulnerability alerts | `vulnerabilityAlerts` | `repos.enable/disableVulnerabilityAlerts` | low |
| Dependabot automated security fixes | `automatedSecurityFixes` | `repos.enable/disableAutomatedSecurityFixes` | low |
| Secret scanning | `secretScanning` | `repos.update` (`security_and_analysis.secret_scanning`) | low |
| Secret scanning push protection | `secretScanningPushProtection` | `repos.update` (`security_and_analysis.secret_scanning_push_protection`) | low |
| Private vulnerability reporting | `privateVulnerabilityReporting` | `repos.update` (`security_and_analysis.private_vulnerability_reporting`) | low |
| Dependabot security updates | `dependabotSecurityUpdates` | `repos.update` (`security_and_analysis.dependabot_security_updates`) | low |
| Branch protection (legacy) | `branchProtection[]` | `repos.updateBranchProtection` | high — requires consent |
| Repository rulesets | `rulesets[]` | `repos.create/updateRepoRuleset` | high — requires consent |
| Repository flags | `repo.{...}` | `repos.update` | high — requires consent |
| Templated files | `files.{...}` | `createPullRequest` plugin | high — requires consent |

All "low" risk changes are applied automatically by repomanager on every cron
run. All "high" risk changes are surfaced as task-list checkboxes in a
`repomanager:consent` issue and must be explicitly ticked to apply.
