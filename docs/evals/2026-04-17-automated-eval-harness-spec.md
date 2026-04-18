# Automated Eval Harness for `model-apps` — Design Spec

**Date:** 2026-04-17
**Status:** Pre-implementation (awaiting go-ahead on spike or full build)
**Plugin:** model-apps
**Skill under test:** `/genpage`
**Related files:**
- `evals/model-apps/genpage/evals.json` (16 evals across smoke/full/stress tiers)
- `evals/model-apps/genpage/eval-runbook.md` (manual runbook, references 3-layer check)

---

## Problem

Today our eval suite is a specification document, not an executable test. To run
evals a human must manually invoke `/genpage`, answer questions, grade the outputs
against 21+ assertions, and score the UX. This is 10-15 minutes per eval × 16 evals
= 3-4 hours. Nobody does this, which means regressions slip through.

We want **automated eval execution** that:

1. Runs each eval's prompt programmatically through Claude Code
2. Mocks all external infrastructure (PAC CLI, Dataverse MCP, Playwright)
3. Auto-answers the interactive questions per the eval's `data.question_answers`
4. Captures the full tool-call transcript
5. Verifies both **workflow assertions** ("planner invoked before entity-builder",
   "parallel dispatch happened") AND **code assertions** (grep against generated .tsx)
6. Returns pass/fail with specific failure details
7. Runs cheaply enough to gate PRs (smoke tier) and runs nightly (full tier)

## Goals

1. **Skill regression tracking** — catch wrong agent invocations, phase reordering,
   missing Task calls, wrong deploy flags, etc.
2. **Code regression tracking** — catch .tsx outputs that violate the rules reference
   (100vh, createTheme, FluentProvider wrapper, raw URL navigation, etc.)
3. **Deterministic execution** — no flaky infra, no tenant required, no auth state
4. **Fast** — smoke tier completes in ~3 min (suitable for PR CI)
5. **Ownership-clear failures** — when an eval fails, the output points to which
   file/agent owns the regression

## Non-goals

1. **UX visual scoring** (Layer 3 of the runbook) — can't cheaply automate; stays human-only
2. **Real Dataverse tenant testing** — mock everything; real-tenant testing is a
   separate manual gate before releases
3. **End-to-end deployment verification** — we stub `pac model genpage upload`; we
   do not verify pages actually render in Power Apps
4. **Replacement for manual pre-release testing** — this catches regressions, not
   ensures production quality

---

## Background: what we explored

### Claude Code CLI headless mode (`claude -p "..."`)

**Works:**
- `claude -p "prompt"` for non-interactive execution
- `--plugin-dir <path>` loads plugins
- `--model <name>` selects model
- `--output-format json | stream-json` for structured output
- `--permission-mode bypassPermissions` or `--dangerously-skip-permissions` bypass approvals
- `--include-hook-events` surfaces hook events in stream

**Doesn't work for our needs:**
- **Cannot mock tool responses via CLI hooks.** PreToolUse hooks can only
  `permit` / `deny` / `defer`. They cannot inject synthetic tool results.
- **Cannot answer AskUserQuestion programmatically.** No stdin mechanism, no hook
  interception of the question.
- **Cannot dynamically configure hooks per eval.** Hooks are declared statically
  in settings.json. Env vars can help but require a regeneration step.

### Claude Agent SDK (Python / TypeScript)

**This is the right path.** The SDK exposes programmatic hook callbacks that:
- Receive the tool input as structured data
- **Can return synthetic tool results** (unlike CLI hooks)
- Have access to closures / per-eval state

Example (Python):

```python
async def intercept_ask(input_data, tool_use_id, context):
    q_header = input_data.get("questions", [{}])[0].get("header", "")
    return {"selected_option": EVAL_ANSWERS[eval_id][q_header]}

options = ClaudeAgentOptions(
    allowed_tools=[...],
    hooks={
        "PreToolUse": [
            HookMatcher(matcher="AskUserQuestion", hooks=[intercept_ask]),
        ]
    }
)
async for msg in query(prompt="...", options=options):
    ...
```

