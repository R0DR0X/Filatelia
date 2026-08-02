import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The 7 admin pages/clients + BidModal used to read `fp_token`/`fp_user`
// from localStorage and call the Worker's `*.workers.dev` origin directly.
// After the E1 migration:
//  - the 7 admin surfaces call the session-gated Next proxy
//    (`/api/admin/<subpath>`, via `adminFetch`) instead;
//  - BidModal relies solely on the `fp_session` cookie already verified by
//    `/api/bids` — it is not an admin surface, so it does not go through
//    the admin proxy.
// None of the 8 files may read localStorage or hold a bearer token again.

const ADMIN_CLIENT_FILES = [
  "src/app/(admin)/admin/dashboard/DashboardClient.tsx",
  "src/app/(admin)/admin/analitica/page.tsx",
  "src/app/(admin)/admin/usuarios/UsuariosAdminClient.tsx",
  "src/app/(admin)/admin/importar/page.tsx",
  "src/app/(admin)/admin/sellos/SellosAdminClient.tsx",
  "src/app/(admin)/admin/grupos/GruposAdminClient.tsx",
  "src/app/(admin)/admin/catalogos/CatalogosAdminClient.tsx",
];

const BID_MODAL_FILE = "src/components/auctions/BidModal.tsx";

function readSrc(relPath: string): string {
  return readFileSync(resolve(__dirname, "..", relPath), "utf-8");
}

describe("admin clients + BidModal no longer touch fp_token/fp_user/localStorage", () => {
  for (const file of [...ADMIN_CLIENT_FILES, BID_MODAL_FILE]) {
    it(`${file} contains no localStorage identity access`, () => {
      const src = readSrc(file);
      expect(src).not.toMatch(/localStorage/);
      expect(src).not.toMatch(/fp_token/);
      expect(src).not.toMatch(/fp_user/);
    });

    it(`${file} does not talk to the Worker's workers.dev origin directly`, () => {
      const src = readSrc(file);
      expect(src).not.toMatch(/workers\.dev/);
    });
  }

  for (const file of ADMIN_CLIENT_FILES) {
    it(`${file} calls the admin proxy via adminFetch`, () => {
      const src = readSrc(file);
      expect(src).toMatch(/adminFetch/);
    });
  }

  it("BidModal does not send an Authorization header on its /api/bids call", () => {
    const src = readSrc(BID_MODAL_FILE);
    expect(src).not.toMatch(/Authorization/);
  });
});
