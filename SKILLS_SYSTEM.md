# Skills and Governed Learning

Portable skills use the Agent Skills directory shape. `grain skills validate`
enforces the normative name, directory-name, description, and length constraints
before a package can activate:

```text
.grain/skills/release-review/SKILL.md
~/.grain/skills/release-review/SKILL.md
```

`SKILL.md` begins with `name`, `description`, and optional `tags` frontmatter.
Grain indexes metadata first and loads a body only after relevance selection.
Project `.grain/skills` overrides compatible read-only discovery from
`.agents/skills` and `.claude/skills`. Legacy flat Markdown and JSON skills are
read for migration compatibility.

```md
---
name: release-review
description: Verify a release without publishing it
tags: [release, security]
---

Run the full qualification and inspect every generated checksum.
```

Machine-proposed learning is separate from trusted skills. The durable ledger
uses `candidate → evaluated → validated → promoted`; a candidate cannot validate
itself, and promotion requires independent passing evidence. Executable scripts,
permissions, global behavior, and cross-project behavior require user review.

Useful commands:

```sh
grain skills list
grain skills validate
grain skills view release-review
grain learning list
grain learning validate <id> <run-id>
grain learning validate <id> <second-independent-run-id>
grain learning promote <id>
```

Global recall is disabled by default. Memory and skills are treated as untrusted
context, not system instructions.