**SDK message types we can consume:**
- `assistant` messages (include `tool_use` blocks with tool name + input)
- `tool_result` messages (with `parent_tool_use_id` linking back)
- `system/init` (session metadata)
- `ResultMessage` (final result + session_id)

**Session transcripts on disk:**
- Location: `~/.claude/projects/<PROJECT_HASH>/<SESSION_ID>/main.jsonl`
- Subagent transcripts: same folder, separate `.jsonl` files per subagent
- Each line is JSON with: `type`, `agentId`, `parentUuid`, `message.content[]`
- Persisted for `cleanupPeriodDays` (default 30)

### Why SDK > CLI for this

| Need | CLI | SDK |
|------|-----|-----|
| Mock AskUserQuestion | ❌ | ✅ |
| Mock Bash tool results | ❌ (can only block) | ✅ (inject output) |
| Mock MCP tools | ❌ | ✅ |
| Mock Task subagent responses | ❌ | ✅ |
| Capture tool calls real-time | Partial (stream-json) | ✅ (async iterator) |
| Detect subagent invocations | Via transcript post-run | ✅ (real-time with parent_tool_use_id) |
| Auto-approve EnterPlanMode | ❌ | ✅ |

---

## Proposed Architecture

### Directory layout

```
scripts/evals/                       # New (to be created)
├── package.json                     # @anthropic-ai/claude-agent-sdk, tsx, etc.
├── tsconfig.json                    # TS config (or skip if JS)
├── src/
│   ├── cli.ts                       # `node scripts/evals/dist/cli.js --tier smoke`
│   ├── runner.ts                    # Runs one eval end-to-end
│   ├── checker.ts                   # Assertion library + aggregator
│   ├── transcript-parser.ts         # Reads session .jsonl files
│   └── mocks/
│       ├── bash.ts                  # Pattern-match pac commands
│       ├── mcp.ts                   # Dataverse MCP mock
│       ├── interactive.ts           # AskUserQuestion + ExitPlanMode
│       └── fixtures/                # Canned outputs
│           ├── pac-model-list-1app.txt
│           ├── pac-model-list-0apps.txt
│           ├── pac-model-list-tables-account.txt
│           ├── pac-model-list-tables-contact.txt
│           ├── runtime-types-account.ts
│           ├── runtime-types-contact-incident.ts
│           ├── genpage-download-contact-page/  # folder fixture
│           │   ├── page.tsx
│           │   ├── page.js
│           │   ├── config.json
│           │   └── prompt.txt
│           └── ...
├── test/                             # Unit tests for mocks + checker
│   ├── mocks.test.ts
│   └── checker.test.ts
└── README.md                         # How to run locally

evals/model-apps/genpage/
├── evals.json                        # (existing — no changes)
├── eval-runbook.md                   # (existing — add "Automated runs" section)
└── mocks/                            # New — per-eval mock configurations
    ├── eval-1.json                   # Overrides/extra mocks for eval 1
    ├── eval-2.json
    ├── ...
    └── eval-16.json

.github/workflows/
└── model-apps-evals.yml              # New — smoke on PR, full nightly
```

### Runner lifecycle (per eval)

