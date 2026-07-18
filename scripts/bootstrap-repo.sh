#!/usr/bin/env bash
#
# One-time repo bootstrap for chrischall/sixflags-mcp — mirrors the fleet
# convention (see mcp-utils). Creates the two branch-protection rulesets, the
# pipeline + release-please labels, and enables auto-merge. Idempotent: a label
# or ruleset that already exists returns 422 and is skipped.
#
# Requires a GitHub token with repo admin in $GITHUB_TOKEN (Rulesets + labels +
# repo settings). Run once by the repo owner:
#
#     GITHUB_TOKEN=<admin-pat> scripts/bootstrap-repo.sh
#
# NOT covered here (credentials / installs an agent must never set — do these
# by hand in the GitHub UI):
#   - RELEASE_PAT secret          release-please uses it to open the release PR
#   - CLAUDE_CODE_OAUTH_TOKEN      the pr-auto-review verdict
#   - Claude GitHub App install    github.com/apps/claude -> Configure -> add repo
#   - npm trusted publishing       for the --provenance publish job
set -uo pipefail

REPO=chrischall/sixflags-mcp
api() { curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "$@"; }

echo "== 1. Ruleset: block force-push + deletion on main =="
api -X POST "https://api.github.com/repos/$REPO/rulesets" -d '{
  "name":"Block force-push and deletion on main","target":"branch","enforcement":"active",
  "conditions":{"ref_name":{"exclude":[],"include":["~DEFAULT_BRANCH"]}},
  "rules":[{"type":"deletion"},{"type":"non_fast_forward"}]}' -o /dev/null -w "  -> %{http_code}\n"

echo "== 2. Ruleset: main protection (PR + ci-gated) =="
api -X POST "https://api.github.com/repos/$REPO/rulesets" -d '{
  "name":"main protection (PR + ci)","target":"branch","enforcement":"active",
  "conditions":{"ref_name":{"exclude":[],"include":["~DEFAULT_BRANCH"]}},
  "rules":[
    {"type":"pull_request","parameters":{"required_approving_review_count":0,"dismiss_stale_reviews_on_push":false,"require_code_owner_review":false,"require_last_push_approval":false,"required_review_thread_resolution":false,"allowed_merge_methods":["merge","squash","rebase"]}},
    {"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":false,"do_not_enforce_on_create":false,"required_status_checks":[{"context":"ci-gated"}]}}
  ]}' -o /dev/null -w "  -> %{http_code}\n"

echo "== 3. Labels (pipeline + release-please + dependabot). 422 = already exists =="
while IFS='|' read -r name color desc; do
  [ -z "$name" ] && continue
  api -X POST "https://api.github.com/repos/$REPO/labels" \
    -d "$(printf '{"name":"%s","color":"%s","description":"%s"}' "$name" "$color" "$desc")" \
    -o /dev/null -w "  $name -> %{http_code}\n"
done <<'LABELS'
auto-review|0e8a16|Auto-review runs on this PR
ready-to-merge|0e8a16|Arms auto-merge
review-with-opus|5319e7|Use Opus for the auto-review
release-ready|1d76db|Gates auto-review on the release-please PR
autorelease: pending|ededed|release-please: pending
autorelease: tagged|ededed|release-please: tagged
ci|c5def5|Dependabot: CI deps
security|d93f0b|Dependabot: security
test|bfd4f2|Dependabot: test deps
javascript|f1e05a|Dependabot: JS deps
github_actions|000000|Dependabot: Actions
ignore-for-release|ededed|Exclude from release notes
LABELS

echo "== 4. Enable auto-merge on the repo (load-bearing for the ci-gated ruleset) =="
api -X PATCH "https://api.github.com/repos/$REPO" -d '{"allow_auto_merge":true}' \
  -o /dev/null -w "  allow_auto_merge -> %{http_code}\n"

echo "Done. Verify: https://github.com/$REPO/settings/rules"
