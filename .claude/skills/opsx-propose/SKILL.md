---
name: opsx-propose
description: Proposes a new feature or change using OpenSpec methodology, enhanced by Superpowers for codebase analysis.
license: MIT
---

# /opsx:propose <feature_description>

When this command is triggered:

1. **Research with Superpowers**:
   - Use `code_search` to find existing implementations related to `<feature_description>`.
   - Use `get_file_tree` to understand the target architecture.
   - Use `read_file` to analyze relevant files.

2. **OpenSpec Proposal**:
   - Call `mcp__openspec__openspec_create_change` with a slug based on the feature.
   - Initialize `design.md` with technical architecture discovered via Superpowers.
   - Initialize `tasks.md` with a clear implementation plan.

3. **Synergy Check**:
   - Verify that all mentioned file paths in `tasks.md` actually exist or are explicitly marked for creation.
   - Add links to found patterns in the `references` section.

**Goal**: A 100% accurate implementation plan before writing any code.