```
1. Load eval spec:
   - evals/model-apps/genpage/evals.json[eval.id]
   - evals/model-apps/genpage/mocks/eval-<id>.json (per-eval overrides)

2. Prepare scratch working directory:
   - Create temp dir: /tmp/genpage-eval-<id>-<timestamp>/
   - Set cwd for Claude Code session

3. Build mock responders:
   - bash-responder: matches `pac <subcmd>` patterns, returns configured fixture
   - mcp-responder: matches `mcp__dataverse__<tool>`, returns configured data
   - interactive-responder: reads eval.data.question_answers keyed by question
     header, returns the scripted answer
   - plan-mode-responder: auto-approve (default) or scripted reject cycle (eval 12)

4. Launch Agent SDK query():
   - options.plugin_dir = 'plugins/model-apps'
   - options.allowed_tools = [all the orchestrator's tools]
   - options.permission_mode = 'bypassPermissions'
   - options.hooks.PreToolUse = [
       HookMatcher('AskUserQuestion', interactive.handleAskUserQuestion),
       HookMatcher('ExitPlanMode', interactive.handleExitPlanMode),
       HookMatcher('Bash', bash.handleBash),
       HookMatcher('mcp__dataverse__*', mcp.handleMcp),
     ]
   - options.cwd = temp working dir
   - prompt = eval.prompt

5. Stream through messages, record:
   - All assistant messages (for tool_use blocks)
   - All tool_result messages (with parent_tool_use_id)
   - All Task invocations (subagent_type + prompt)
   - All Write/Edit tool calls (target file + content hash)

6. After ResultMessage:
   - Parse session transcript from ~/.claude/projects/<hash>/<session_id>/
   - Build structured run record:
     {
       eval_id: 1,
       tier: 'smoke',
       session_id: '...',
       working_dir: '/tmp/...',
       tool_calls: [{ phase, tool, input, result, agent_id }],
       agents_invoked: [{ type, prompt, start, end }],
       files_written: [{ path, size, excerpt }],
       total_tokens: N,
       wall_time_ms: N
     }

7. Run checker against the run record:
   - Iterate common_workflow_assertions → check against tool_calls + agents_invoked
   - Iterate common_code_assertions → grep files_written for .tsx outputs
   - Iterate eval.expectations → per-eval specifics

8. Return result:
   {
     eval_id, tier, status: 'pass' | 'fail',
     assertions: [{ text, category, passed, actual?, expected? }],
     elapsed_ms, tokens_used
   }
```

### Mock framework details

#### Per-eval mock config schema (`mocks/eval-<id>.json`)

```json
{
  "eval_id": 1,
  "extends": "defaults",
  "bash": {
    "pac model list-tables --search 'account'": {
      "fixture": "pac-model-list-tables-account.txt",
      "exit_code": 0
    },
    "pac model genpage generate-types --data-sources 'account' --output-file (.*)": {
      "fixture": "runtime-types-account.ts",
      "output_to_file_group": 1,
      "stdout": "Generated types successfully"
    },
    "pac model genpage upload (.*)": {
      "stdout": "Successfully pushed page. Page ID: 00000000-0000-0000-0000-000000000001\nPublished. Added to sitemap.",
      "exit_code": 0
    }
  },
  "mcp": {},
  "interactive": {
    "new_or_edit": "Create new page(s)",
    "data_source": "Dataverse entities: account",
    "specific_requirements": "Responsive card layout, each card clickable to open the Account record",
    "app_selection": "Use this one (Sales Hub)"
  },
  "plan_mode": {
    "strategy": "auto_approve"
  }
}
```

For stress eval 12:

```json
{
  "eval_id": 12,
  "plan_mode": {
    "strategy": "scripted",
    "sequence": [
      { "action": "reject", "feedback": "Add a search box in addition to the filter toolbar" },
      { "action": "approve" }
    ]
  }
}
```

For stress eval 10 (DV plugin not installed):

```json
{
  "eval_id": 10,
  "simulate_dv_plugin_missing": true,
  "_note": "mcp.handleMcp returns tool-not-available error for all mcp__dataverse__* calls"
}
```

#### Shared defaults (`mocks/defaults.json`)

Common across all evals:
- `node --version` → v20.11.0
- `pac help` → version 2.7.1 header
- `pac auth list` → one profile, active
- `pac model list-languages` → English 1033 only
- `pac model list` → single app (Sales Hub)

Per-eval configs override defaults.

### Assertion library

Each assertion is a strongly-typed object:

```typescript
type Assertion =
  | { type: 'workflow-log-exists', expectedPath: string }
  | { type: 'working-dir-created', expectedNamePattern: string }
  | { type: 'tool-called', tool: string, phase?: string, args?: Record<string, any> }
  | { type: 'agent-invoked', subagentType: string, before?: string, after?: string }
  | { type: 'parallel-dispatch', subagentType: string, count: number }
  | { type: 'file-written', path: string | RegExp }
  | { type: 'file-matches', path: string, pattern: RegExp | string, shouldMatch: boolean }
  | { type: 'bash-command-matches', pattern: RegExp, shouldRun: boolean }
  | { type: 'plan-doc-schema', requiredSections: string[] }
  | { type: 'custom', name: string, check: (run: RunRecord) => boolean };
```

