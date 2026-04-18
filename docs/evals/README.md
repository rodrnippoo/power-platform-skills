# Eval Harness Planning Docs

Pre-implementation planning and research for an automated eval runner for the
`model-apps/genpage` skill.

## Files

| File | What it is |
|------|------------|
| `2026-04-17-automated-eval-harness-spec.md` | **Primary spec** — architecture, directory layout, mock framework, assertion library, open questions, risks, effort estimate |
| `exploration-findings.md` | Raw research findings on Claude Code CLI, hooks, and the Agent SDK — what's possible today, what isn't |

## Status

**Not yet implemented.** The spec is written and reviewed. Next steps are documented
in the spec under "Next steps" section.

## Quick pointers

- **Current eval suite:** `evals/model-apps/genpage/` (16 evals, tiered, manual)
- **Runbook:** `evals/model-apps/genpage/eval-runbook.md` (manual process)
- **Plugin under test:** `plugins/model-apps/` (v2.0.0 on feature branch)
- **Feature branch:** `feature/genpage-agent-architecture`

## Open questions summary

See the spec for details. Key unknowns that require a 2-hour spike before committing
to the full build:

1. Does SDK PreToolUse hook fire for Task/Agent invocations?
2. Do main-agent hooks apply to subagent-internal tool calls?
3. Can ExitPlanMode hook return a "rejected with feedback" response?
