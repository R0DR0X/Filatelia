---
name: opsx-review
description: Conducts a final review of the current OpenSpec change before archiving.
license: MIT
---

# /opsx:review

When this command is triggered:

1. **Verification with Superpowers**:
   - Use `terminal` to run the full test suite.
   - Use `ls` or `get_file_tree` to verify that all intended files were created/modified.
   - Use `google_search` to double-check against any newly discovered best practices if needed.

2. **OpenSpec Validation**:
   - Call `mcp__openspec__openspec_validate_change` to ensure all tasks are marked as complete.
   - Ensure `design.md` reflects the actual final implementation.

3. **Archiving**:
   - After user approval, call `mcp__openspec__openspec_archive_change`.

**Goal**: Zero-bug delivery and clean project state.