**Mapping eval.json assertion strings → Assertion objects:**

Option A: **keep assertion strings in evals.json, parse them** (AI-assist during eval
authoring — LLM reads the string and decides which Assertion type applies).

Option B: **migrate evals.json assertions to structured Assertion JSON objects**
(cleaner, more verifiable, but larger refactor).

Option C: **hybrid** — keep the prose strings in evals.json for human reading; maintain
a separate `evals-structured.json` that has the machine-readable versions.

**Recommendation: start with Option A** (prose strings + LLM-ish heuristic parser in
checker.ts). Move to Option C later if the heuristic misses too much.

### Transcript parsing

Session transcripts live at:
```
~/.claude/projects/<PROJECT_HASH>/<SESSION_ID>/main.jsonl
~/.claude/projects/<PROJECT_HASH>/<SESSION_ID>/<subagent-id>.jsonl (one per subagent)
```

Each line is a JSON message. Key fields:
- `type`: `user | assistant | tool_result`
- `agentId`: which agent the message belongs to (main vs subagent)
- `parentUuid`: links to the parent turn / tool invocation
- `message.content[]`: array of content blocks (text / tool_use / tool_result)
- `message.content[N].type === 'tool_use'` → has `.name` (tool) and `.input` (args)

Parser output shape:

```typescript
interface RunRecord {
  sessionId: string;
  workingDir: string;
  elapsedMs: number;
  totalTokens: number;
  toolCalls: ToolCall[];
  agents: AgentInvocation[];
  filesWritten: FileWrite[];
}

interface ToolCall {
  id: string;
  agentId: string;  // 'main' or subagent id
  parentId?: string;
  tool: string;
  input: Record<string, any>;
  result: any;
  timestamp: string;
}

interface AgentInvocation {
  subagentType: string;  // 'genpage-planner', etc.
  invokedByToolCall: string;  // parent tool_use_id
  prompt: string;
  start: string;
  end?: string;
  resultSummary?: string;
}

interface FileWrite {
  path: string;
  size: number;
  contentHash: string;
  excerpt: string;  // first 200 chars for quick inspection
  fullContent?: string;  // loaded on demand for grep
}
```

---

## Open questions

### OQ1: Agent SDK language — TypeScript or Python?

**Arguments for TypeScript:**
- Repo is already Node.js-heavy (power-pages has ~30 Node scripts under test)
- CI workflow for power-pages already runs Node tests
- Types for transcript parsing are useful
- We can share helpers with the existing script tests

**Arguments for Python:**
- Python SDK examples in Anthropic docs seem slightly more mature
- `asyncio` in Python has cleaner async iterators for streaming

**Recommendation:** TypeScript. Consistent with repo patterns.

**Status:** Decision pending.

### OQ2: Where do per-eval mocks live — `scripts/evals/mocks/` or `evals/model-apps/genpage/mocks/`?

- `scripts/evals/mocks/` keeps everything harness-related together
- `evals/model-apps/genpage/mocks/` keeps eval-specific data close to the eval spec

**Recommendation:** `evals/model-apps/genpage/mocks/` — mocks are eval data, not harness
code. Shared fixtures (canned RuntimeTypes files, etc.) go in `scripts/evals/mocks/fixtures/`.

**Status:** Decision pending.

### OQ3: Assertion format — prose strings or structured objects?

See "Assertion library" section. Recommended: Option A (prose strings + heuristic
parser) to start, migrate to Option C (hybrid) if the heuristic misses.

**Status:** Decision pending.

### OQ4: CI budget — run smoke on every PR?

