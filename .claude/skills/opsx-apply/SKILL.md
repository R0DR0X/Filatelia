---
name: opsx-apply
description: Applies a task from the current OpenSpec change, using Superpowers for precise code editing.
license: MIT
---

# /opsx:apply [task_id]

When this command is triggered:

1. **Task Retrieval**:
   - Call `mcp__openspec__openspec_get_tasks` to identify the next pending task.

2. **Precision Editing with Superpowers**:
   - Use `read_file` to get the latest content of the target file.
   - Use `replace_lines` or `edit_file` from Superpowers to apply the logic specified in `design.md`.
   - Avoid manual bash redirects for complex changes.

3. **Validation**:
   - Use `terminal` to run relevant tests (e.g., `npm test`).
   - If tests fail, use `code_search` to find the cause and fix it before marking the task as complete.

4. **Completion**:
   - Update `tasks.md` via `mcp__openspec__openspec_update_task`.

**Goal**: Atomic, verified changes that follow the established plan.
