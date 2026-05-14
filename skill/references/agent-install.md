# Agent Skill Install Reference

The AIMD macOS PKG installs the source skill at:

```text
/usr/local/share/aimd/skill/aimd/
```

`aimd skill install` copies that folder into the target agent skills directory as:

```text
<skills-dir>/aimd/SKILL.md
```

Supported mappings:

| Agent | User skills directory | Project skills directory |
|---|---|---|
| ClaudeCode | `~/.claude/skills/` | `.claude/skills/` |
| GitHubCopilot | `~/.copilot/skills/` | `.github/skills/` |
| OpenAI Codex | `~/.agents/skills/` | `.agents/skills/` |
| GeminiCLI | `~/.gemini/skills/` | `.gemini/skills/` |
| Cursor | `~/.cursor/skills/` | `.cursor/skills/` |
| Amp | `~/.config/agents/skills/` | `.agents/skills/` |
| Goose | `~/.agents/skills/` | `.agents/skills/` |
| OpenCode | `~/.config/opencode/skills/` | `.opencode/skills/` |
| Windsurf | `~/.codeium/windsurf/skills/` | `.windsurf/skills/` |
| Antigravity | `~/.gemini/antigravity/skills/` | `.agents/skills/` |
| Cline | `~/.agents/skills/` | `.agents/skills/` |
| Warp | `~/.agents/skills/` | `.agents/skills/` |
| Continue | `~/.continue/skills/` | `.continue/skills/` |
| Roo | `~/.roo/skills/` | `.roo/skills/` |
| KiroCLI | `~/.kiro/skills/` | `.kiro/skills/` |
| QwenCode | `~/.qwen/skills/` | `.qwen/skills/` |
| OpenHands | `~/.openhands/skills/` | `.openhands/skills/` |
| Qoder / QoderWork | `~/.qoderwork/skills/` | `.qoder/skills/` |

Agent names are case-insensitive and support common aliases such as `codex`, `openai-codex`, `claude-code`, `github-copilot`, `gemini`, `opencode`, and `qoderwork`.
