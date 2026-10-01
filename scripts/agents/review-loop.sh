#!/usr/bin/env bash
# Jadal PR review loop: every INTERVAL seconds, review new or updated open PRs with agy,
# merge the ones that pass, request changes on the rest, and fast-forward local main.
# Usage: scripts/agents/review-loop.sh [interval_seconds]   (run from the repo root)
set -uo pipefail

INTERVAL="${1:-120}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
WORK="$REPO_ROOT/.ref/review"
WT="$WORK/worktree"
STATE="$WORK/reviewed.txt"
CLI="${REVIEW_CLI:-opencode}"   # opencode (default, space-bunny-free) or agy
MODEL="${REVIEW_MODEL:-}"
mkdir -p "$WORK/runs" && touch "$STATE"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

ensure_worktree() {
  if [ ! -d "$WT/.git" ] && [ ! -f "$WT/.git" ]; then
    git -C "$REPO_ROOT" worktree add --detach "$WT" origin/main >/dev/null 2>&1 || true
  fi
}

review_pr() {
  local n="$1" sha="$2"
  local run="$WORK/runs/pr-$n-${sha:0:7}"
  mkdir -p "$run"
  log "PR #$n @ ${sha:0:7}: reviewing"

  gh pr view "$n" --json number,title,author,body,files,labels,headRefName,mergeable,closingIssuesReferences >"$run/pr.json"
  local issue
  issue=$(jq -r '.closingIssuesReferences[0].number // empty' "$run/pr.json")
  [ -z "$issue" ] && issue=$(jq -r '.body' "$run/pr.json" | grep -oE '#[0-9]+' | head -1 | tr -d '#')
  if [ -n "$issue" ]; then gh issue view "$issue" --json title,body -q '"# " + .title + "\n\n" + .body' >"$run/issue.md"; else echo "No linked issue found." >"$run/issue.md"; fi
  gh pr diff "$n" >"$run/diff.patch"

  if [ "$(jq -r '.mergeable' "$run/pr.json")" = "CONFLICTING" ]; then
    gh pr comment "$n" --body "🤖 Reviewer: this branch conflicts with \`main\`. Please run \`git pull --rebase origin main\`, resolve, and force-push; I'll re-review automatically." >/dev/null
    echo "$n $sha" >>"$STATE"; return
  fi

  ensure_worktree
  rm -rf "$WT/.review"
  git -C "$WT" fetch -q origin "pull/$n/head" main && git -C "$WT" checkout -q --detach FETCH_HEAD
  # Test what will actually land: the PR merged with the latest main.
  if ! git -C "$WT" merge -q --no-edit origin/main >/dev/null 2>&1; then
    git -C "$WT" merge --abort >/dev/null 2>&1
    gh pr comment "$n" --body "🤖 Reviewer: this branch conflicts with \`main\`. Please run \`git pull --rebase origin main\`, resolve, and force-push; I'll re-review automatically." >/dev/null
    echo "$n $sha" >>"$STATE"; return
  fi
  ( cd "$WT" && set -o pipefail && pnpm install --prefer-offline 2>&1 | tail -5 && pnpm -r typecheck && pnpm -r test && pnpm -r build ) >"$run/checks.log" 2>&1
  local checks=$?
  echo "EXIT CODE: $checks" >>"$run/checks.log"

  local msg
  msg="$(cat "$REPO_ROOT/scripts/agents/review-prompt.md")

Run inputs for this review (relative to the current directory): .review/pr.json, .review/issue.md, .review/diff.patch, .review/checks.log. Write the decision JSON to .review/decision.json"
  mkdir -p "$WT/.review" && cp "$run/pr.json" "$run/issue.md" "$run/diff.patch" "$run/checks.log" "$WT/.review/"
  if [ "$CLI" = "agy" ]; then
    ( cd "$WT" && agy -p "$msg" --model "${MODEL:-gemini-3.8-flash-high}" --dangerously-skip-permissions >"$run/agent.log" 2>&1 )
  else
    ( cd "$WT" && opencode run -m "${MODEL:-opencode/space-bunny-free}" "$msg" >"$run/agent.log" 2>&1 )
  fi

  cp "$WT/.review/decision.json" "$run/decision.json" 2>/dev/null
  if ! jq -e . "$run/decision.json" >/dev/null 2>&1; then
    log "PR #$n: no valid decision written; will retry next cycle"; return
  fi
  local decision summary body
  decision=$(jq -r '.decision' "$run/decision.json")
  summary=$(jq -r '.summary' "$run/decision.json")
  body=$(jq -r '"### 🤖 Jadal reviewer\n\n" + .summary + "\n\n**Gates:** " + ([.gates|to_entries[]|"\(.key)=\(.value)"]|join(" · ")) +
    (if (.required_changes|length)>0 then "\n\n**Required changes**\n" + ([.required_changes[]|"- "+.]|join("\n")) else "" end) +
    (if (.suggestions|length)>0 then "\n\n**Suggestions**\n" + ([.suggestions[]|"- "+.]|join("\n")) else "" end)' "$run/decision.json")

  # Never merge when the checks failed, whatever the model says.
  if [ "$decision" = "approve" ] && [ "$checks" -eq 0 ]; then
    gh pr review "$n" --approve --body "$body" >/dev/null 2>&1 || gh pr comment "$n" --body "$body" >/dev/null
    if gh pr merge "$n" --squash --delete-branch >/dev/null 2>&1; then
      log "PR #$n: merged — $summary"
      git -C "$REPO_ROOT" pull -q --ff-only origin main && log "local main fast-forwarded"
    else
      log "PR #$n: approve OK but merge failed (branch protection or conflict)"
    fi
  else
    gh pr review "$n" --request-changes --body "$body" >/dev/null 2>&1 || gh pr comment "$n" --body "$body" >/dev/null
    log "PR #$n: changes requested — $summary"
  fi
  echo "$n $sha" >>"$STATE"
}

log "review loop started (interval ${INTERVAL}s, cli $CLI ${MODEL})"
while true; do
  git -C "$REPO_ROOT" fetch -q origin
  gh pr list --state open --json number,headRefOid,isDraft -q 'sort_by(.number) | .[] | select(.isDraft|not) | "\(.number) \(.headRefOid)"' 2>/dev/null |
  while read -r n sha; do
    grep -qx "$n $sha" "$STATE" || review_pr "$n" "$sha"
  done
  sleep "$INTERVAL"
done
