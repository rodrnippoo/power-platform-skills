# Exploration Findings: Claude Code Headless + Hooks + SDK

**Date explored:** 2026-04-17
**Purpose:** Inform the automated eval harness design for `model-apps/genpage`
**Spec that uses these findings:** `2026-04-17-automated-eval-harness-spec.md` (same folder)

This doc captures the raw findings from investigating Claude Code's programmatic
capabilities so a future reader doesn't have to repeat the exploration.

---

## 1. Claude Code CLI headless mode

### What works

- **`claude -p "prompt"`** — non-interactive execution
- **`--plugin-dir <path>`** — load plugins (repeat for multiple)
- **`--model <name>`** — model selection (e.g., `claude-opus-4-7`, `claude-sonnet-4-6`)
- **`--allowed-tools <list>`** — whitelist tools
- **`--output-format text | json | stream-json`** — output shape
- **`--include-hook-events`** — surface hook events in stream output (useful for debug)
- **`--permission-mode bypassPermissions`** or **`--dangerously-skip-permissions`** —
  bypass approval prompts
- **`--bare`** — minimal output
- **`--session-id <id>`** — resume an existing session

### What does NOT work

- **No stdin mechanism for AskUserQuestion answers.** The `-p` mode runs to completion
  and exits; it cannot accept interactive answers mid-run.
- **Hooks cannot inject synthetic tool responses via the CLI.** PreToolUse hooks are
  limited to `allow` / `deny` / `defer`. They cannot say "return this fake output
  instead of running the tool."
- **No dynamic hook configuration per run from CLI flags.** Hooks are declared in
  `.claude/settings.json` statically. Env vars in the hook script body can branch,
  but there's no clean "pass config into hook" mechanism.

### Output formats

| Format | Content |
|--------|---------|
| `text` (default) | Plain text final result only |
| `json` | Structured: `session_id`, `result`, `usage`, metadata |
| `stream-json` | Newline-delimited JSON events, one per token/event (requires `--verbose`) |

### Stream-json event types

- `system/init` — session metadata (model, tools, plugins loaded)
- `system/api_retry` — retry events with attempt count
- `stream_event` with delta blocks for each token
- Individual tool calls and results (when `--include-hook-events` is set)
- `plugin_install` events (with `CLAUDE_CODE_SYNC_PLUGIN_INSTALL` env var)

### Limitation: JSON output lacks full tool chain

The JSON output gives you the final result and metadata, but NOT a granular "tool call
tree" showing which subagent ran in what phase with what args. For that level of
detail, you must parse the session transcript files (see §4).

---

## 2. Hook interception via CLI

### PreToolUse hook schema

```json
{
  "continue": false,
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Mocked by eval harness"
  }
}
```

Decisions: `allow | deny | defer` only.

### Matcher patterns

```json
{
  "matcher": "AskUserQuestion|Bash|Agent",    // Pipe-separated exact
  "matcher": "^mcp__dataverse__",              // Regex
  "matcher": "*"                                // All tools
}
```

### The critical limitation

**PreToolUse cannot inject a fake tool result.** It can only block. If you block, the
agent sees the deny reason and tries to continue — but you can't say "here's the fake
`pac model list` output, continue as if that's what ran."

You could theoretically block the real tool AND use PostToolUse to rewrite the tool
result, but PostToolUse also has limited injection capability and the flow becomes
convoluted.

**Conclusion: CLI hooks alone are insufficient for our eval mocking needs.**

---

## 3. Claude Agent SDK (Python / TypeScript)

### Available in both languages

- Python: `pip install claude-agent-sdk`
- TypeScript: `npm install @anthropic-ai/claude-agent-sdk`

### Key capabilities (from docs research)

✅ **Programmatic hook callbacks** — hooks are functions, not shell scripts
✅ **Tool result injection** — hook callbacks CAN return synthetic tool output
✅ **Subagent definitions** — define agents programmatically
✅ **Session resumption** — capture `session_id`, resume later
✅ **Streaming output** — async iterator over each message
✅ **Structured message access** — full content blocks, not serialized JSON strings

### Python example (from Anthropic docs, adapted)

```python
from claude_agent_sdk import query, ClaudeAgentOptions, HookMatcher

async def mock_ask_user_question(input_data, tool_use_id, context):
    """Intercept AskUserQuestion and return canned answer."""
    # input_data is the tool input: { questions: [{ header, question, options }] }
    # Return a synthetic result:
    return {
      "selected_option": "new"  # Replace with scenario-specific answer
    }

options = ClaudeAgentOptions(
    allowed_tools=["Read", "Edit", "Bash", "Agent", "AskUserQuestion"],
    hooks={
        "PreToolUse": [
            HookMatcher(
                matcher="AskUserQuestion",
                hooks=[mock_ask_user_question]
            )
        ]
    }
)

async for message in query(prompt="/genpage ...", options=options):
    # message can be: assistant message with tool_use blocks,
    #                 tool_result message (has parent_tool_use_id),
    #                 system/init, ResultMessage, etc.
    if hasattr(message, "result"):
        print(message.result)
```

### Benefits over CLI

