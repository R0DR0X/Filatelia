"""Parsing tests for the Colnect detail page (PENDIENTES.md E2.3-E2.5).

Run with:

    python -m pytest scrapers/test_parse.py

These tests use fixed HTML rather than the network on purpose. The detail
phase is blocked on proxy bandwidth, so the only way to get the parser right
before we spend those GB is to pin it against a saved page. Mt Taranaki is the
golden case named in the plan: it carries every field we care about and it has
variants.

The HTML below mirrors the structure the parser actually reads (a `div.i_d`
definition list plus the item image), not a byte-for-byte copy of Colnect's
page — the parser only ever looks at those nodes, and a full page dump would
hide which parts the assertions depend on.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Importing the scraper module resolves the proxy/Colnect credentials at import
# time and calls sys.exit(1) when any are missing. That fail-fast is deliberate
# and worth keeping — a crawl must not run for hours and only then discover it
# cannot write — but it also means a pure parsing test cannot import the
# function without them. Placeholders satisfy the import; nothing in this file
# opens a socket, and every test drives `parse_detail_page` on a fixed string.
for _var in (
    "DATAIMPULSE_HOST", "DATAIMPULSE_USER", "DATAIMPULSE_PASS",
    "COLNECT_USER", "COLNECT_PASS", "ADMIN_API_TOKEN",
):
    os.environ.setdefault(_var, "test-placeholder-not-a-credential")

from colnect_global_scraper_v3 import parse_detail_page, parse_listing_page  # noqa: E402


def _listing_html(theme_value):
    """One listing item whose Themes cell holds `theme_value`."""
    return f"""
    <html><body>
      <div class="pl-it">
        <h2 class="item_header"><a href="/en/stamps/stamp/42-Test">Test Stamp</a></h2>
        <div class="i_d">
          <div>Themes:{theme_value}</div>
          <div>Colors:Blue</div>
        </div>
      </div>
    </body></html>
    """


TARANAKI_URL = "https://colnect.com/en/stamps/stamp/1234567-Mt_Taranaki-New_Zealand"

TARANAKI_HTML = """
<html>
  <head><title>Mt Taranaki - Landscapes - New Zealand - Stamp</title></head>
  <body>
    <div class="item_image"><img data-src="https://i.colnect.net/b/1234/567/Mt-Taranaki.jpg"></div>
    <div class="item_image_back"><img src="https://i.colnect.net/b/1234/567/Mt-Taranaki-back.jpg"></div>
    <div class="i_d">
      <dl>
        <dt>Colnect code:</dt><dd>NZ 2006-14</dd>
        <dt>Issued on:</dt><dd>2006-08-02</dd>
        <dt>Size:</dt><dd>30 x 40 mm</dd>
        <dt>Format:</dt><dd>Stamp</dd>
        <dt>Emission:</dt><dd>Commemorative</dd>
        <dt>Gum:</dt><dd>PVA</dd>
        <dt>Perforation:</dt><dd>13&frac12; x 14</dd>
        <dt>Printing:</dt><dd>Offset lithography</dd>
        <dt>Paper:</dt><dd>Chalk surfaced</dd>
        <dt>Colors:</dt><dd>Multicolor</dd>
        <dt>Themes:</dt><dd>Mountains</dd>
        <dt>Description:</dt><dd>Mount Taranaki seen from the Pouakai Range.</dd>
      </dl>
    </div>
    <div class="variants">
      <a class="variant" href="/en/stamps/stamp/1234568-Mt_Taranaki_imperforate">
        <span class="variant_name">Imperforate</span>
        <span class="variant_code">NZ 2006-14a</span>
      </a>
      <a class="variant" href="/en/stamps/stamp/1234569-Mt_Taranaki_self_adhesive">
        <span class="variant_name">Self-adhesive</span>
      </a>
    </div>
  </body>
