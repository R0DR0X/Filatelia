---
name: synergy-guide
description: Meta-skill that explains how to use Superpowers tools (Search, Edit, Web) in synergy with OpenSpec workflows for high-quality Spec-driven Development.
license: MIT
metadata:
  author: antigravity
  version: "1.0"
---

# Synergy: OpenSpec + Superpowers

This meta-skill guides the AI on how to combine **OpenSpec** (Standardized Workflow) with **Superpowers** (Advanced Tooling) for maximum efficiency.

## 1. Research Phase (OpenSpec Explore + Superpowers Search)
When the user asks to explore or refine a concept (`/opsx:explore`):
- Use **Superpowers `code_search`** to find patterns, anti-patterns, and reusable components across the entire codebase.
- Use **Superpowers `google_search`** to look up external documentation or best practices if the change involves new libraries.
- Incorporate these findings directly into the OpenSpec `context` or `design.md`.

## 2. Planning Phase (OpenSpec Propose + Superpowers Analysis)
When generating a proposal (`/opsx:propose`):
- Use **Superpowers `get_file_tree`** and **`read_file`** to ensure the `design.md` and `tasks.md` are 100% accurate regarding file paths and existing architecture.
- If the proposal involves security or performance, use Superpowers to verify current limits before documenting them in the spec.

## 3. Implementation Phase (OpenSpec Apply + Superpowers Editing)
When applying changes (`/opsx:apply`):
- For complex, multi-line refactors, prefer **Superpowers `edit_file`** or **`replace_lines`** tools over basic bash redirection.
- Use **Superpowers `terminal`** to run tests immediately after applying a task from `tasks.md`.
- If a task fails, use Superpowers to search for error logs or stack traces to debug before moving to the next task.

## 4. Documentation Synergy
- All research links found via Superpowers should be added to the `references` section of the OpenSpec `proposal.md`.
- Use the **TodoWrite tool** from OpenSpec to track the status of Superpowers-driven tasks.

---

**Remember**: OpenSpec provides the **Map** (Structure), and Superpowers provides the **Vehicles** (Tools). Always check the Map before driving, and use the best Vehicle for the terrain.