- Hook callbacks receive **structured data**, not JSON strings
- Can **inject synthetic results** (the thing CLI hooks can't)
- Subagent messages include `parent_tool_use_id` directly on the object
- Full streaming access to every message type
- Session transcript parsing built-in

### Unknowns (must verify in spike)

- **Does PreToolUse fire for Task/Agent invocations?** If yes, we can intercept and
  verify subagent dispatch.
- **Do hooks registered on the main query apply to subagent-internal tool calls?** If
  yes, we can mock `pac` inside the entity-builder. If no, we have to handle subagents
  specially.
- **Can the hook for `ExitPlanMode` return a "rejected with feedback" response?** If
  yes, we can test plan revision (eval 12). If no, eval 12 isn't testable.

---

## 4. Session transcript files

### Location

```
~/.claude/projects/<PROJECT_HASH>/<SESSION_ID>/
  └── main.jsonl                 # Main conversation transcript
  └── <subagent-id>.jsonl        # Each subagent's transcript (one file per)
```

### Format

Newline-delimited JSON (JSONL). Each line is a message object:

```json
{
  "parentUuid": "...",
  "sessionId": "...",
  "agentId": "a67e0ac",
  "type": "user|assistant|tool_result",
  "message": {
    "role": "user|assistant",
    "content": [
      { "type": "text", "text": "..." },
      { "type": "tool_use", "id": "...", "name": "Agent", "input": { "subagent_type": "genpage-planner", "prompt": "..." } },
      { "type": "tool_result", "tool_use_id": "...", "content": "..." }
    ],
    "stop_reason": "tool_use | end_turn | ...",
    "usage": { "input_tokens": N, "output_tokens": N, ... }
  },
  "uuid": "...",
  "timestamp": "2026-04-17T10:00:00.000Z",
  "requestId": "..."
}
```

### Key fields for eval verification

- `type === "assistant"` → Claude's response (may contain tool_use blocks)
- `message.content[N].type === "tool_use"` → a tool invocation
  - `.name` → tool name (`Bash`, `Write`, `Agent`, `AskUserQuestion`, `mcp__dataverse__list_tables`, ...)
  - `.input` → tool arguments (for `Agent`, includes `subagent_type` + `prompt`)
- `agentId` → which agent this line came from ("main" or a subagent id)
- `parentUuid` → links to parent turn / tool call

### Example: verify Phase 1 invoked planner

```bash
jq -s '
  map(select(.type == "assistant"))
  | map(.message.content[] | select(.type == "tool_use" and .name == "Agent"))
  | map(.input.subagent_type)
' ~/.claude/projects/$(HASH)/$(SESSION_ID)/main.jsonl
```

Should return `["genpage-planner", ...]` with planner as the first invocation.

### Retention

- Persisted for `cleanupPeriodDays` (default 30)
- Configurable in `.claude/settings.json`

---

## 5. Recommended architecture

Based on all findings: **use the TypeScript Agent SDK** (or Python if preferred).

### Flow per eval

1. Build mock callbacks for each tool category (AskUserQuestion, Bash, MCP, ExitPlanMode)
2. Invoke `query()` with:
   - Plugin dir for model-apps
   - Hooks for PreToolUse on all mockable tools
   - Bypass permissions
3. Consume the async iterator, capture every message
4. After ResultMessage, parse the session transcript for complete picture
5. Run assertion library against the parsed run record

### What needs to happen before committing to the build

**2-hour spike** to resolve the three unknowns:

1. Does PreToolUse hook fire for `Agent` (Task) invocations?
2. Do main-agent hooks apply to subagent-internal tool calls?
3. Can ExitPlanMode hook return a "rejected with feedback" response?

---

## 6. Summary table: what works today

| Need | CLI `-p` | Agent SDK | Notes |
|------|----------|-----------|-------|
| Headless execution | ✅ | ✅ | CLI with `-p`, SDK with `query()` |
| Disable permission prompts | ✅ | ✅ | `--dangerously-skip-permissions` or `permissionMode: "bypassPermissions"` |
| Stream output | ✅ | ✅ | `--output-format stream-json` or async iterators |
| Mock AskUserQuestion | ❌ | ✅ | Only SDK hooks can inject responses |
| Mock Bash tool results | ❌ | ✅ | SDK hooks can inject fake output |
| Mock MCP tools | ❌ | ✅ | Same |
| Per-run mocking config | ⚠️ | ✅ | CLI needs env vars + regenerated hook scripts; SDK uses closures |
| Detect subagent invocation | ✅ (via transcript) | ✅ (real-time + transcript) | SDK shows `parent_tool_use_id` immediately |
| Session transcript parsing | ✅ | ✅ | JSONL files at `~/.claude/projects/<hash>/<ID>/` |
| Verify parallel dispatch | ✅ (transcript) | ✅ (multiple tool_use in one assistant message) | Look for N `Agent` tool_use blocks in a single assistant turn |

---

## Sources

- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Headless mode: https://code.claude.com/docs/en/headless
- Hooks reference: https://code.claude.com/docs/en/hooks
- Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Agent SDK subagents: https://code.claude.com/docs/en/agent-sdk/subagents
