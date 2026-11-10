## Problem

<!-- What user-visible problem or limitation does this change address? -->

## Approach

<!-- Summarize the implementation and the key decisions/trade-offs. -->

## Behavior changes

- [ ] CLI flags or output changed
- [ ] Routing or quota behavior changed
- [ ] Persistence, resume, or checkpoint format changed
- [ ] Provider adapter or custom endpoint configuration changed
- [ ] TUI behavior changed
- [ ] Safety or credential handling changed
- [ ] Documentation only

## Testing

<!-- List commands run and manual checks performed. -->

```text
npm run verify
```

## Safety checklist

- [ ] No API keys, tokens, database files, logs, or private project code are included.
- [ ] New provider behavior is implemented through adapters or endpoint configuration, not vendor-specific checks in the agent.
- [ ] Error classification goes through `src/core/providers/errors.ts`; reset times are never invented.
- [ ] Credentials remain masked/redacted in output, errors, logs, and exports.
- [ ] File writes, commands, dangerous commands, secret reads, and paid fallbacks remain gated by default.
- [ ] New behavior is covered by tests that do not require real credentials or network access.
- [ ] Cross-platform behavior was considered (Windows paths, CRLF, shell quoting, process killing).

## Related issues

<!-- Closes #... -->
