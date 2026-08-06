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

from colnect_global_scraper_v3 import parse_detail_page  # noqa: E402


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


def test_whitespace_only_cells_are_treated_as_missing():
    parsed = parse_detail_page(
        "<html><head><title>Blank</title></head><body><div class='i_d'><dl>"
        "<dt>Gum:</dt><dd>   </dd><dt>Size:</dt><dd></dd></dl></div></body></html>",
        "https://colnect.com/en/stamps/stamp/3-Blank",
        {"nameEn": "Blank"},
    )
    assert parsed["gum"] is None
    assert parsed["sizeMm"] is None