</html>
"""

BASIC = {
    "id": "stamp-taranaki",
    "nameEn": "Mt Taranaki",
    "year": 2005,
    "denomination": 1.5,
    "colnectCountryId": "173",
}


@pytest.fixture
def taranaki():
    return parse_detail_page(TARANAKI_HTML, TARANAKI_URL, BASIC)


# ── E2.3: the fields the detail page needs ──────────────────────────────────

def test_size_reaches_the_stamp_as_size_mm(taranaki):
    # `sizeMm` is NULL on all 147,555 production rows precisely because this
    # was never parsed. The column has always existed.
    assert taranaki["sizeMm"] == "30 x 40 mm"


def test_format_emission_and_gum_are_parsed(taranaki):
    assert taranaki["format"] == "Stamp"
    assert taranaki["emission"] == "Commemorative"
    assert taranaki["gum"] == "PVA"


def test_the_colnect_code_is_parsed(taranaki):
    assert taranaki["colnectCode"] == "NZ 2006-14"


def test_the_fields_that_already_worked_did_not_regress(taranaki):
    assert taranaki["perforation"] == "13½ x 14"
    assert taranaki["printTechnique"] == "Offset lithography"
    assert taranaki["paperType"] == "Chalk surfaced"
    assert taranaki["color"] == "Multicolor"
    assert taranaki["theme"] == "Mountains"
    assert taranaki["imageUrl"] == "https://i.colnect.net/b/1234/567/Mt-Taranaki.jpg"
    assert taranaki["imageBackUrl"] == "https://i.colnect.net/b/1234/567/Mt-Taranaki-back.jpg"


def test_the_detail_page_year_overrides_the_listing_year(taranaki):
    # The listing said 2005; the detail page says it was issued in 2006.
    assert taranaki["year"] == 2006


def test_the_name_comes_from_the_page_title(taranaki):
    assert taranaki["nameEn"] == "Mt Taranaki"


# ── E2.5: variants ──────────────────────────────────────────────────────────

def test_variants_are_extracted(taranaki):
    variants = taranaki["variants"]
    assert len(variants) == 2
    assert variants[0]["nameEn"] == "Imperforate"
    assert variants[0]["colnectCode"] == "NZ 2006-14a"
    assert variants[0]["sourceUrl"] == "https://colnect.com/en/stamps/stamp/1234568-Mt_Taranaki_imperforate"


def test_a_variant_without_a_code_is_still_kept(taranaki):
    second = taranaki["variants"][1]
    assert second["nameEn"] == "Self-adhesive"
    assert second["colnectCode"] is None


def test_a_page_with_no_variants_yields_an_empty_list():
    # The importer must receive [] rather than None: an absent key and an
    # empty list travel differently through the JSON payload.
    parsed = parse_detail_page(
        "<html><head><title>Plain</title></head><body></body></html>",
        "https://colnect.com/en/stamps/stamp/1-Plain",
        {"nameEn": "Plain"},
    )
    assert parsed["variants"] == []


# ── Missing data must stay missing ──────────────────────────────────────────

def test_absent_detail_fields_come_back_as_none_not_empty_string():
    # The Worker upserts with COALESCE(excluded.x, x). An empty string is not
    # NULL, so it would overwrite a previously scraped value with "" — the
    # detail phase would destroy data instead of adding it.
    parsed = parse_detail_page(
        "<html><head><title>Sparse</title></head><body><div class='i_d'><dl>"
        "<dt>Colors:</dt><dd>Blue</dd></dl></div></body></html>",
        "https://colnect.com/en/stamps/stamp/2-Sparse",
        {"nameEn": "Sparse"},
    )
    for field in ("sizeMm", "format", "emission", "gum", "colnectCode", "perforation"):
        assert parsed[field] is None, f"{field} must be None when the page omits it"
    assert parsed["color"] == "Blue"


# ── Colnect's anti-bot copy must never be stored as data ────────────────────

@pytest.mark.parametrize("junk", [
    "Login to see complete item details",
    "Confirm you are human to view details",
    "  login to see complete item details  ",
])
def test_antibot_text_is_not_stored_as_a_theme(junk):
    # An unauthenticated or rate-limited Colnect page serves its own message in
    # the cell the parser reads. Production ended up with 3,280 stamps whose
    # "theme" was "Login to see complete item details" and 591 reading
    # "Confirm you are human to view details" — cleaned out by migration 0015.
    # Nothing stopped the next run from writing them straight back, so the
    # parser now refuses them at the source. Matching is case- and
    # whitespace-insensitive because the page wording is not under our control.
    parsed = parse_detail_page(
        f"<html><head><title>X</title></head><body><div class='i_d'><dl>"
        f"<dt>Themes:</dt><dd>{junk}</dd></dl></div></body></html>",
        "https://colnect.com/en/stamps/stamp/9-X",
        {"nameEn": "X"},
    )
    assert parsed["theme"] is None


def test_a_real_theme_containing_the_word_human_is_kept():
    # 110 production stamps carry a genuine "Human Rights" theme. A substring
    # rule would have destroyed every one of them; the guard matches the whole
    # cell, not a fragment of it.
    parsed = parse_detail_page(
        "<html><head><title>X</title></head><body><div class='i_d'><dl>"
        "<dt>Themes:</dt><dd>Antiracism, Human Rights, Nobel Laureates</dd>"
        "</dl></div></body></html>",
        "https://colnect.com/en/stamps/stamp/10-X",
        {"nameEn": "X"},
    )
    assert parsed["theme"] == "Antiracism, Human Rights, Nobel Laureates"


def test_antibot_text_is_rejected_in_any_detail_field():
    # The same message lands in whichever cell the parser happens to read, so
    # the guard belongs in the shared cleaner rather than on `theme` alone.
    parsed = parse_detail_page(
        "<html><head><title>X</title></head><body><div class='i_d'><dl>"
        "<dt>Gum:</dt><dd>Login to see complete item details</dd>"
        "<dt>Colors:</dt><dd>Blue</dd></dl></div></body></html>",
        "https://colnect.com/en/stamps/stamp/11-X",
        {"nameEn": "X"},
    )
    assert parsed["gum"] is None
    assert parsed["color"] == "Blue"


def test_the_listing_phase_also_refuses_antibot_text():
    # This is the phase that actually ran against production, so it is where
    # the 3,280 bad themes came from. Guarding only the detail parser would
    # have fixed the half that never executed.
    stamps, _ = parse_listing_page(
        _listing_html("Login to see complete item details"), "173", "NZ"
    )
    assert len(stamps) == 1
    assert stamps[0]["theme"] is None
    assert stamps[0]["color"] == "Blue"


def test_the_listing_phase_keeps_a_real_theme():
    stamps, _ = parse_listing_page(
        _listing_html("Antiracism, Human Rights, Nobel Laureates"), "173", "NZ"
    )
    assert stamps[0]["theme"] == "Antiracism, Human Rights, Nobel Laureates"


def test_whitespace_only_cells_are_treated_as_missing():
    parsed = parse_detail_page(
        "<html><head><title>Blank</title></head><body><div class='i_d'><dl>"
        "<dt>Gum:</dt><dd>   </dd><dt>Size:</dt><dd></dd></dl></div></body></html>",
        "https://colnect.com/en/stamps/stamp/3-Blank",
        {"nameEn": "Blank"},
    )
    assert parsed["gum"] is None
    assert parsed["sizeMm"] is None
