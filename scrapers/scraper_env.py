#!/usr/bin/env python3
"""
Fail-fast environment variable helpers for the Python scrapers.
==================================================================
Mirrors `scrapers/lib/admin-token.mjs` for the Node scrapers: every
credential a Python scraper needs (DataImpulse proxy, Colnect account,
the Worker's admin token) must come from the environment, never from a
hardcoded default. A missing variable stops the script immediately with a
clear message naming the variable, before any network request — so a
long-running crawl never burns hours only to fail on its first write.

Usage:
    from scraper_env import require_env, require_admin_token

    PROXY_USER = require_env("DATAIMPULSE_USER", "DataImpulse proxy username (dashboard.dataimpulse.com)")
    ADMIN_TOKEN = require_admin_token()
"""

import os
import sys


def require_env(name: str, hint: str = "") -> str:
    """Reads `name` from the environment or exits the process with a clear error.

    Call this once at scraper startup, before any long-running crawl work,
    so a missing credential is never discovered only after the crawl has
    already started.
    """
    value = os.environ.get(name)
    if not value:
        extra = f"\n   {hint}" if hint else ""
        print(
            f"\n❌ {name} no está definida.{extra}\n"
            f"   Exportá la variable antes de correr el script, por ejemplo:\n"
            f'     export {name}="<valor>"\n',
            file=sys.stderr,
        )
        sys.exit(1)
    return value


def require_admin_token() -> str:
    """Reads `ADMIN_API_TOKEN`, required by every script that POSTs to /import-stamp.

    `POST /import-stamp` (and its `/admin/import-stamp` alias) is guarded by
    `requireAdmin` on the Worker (see workers/filatelia-api/src/index.ts): a
    caller must present `X-Admin-Token` matching the Worker's
    `ADMIN_API_TOKEN` secret, or every write is rejected with 403.
    """
    return require_env(
        "ADMIN_API_TOKEN",
        "POST /import-stamp ahora requiere autenticación (X-Admin-Token).\n"
        "   (mismo valor que el secreto ADMIN_API_TOKEN del Worker — ver scrapers/README.md)",
    )
