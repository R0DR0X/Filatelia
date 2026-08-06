-- D1 Migration v15: clear Colnect's anti-bot text out of Stamp.theme.
--
-- WHY: the Colnect listing scraper stored whatever sat in the themes cell,
-- and on pages it was not authenticated for that cell holds Colnect's own
-- paywall/anti-bot copy. Production therefore has thousands of stamps whose
-- "theme" is a message aimed at the scraper:
--
--   "Login to see complete item details"          3,280 stamps
--   "Confirm you are human to view details"         591 stamps
--
-- This was invisible until E3.6 made themes clickable. Now they render as
-- real, clickable topics on the ficha, and clicking one filters the catalogue
-- by a sentence Colnect wrote at our scraper.
--
-- NULL, NOT A GUESS. These rows have no known theme — the page never showed
-- us one. NULL means exactly that, and the detail page already hides a NULL
-- theme instead of rendering an empty chip. Substituting anything else would
-- invent data.
--
-- EXACT MATCH, DELIBERATELY NOT `LIKE '%Login%'`. A pattern match is the
-- obvious way to write this and the wrong one: it would also erase a genuine
-- theme that happens to contain one of those words, across 147,555 rows, with
-- no way to tell afterwards which rows were real. Every string below is one
-- verified value read out of production. If the survey in
-- scripts/ops/theme-cleanup.sh turns up another artifact, add it here as
-- another exact literal rather than widening these into a pattern.
--
-- This does not fix the scraper. The listing phase will re-introduce these
-- values on its next unauthenticated run; that belongs with E2, where the
-- session/cookie handling lives. This migration cleans what is already stored.
--
-- NOT EXECUTED BY THIS CHANGE. Committed as a reviewable artifact only.

UPDATE Stamp SET theme = NULL, updatedAt = datetime('now')
WHERE theme IN (
  'Login to see complete item details',
  'Confirm you are human to view details'
);