Rough estimate:
- Smoke tier: 4 evals × ~50k tokens/eval ≈ 200k tokens ≈ $0.60-$1.00 per run (Sonnet)
- Full tier: 13 evals × ~50k ≈ 650k tokens ≈ $2-3 per run
- Stress tier: 3 evals × ~60k (they're longer) ≈ 180k tokens ≈ $0.60

Full suite nightly + smoke on every PR ≈ ~$50-100/month assuming ~50 PRs/month. OK
if budget-approved; otherwise smoke on PR + full weekly.

**Recommendation:** Smoke on every PR + full nightly. Get budget approval first.

**Status:** Decision pending (requires stakeholder).

### OQ5: UX rubric (Layer 3) — fully skip in automation?

The current plan skips visual/UX scoring entirely in automation. Alternative: screenshot
the browser preview and use a vision model to grade. But that's expensive and noisy.

**Recommendation:** Skip in automation. Keep Layer 3 as a pre-release human checkpoint.

**Status:** Agreed, but worth re-visiting if visual regressions become a problem.

### OQ6: What happens when PAC CLI changes output format?

Mocks will drift from reality. Two mitigation options:
- Periodic "refresh mocks" job that runs one eval against real PAC and updates fixtures
- Version-pin documentation for the last known-good PAC version, update mocks manually

**Recommendation:** Version-pin in `scripts/evals/mocks/fixtures/VERSIONS.md`. Document
exact `pac --version` that fixtures were captured against. Re-capture when we bump
the PAC requirement.

**Status:** Decision pending.

### OQ7: Task subagent handling in SDK

**Unknown:** does the SDK's PreToolUse hook fire for `Task` invocations, and does it
give us access to the subagent_type + prompt? Does the SDK spawn the subagent in the
same process (so our hooks apply to it too)?

**Need to verify in the spike.** If hooks don't apply to subagents, we'd need to
either:
- Implement our own subagent execution (write code that calls `query()` for each Task)
- Accept that subagent behavior isn't mockable at the hook level and rely on transcript
  parsing to verify invocations happened

**Status:** Must be answered by the spike (see "Next steps").

### OQ8: How do we handle the edit flow's inline `Edit` tool usage?

The edit flow (Phases 4-5) runs `genpage-edit-planner` via Task, then the orchestrator
applies the edit inline via `Edit` tool. Testing this means:
- Mock the download (provide a canned `page.tsx` in the working directory)
- Let the edit-planner run normally
- Verify the orchestrator's Edit calls against the expected changes

We need fixture `page.tsx` files representing existing pages for edit evals to test
against.

**Status:** Defer to implementation — requires designing fixture pages for each edit
eval scenario.

### OQ9: Stress eval 10 (DV plugin missing) — how do we simulate?

Options:
- Load the plugin without the DV MCP config
- Mock all `mcp__dataverse__*` calls to return a specific error
- Skip loading the Dataverse Skills plugin entirely

**Recommendation:** Second option — mcp-responder returns `{ error: 'tool not available' }`
for all DV MCP tools when `simulate_dv_plugin_missing: true`.

**Status:** Design pending, resolvable at implementation time.

### OQ10: Plan revision eval (eval 12) — can we script ExitPlanMode rejection?

Need to verify the SDK's hook for `ExitPlanMode` can return a "rejected with feedback X,
revise" response, not just approve/reject.

**Status:** Must be answered by the spike.

---

## Effort estimate

| Phase | Time | Deliverable |
|-------|------|-------------|
| 0. Spike | ~2 hours | Confirm SDK can mock AskUserQuestion, intercept Task, handle ExitPlanMode |
| 1. Runner + SDK integration | ~1 day | One eval running end-to-end |
| 2. Mock framework | ~0.5 day | All `pac`/MCP/interactive mocks for smoke tier |
| 3. Assertion library | ~0.5 day | Transcript-based + grep-based checks |
| 4. Smoke tier passing | ~0.5 day | 4 smoke evals green |
| 5. Full + stress tier passing | ~0.5 day | All 16 evals green, edge cases handled |
| 6. CI integration | ~0.5 day | GitHub Actions workflow |
| 7. Docs + handoff | ~0.25 day | Update eval-runbook.md, add README |
| **Total** | **~3.5 days** | |

---

## Risks

### R1: SDK gaps for Task tool subagent handling — **High**

If the SDK's PreToolUse hook doesn't fire for Task-spawned subagents, we can't mock
the tools they call (Bash, MCP, etc.). Mitigation: spike first. Fallback: implement
our own subagent execution loop (calls `query()` for each Task invocation with a fresh
context). That's 2-4x more work.

### R2: Mock drift — **Medium**

PAC CLI output format changes → mocks lie → false positives in evals. Mitigation:
VERSIONS.md with known-good versions; manual refresh cadence.

### R3: Assertion format ambiguity — **Medium**

Prose assertions in evals.json are subjective. A heuristic parser may misclassify them,
leading to false positives or false negatives. Mitigation: start with Option A, monitor
false-positive rate, migrate to structured format if needed.

### R4: CI cost — **Low**

Smoke on every PR may cost too much. Mitigation: only run on PRs that touch relevant
files (`plugins/model-apps/**`, `evals/model-apps/**`).

### R5: Non-deterministic LLM outputs — **Medium**

Even with mocked tools, the LLM's decisions aren't fully deterministic. A single eval
run could sometimes skip a question because the LLM "figured it out" from context, and
the assertion would fail. Mitigation:
- Use temperature 0 where possible
- Allow "soft" assertions that check for either of two equivalent outcomes
- Accept some flakiness; mark evals as `known_flaky` if they fail > 10% of runs without
  a real regression

### R6: Hard-coded agent paths — **Low**

Transcript parser assumes `~/.claude/projects/<hash>/<session>/main.jsonl`. Claude Code
might change this structure. Mitigation: use the SDK's streaming output as primary,
file-based parsing as secondary fallback.

---

## Next steps

### Step 1: Pre-build spike (2 hours)

Before committing to the full build, do a spike in a scratch directory:

1. `npm init -y` in scratch dir
2. `npm install @anthropic-ai/claude-agent-sdk`
3. Write a 30-50 line script that:
   - Invokes `query()` with the model-apps plugin
   - Registers PreToolUse hooks for AskUserQuestion, Bash, Task
   - Prints every message received
4. Run against eval 1 prompt: `"Build a page showing Account records as a gallery of cards..."`
5. Observe:
   - **Does the AskUserQuestion hook receive the question structure?** (If yes, OQ5
     unknowns resolved — we can mock it.)
   - **Does a Task invocation fire a PreToolUse hook?** (If yes, OQ7 resolved.)
   - **Do subagent-internal tool calls also fire hooks?** (Critical for mocking pac
     inside the entity-builder.)
   - **Can we intercept ExitPlanMode and return a "reject with feedback" response?**
     (OQ10.)
6. Document the answers in this spec under "Spike findings" section (to be added).

### Step 2: Decide go/no-go based on spike

If the spike reveals the SDK can do what we need → proceed with full build.

If the SDK has gaps → either:
- Fall back to Option 1 (static checker only, no workflow regression testing)
- Reconsider CLI + session file parsing as Option B (limited mocking, post-hoc assertions)

### Step 3: Full build (if green-lit)

Follow the effort estimate above. Deliverables per phase committed as we go.

### Step 4: Rollout

1. Get smoke tier green first
2. Enable in CI for PRs touching model-apps
3. Add full tier nightly
4. Document in `eval-runbook.md` (replace "manual" section with "automated" section)
5. Deprecate the manual runbook steps for Layer 1 + 2

---

## Current state of the eval suite

For future reference, here's the state of the evals at spec-writing time:

- **Total evals:** 16
- **Tiers:** smoke (4) / full (9) / stress (3)
- **Location:** `evals/model-apps/genpage/evals.json`
- **Structure:**
  - `skill_name: "genpage"`
  - `eval_instructions` — points to runbook
  - `common_workflow_assertions` (7 items) — shared workflow checks
  - `common_code_assertions` (14 items) — shared .tsx grep checks
  - `evals[]` — 16 cases with `id`, `tier`, `prompt`, `data` (with question_answers,
    app_selection, scripted scenarios), `expectations[]`
- **Runbook:** `evals/model-apps/genpage/eval-runbook.md` — 3-layer structure,
  manual process, UX rubric

## Current state of the model-apps plugin

- **Version:** 2.0.0 (bumped from 1.0.6 for this branch)
- **Agents:**
  - `genpage-planner` — requirements, entity/app detection, plan doc
  - `genpage-entity-builder` — Dataverse entity creation via DV plugin
  - `genpage-page-builder` — code gen, parallel-ready
  - `genpage-edit-planner` — edit planning with download artifact reading
- **Orchestrator:** `plugins/model-apps/skills/genpage/SKILL.md`
  - Create flow: Phase 0-8
  - Edit flow: Phase 1-8 (uniform, no simple/complex split)
- **References:**
  - `genpage-rules-reference.md` — code generation rules
  - `genpage-plan-schema.md` — plan doc structure contract
  - `troubleshooting.md`
- **Samples:** 9 `.tsx` examples covering grids, wizards, CRUD, forms, caching, etc.
- **Soft dependency:** `microsoft/Dataverse-skills` plugin (required for entity creation only)
- **PAC CLI requirement:** >= 2.7.0

## Feature branch

`feature/genpage-agent-architecture` — 13 commits ahead of `main`. Contains:
- Agent architecture refactor
- Eval suite restructure
- Runbook
- Plan schema
- Download-artifact-aware edit planner

## References and exploration artifacts

- Claude Code CLI docs: https://code.claude.com/docs/en/cli-reference
- Headless mode docs: https://code.claude.com/docs/en/headless
- Hooks reference: https://code.claude.com/docs/en/hooks
- Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Agent SDK subagents: https://code.claude.com/docs/en/agent-sdk/subagents
- mcp-apps eval runbook (reference pattern we emulate): `evals/mcp-apps/generate-mcp-app-ui/eval-runbook.md`

---

## Appendix A: Example full harness invocation

```bash
# Local development
cd scripts/evals
npm install
npm run build

# Run smoke tier
node dist/cli.js --tier smoke --plugin-dir ../../plugins/model-apps

# Run single eval for debugging
node dist/cli.js --eval 3 --plugin-dir ../../plugins/model-apps --verbose

# CI (GitHub Actions)
# workflow runs `npm run evals:smoke` after build
```

Expected output:

```
Running smoke tier (4 evals)...
[ PASS ] Eval 1: Build a page showing Account records... (37.4s, $0.28)
[ PASS ] Eval 2: Create a dashboard page with mock data... (41.2s, $0.31)
[ PASS ] Eval 3: I need to edit an existing generative page... (52.1s, $0.39)
[ FAIL ] Eval 16: Plan schema compliance
  - FAIL: Phase 1 (Planner): ## Pages table must exist in genpage-plan.md
    Expected section heading '## Pages' in output file
    Actual content had heading '## Page List' (wrong heading)
    Owner: plugins/model-apps/agents/genpage-planner.md (Step 6)

3 passed, 1 failed.
Total tokens: 187,432 ($1.15)
Total wall time: 180s
```

## Appendix B: Fixture file examples

### `pac-model-list-tables-account.txt`

```
Connected as aurora365-User1@auroratstgeo.onmicrosoft.com
Retrieving Dataverse tables...
Found 9 table(s):

Logical Name            Display Name             Schema Name             Type
account                 Account                  Account                 Standard
accountleads            AccountLeads             AccountLeads            Standard
...
```

### `runtime-types-account.ts`

```typescript
// Generated by pac model genpage generate-types --data-sources "account"
export type Account = TableRow<{
  readonly accountid: RowKeyDataColumnValue;
  name: string;
  websiteurl?: string;
  emailaddress1?: string;
  telephone1?: string;
  _primarycontactid_value?: string;
  // ...
}>;

interface TableRegistrations extends BaseTableRegistrations {
  "account": Account;
}
// ...
```

### `genpage-download-contact-page/config.json`

```json
{ "dataSources": ["contact"], "model": "claude-sonnet-4-6" }
```

### `genpage-download-contact-page/prompt.txt`

```
Build a page showing Contact records in a data grid with name, email, phone.
```

### `genpage-download-contact-page/page.tsx`

```typescript
import React, { useEffect, useState } from 'react';
import { /* ... */ } from '@fluentui/react-components';
import type { GeneratedComponentProps } from './RuntimeTypes';

const GeneratedComponent = (props: GeneratedComponentProps) => {
  const { dataApi, pageInput } = props;
  // ... existing contact-grid implementation
};

export default GeneratedComponent;
```
