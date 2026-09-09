#!/usr/bin/env python3
"""
Generates "Drive247 - Square Secrets Inventory" as a .docx.

Regenerate after any credential change:
    python scripts/build-square-secrets-doc.py

NO SECRET VALUE IS WRITTEN INTO THIS DOCUMENT. Values are represented by a
10-character SHA-256 fingerprint and a length, which is enough to tell two
values apart, to spot the same key pasted into two slots, and to confirm a
rotation actually changed something -- without putting the secret into a file
that gets emailed, printed or committed.
"""

import datetime
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

TODAY = "August 29, 2026"

# Notion-ish palette
CLR_PROD_BG = "FDE2E2"
CLR_PROD_TX = "9B1C1C"
CLR_STAG_BG = "FDF0D5"
CLR_STAG_TX = "8A5A00"
CLR_PLAT_BG = "DCEAFE"
CLR_PLAT_TX = "1E429F"
CLR_STORE_BG = "DCFCE7"
CLR_STORE_TX = "166534"
CLR_HEAD_BG = "F1F5F9"
CLR_DEAD_BG = "FEF2F2"


def shade(cell, hex_fill):
    el = OxmlElement("w:shd")
    el.set(qn("w:val"), "clear")
    el.set(qn("w:fill"), hex_fill)
    cell._tc.get_or_add_tcPr().append(el)


def tag(paragraph, text, bg, fg):
    """A coloured pill, as close as .docx gets to a Notion tag."""
    run = paragraph.add_run(f" {text} ")
    run.font.size = Pt(7.5)
    run.font.bold = True
    run.font.color.rgb = RGBColor.from_string(fg)
    el = OxmlElement("w:shd")
    el.set(qn("w:val"), "clear")
    el.set(qn("w:fill"), bg)
    run._element.get_or_add_rPr().append(el)
    paragraph.add_run(" ")


def mono(paragraph, text, size=7.5, bold=False, colour=None):
    run = paragraph.add_run(text)
    run.font.name = "Consolas"
    run.font.size = Pt(size)
    run.font.bold = bold
    if colour:
        run.font.color.rgb = RGBColor.from_string(colour)
    return run


def plain(paragraph, text, size=7.5, bold=False, italic=False, colour=None):
    run = paragraph.add_run(text)
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    if colour:
        run.font.color.rgb = RGBColor.from_string(colour)
    return run


def cell_p(cell):
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    return p


# ---------------------------------------------------------------------------
# The inventory. `env`: P = production only, S = staging only, B = both.
# `value_default` / `value_staging` never hold a secret -- only a fingerprint,
# a public value, or an instruction.
# ---------------------------------------------------------------------------
ROWS = [
    # --- Sandbox / Staging -------------------------------------------------
    dict(n="001", key="SQUARE_TEST_APP_ID", env="S",
         used="get-square-config:29\nsquare-oauth-start:189",
         default="—", staging="len=37  fp=fce540dc21",
         stored="Supabase", verified=True,
         note="Sandbox application id. Not secret, but environment-specific."),
    dict(n="002", key="SQUARE_TEST_APP_SECRET", env="S",
         used="square-oauth-start:189",
         default="—", staging="len=58  fp=db867d77d2",
         stored="Supabase", verified=True, secret=True,
         note="Sandbox OAuth client secret."),
    dict(n="003", key="SQUARE_TEST_WEBHOOK_SIGNATURE_KEY", env="S",
         used="square-webhook:272",
         default="—", staging="len=22  fp=61bdc6c422",
         stored="Supabase", verified=True, secret=True,
         note="From the SANDBOX webhook subscription. Distinct from live."),
    dict(n="004", key="SQUARE_TEST_WEBHOOK_NOTIFICATION_URL", env="S",
         used="square-webhook:247",
         default="—", staging="(unset - falls back to shared URL)",
         stored="Supabase", verified=None, optional=True,
         note="Optional override. Only needed if sandbox targets a different project."),

    # --- Production --------------------------------------------------------
    dict(n="005", key="SQUARE_LIVE_APP_ID", env="P",
         used="get-square-config:28\nsquare-oauth-start:188",
         default="len=29  fp=b3f7fb349c", staging="—",
         stored="Supabase", verified=True,
         note="Production application id. Public identifier, not a secret."),
    dict(n="006", key="SQUARE_LIVE_APP_SECRET", env="P",
         used="square-oauth-start:188\nrefresh-square-tokens:50",
         default="len=50  fp=81fca334ae", staging="—",
         stored="Supabase", verified=True, secret=True, rotate=True,
         note="EXPOSED IN CHAT - rotate, then re-enter and re-run the health test."),
    dict(n="007", key="SQUARE_LIVE_WEBHOOK_SIGNATURE_KEY", env="P",
         used="square-webhook:273",
         default="len=22  fp=7374c609b7", staging="—",
         stored="Supabase", verified=True, secret=True, rotate=True,
         note="EXPOSED IN CHAT - regenerate the subscription key and re-enter."),
    dict(n="008", key="SQUARE_LIVE_WEBHOOK_NOTIFICATION_URL", env="P",
         used="square-webhook:244",
         default="(unset - falls back to shared URL)", staging="—",
         stored="Supabase", verified=None, optional=True,
         note="Optional override. Not needed while both modes share one project."),

    # --- Both --------------------------------------------------------------
    dict(n="009", key="SQUARE_REDIRECT_URI", env="B",
         used="square-oauth-start:179\nsquare-oauth-callback:285",
         default="https://hviqoaokxvlancmftwuo.supabase.co\n/functions/v1/square-oauth-callback",
         staging="(same value)",
         stored="Supabase", verified=None,
         note="NOT SQUARE_OAUTH_REDIRECT_URL - that name is read by nothing. "
              "Must match the console byte for byte; verify by eye."),
    dict(n="010", key="SQUARE_WEBHOOK_NOTIFICATION_URL", env="B",
         used="square-webhook:242",
         default="https://hviqoaokxvlancmftwuo.supabase.co\n/functions/v1/square-webhook",
         staging="(same value)",
         stored="Supabase", verified=True,
         note="Part of the signed HMAC message. A trailing slash silently drops every event."),
    dict(n="011", key="SQUARE_VERSION", env="B",
         used="square-client:152",
         default="2026-08-19", staging="(same value)",
         stored="Supabase", verified=True,
         note="Must match the API version on the webhook subscription."),
    dict(n="012", key="SQUARE_TIMEOUT_MS", env="B",
         used="square-client:303",
         default="(unset - default applies)", staging="(unset - default applies)",
         stored="Supabase", verified=None, optional=True,
         note="Tuning only. Clamped between the client's min and max."),
    dict(n="013", key="SQUARE_WEBHOOK_SIGNATURE_KEY", env="B",
         used="square-webhook:274",
         default="(unset)", staging="(unset)",
         stored="Supabase", verified=None, optional=True,
         note="Generic fallback candidate. Leave UNSET: with both per-mode keys "
              "present it can only ever resolve mode=null."),
]

# Per-tenant Square configuration that is NOT an environment variable.
TENANT_ROWS = [
    dict(n="014", key="square_connections.access_token", store="Supabase Vault (encrypted)",
         note="Per tenant, from OAuth. Every charge uses the TENANT's token - "
              "no platform access token exists anywhere in the code."),
    dict(n="015", key="square_connections.refresh_token", store="Supabase Vault (encrypted)",
         note="Per tenant. Rotated by refresh-square-tokens on a 10-minute cron."),
    dict(n="016", key="square_connections.location_id", store="Postgres (square_connections)",
         note="Per tenant. Surfaced to the browser by get-square-config - this is "
              "the one Square value the card form legitimately needs client-side."),
    dict(n="017", key="square_connections.merchant_id", store="Postgres (square_connections)",
         note="Per tenant. Maps a webhook event back to a tenant."),
    dict(n="018", key="tenants.square_mode", store="Postgres (tenants)",
         note="Per tenant, 'test' | 'live'. The real environment switch. "
              "Written only by set-square-mode."),
]

CLEANUP = [
    ("SQUARE_ENV", "DELETE",
     "Read by nothing. Mode comes from the OAuth state row and tenants.square_mode; "
     "the only mention is a comment saying 'never from SQUARE_ENV'. Currently set to "
     "'sandbox', which actively misleads."),
    ("SQUARE_TEST_ACCESS_TOKEN", "DELETE",
     "Read by nothing. Payments use each tenant's own OAuth token; there is no "
     "platform-token code path."),
    ("SQUARE_TEST_BASE_URL", "DELETE",
     "Read by nothing. Hosts are hardcoded at square-client.ts:164-165."),
    ("SQUARE_OAUTH_REDIRECT_URL", "RENAME",
     "Set by the runbook's section 3 command but read by nothing. The code reads "
     "SQUARE_REDIRECT_URI. Correct the runbook."),
]


def build():
    doc = Document()

    section = doc.sections[0]
    section.orientation = WD_ORIENT.LANDSCAPE
    section.page_width, section.page_height = section.page_height, section.page_width
    for attr in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
        setattr(section, attr, Inches(0.4))

    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(9)

    # ---- title -----------------------------------------------------------
    h = doc.add_paragraph()
    r = h.add_run("Drive247")
    r.font.size = Pt(24)
    r.font.bold = True
    h.paragraph_format.space_after = Pt(0)

    h2 = doc.add_paragraph()
    r = h2.add_run("Square Secrets Inventory")
    r.font.size = Pt(14)
    r.font.bold = True
    r.font.color.rgb = RGBColor.from_string("475569")
    h2.paragraph_format.space_after = Pt(6)

    intro = doc.add_paragraph()
    plain(intro, "Audited from the codebase on ", 8.5)
    plain(intro, TODAY, 8.5, bold=True)
    plain(intro,
          ". Every row below is a Square configuration item the code actually reads or writes; "
          "line references are to supabase/functions/. ", 8.5)
    plain(intro,
          "No secret value appears in this document - values are shown as a SHA-256 fingerprint "
          "and length, which distinguishes two values and proves a rotation happened without "
          "disclosing either.",
          8.5, bold=True)
    intro.paragraph_format.space_after = Pt(10)

    # ---- main table ------------------------------------------------------
    cols = ["#", "Key", "Environment", "Key (raw)", "Value (default)",
            "Value (staging)", "Platform", "Stored In", "Verified", "Last Updated"]
    widths = [0.32, 1.72, 0.82, 1.72, 1.65, 1.5, 0.62, 0.85, 0.62, 0.78]

    table = doc.add_table(rows=1, cols=len(cols))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER

    hdr = table.rows[0]
    for i, name in enumerate(cols):
        c = hdr.cells[i]
        shade(c, CLR_HEAD_BG)
        p = cell_p(c)
        plain(p, name, 7.5, bold=True, colour="334155")

    for row in ROWS:
        cells = table.add_row().cells

        cell_p(cells[0]); plain(cells[0].paragraphs[0], row["n"], 7, colour="94A3B8")

        p = cell_p(cells[1])
        mono(p, row["key"], 7.5, bold=True)
        if row.get("secret"):
            plain(p, "\nSECRET", 6.5, bold=True, colour="9B1C1C")
        elif row.get("optional"):
            plain(p, "\noptional", 6.5, italic=True, colour="94A3B8")

        p = cell_p(cells[2])
        if row["env"] in ("P", "B"):
            tag(p, "prod", CLR_PROD_BG, CLR_PROD_TX)
        if row["env"] in ("S", "B"):
            tag(p, "staging", CLR_STAG_BG, CLR_STAG_TX)

        cell_p(cells[3]); mono(cells[3].paragraphs[0], row["key"], 7)

        cell_p(cells[4]); mono(cells[4].paragraphs[0], row["default"], 6.5)
        cell_p(cells[5]); mono(cells[5].paragraphs[0], row["staging"], 6.5)

        p = cell_p(cells[6]); tag(p, "Square", CLR_PLAT_BG, CLR_PLAT_TX)
        p = cell_p(cells[7]); tag(p, row["stored"], CLR_STORE_BG, CLR_STORE_TX)

        p = cell_p(cells[8])
        if row.get("rotate"):
            plain(p, "☐ rotate", 7, bold=True, colour="9B1C1C")
        elif row["verified"] is True:
            plain(p, "☑ PASS", 7, bold=True, colour="166534")
        else:
            plain(p, "☐", 7, colour="94A3B8")

        cell_p(cells[9]); plain(cells[9].paragraphs[0], TODAY, 6.5, colour="64748B")

        if row.get("note"):
            nrow = table.add_row().cells
            merged = nrow[0]
            for k in range(1, len(cols)):
                merged = merged.merge(nrow[k])
            shade(merged, "FAFAFA")
            p = cell_p(merged)
            plain(p, "Used at: ", 6.5, bold=True, colour="475569")
            mono(p, row["used"].replace("\n", "   ·   "), 6.5, colour="475569")
            plain(p, "   —   ", 6.5, colour="CBD5E1")
            plain(p, row["note"], 6.5, italic=True, colour="475569")

    for r_ in table.rows:
        for i, c in enumerate(r_.cells):
            if i < len(widths):
                c.width = Inches(widths[i])

    # ---- legend ----------------------------------------------------------
    doc.add_paragraph()
    lg = doc.add_paragraph()
    plain(lg, "Environment is determined by usage, not assumption. ", 8, bold=True)
    plain(lg,
          "SQUARE_TEST_* are read only on the sandbox host and SQUARE_LIVE_* only on the "
          "production host (square-client.ts:164-165); the two sets are not interchangeable. "
          "Shared rows carry one value because both Square environments deliver to the same "
          "Supabase project - square-webhook identifies the environment by which signature "
          "key verifies, not by URL.", 8)

    # ---- per-tenant ------------------------------------------------------
    doc.add_paragraph()
    p = doc.add_paragraph()
    r = p.add_run("Square configuration that is NOT an environment variable")
    r.font.size = Pt(11); r.font.bold = True
    p2 = doc.add_paragraph()
    plain(p2,
          "These are per tenant and arrive through OAuth. They are listed so the inventory is "
          "complete: nobody should go looking for a SQUARE_LOCATION_ID or a platform access "
          "token in the environment, because neither exists.", 8)

    t2 = doc.add_table(rows=1, cols=4)
    t2.style = "Table Grid"
    for i, name in enumerate(["#", "Item", "Stored In", "Notes"]):
        c = t2.rows[0].cells[i]
        shade(c, CLR_HEAD_BG)
        cell_p(c); plain(c.paragraphs[0], name, 7.5, bold=True, colour="334155")
    for row in TENANT_ROWS:
        cells = t2.add_row().cells
        cell_p(cells[0]); plain(cells[0].paragraphs[0], row["n"], 7, colour="94A3B8")
        cell_p(cells[1]); mono(cells[1].paragraphs[0], row["key"], 7.5, bold=True)
        p = cell_p(cells[2]); tag(p, row["store"], CLR_STORE_BG, CLR_STORE_TX)
        cell_p(cells[3]); plain(cells[3].paragraphs[0], row["note"], 7)
    for r_ in t2.rows:
        for c, w in zip(r_.cells, [0.32, 2.3, 2.0, 6.0]):
            c.width = Inches(w)

    # ---- required from Square -------------------------------------------
    doc.add_paragraph()
    p = doc.add_paragraph()
    r = p.add_run("Required from the Square dashboard")
    r.font.size = Pt(11); r.font.bold = True

    for line, bold in [
        ("Nothing is missing for production - all four credentials pass the health test.", True),
        ("Rotate rows 006 and 007. Both were pasted into a chat transcript and must be "
         "regenerated in the console, re-entered, and re-tested before the Verified box is ticked.", False),
        ("Confirm row 009 by eye. Square does not expose the registered redirect URI through "
         "any API, so it can only be compared against the console's Sandbox and Production tabs.", False),
        ("Staging has no Square configuration at all. The project ksmreaadhbirzakkxqrq carries "
         "8 deployed Square functions and zero Square secrets, so every one of them is inert "
         "there. Giving staging real Square access needs its own webhook subscription and "
         "therefore its own signature key - the notification URL is part of the signed message, "
         "so production's key cannot be reused.", False),
    ]:
        b = doc.add_paragraph(style="List Bullet")
        plain(b, line, 8.5, bold=bold)

    # ---- health test -----------------------------------------------------
    doc.add_paragraph()
    p = doc.add_paragraph()
    r = p.add_run("Credential health test")
    r.font.size = Pt(11); r.font.bold = True

    p = doc.add_paragraph()
    mono(p, "node scripts/square-credential-health.mjs --env-file supabase/functions/.env", 8.5)

    p = doc.add_paragraph()
    plain(p,
          "Each credential is proved against Square's own API rather than against our "
          "expectations of it - a stale, revoked or wrong-environment secret is 'set' exactly "
          "as convincingly as a working one. ", 8.5)
    plain(p, "No secret is printed, logged or returned.", 8.5, bold=True)

    for line in [
        "App id + secret: ObtainToken with a deliberately invalid authorization code. A correct "
        "pair is refused for the CODE and Square echoes the app id back; a wrong id or secret is "
        "refused for the CLIENT with a bare service.not_authorized and no errors array. Both are "
        "HTTP 401, so the shape of the failure is the test. Nothing is created and no token issued.",
        "Webhook signature key: verified arithmetically, because Square never echoes the key. The "
        "check confirms it is usable HMAC key material and that the notification URL paired with "
        "it is https with no trailing slash - the two failure modes that silently drop every event.",
        "Redirect URI: format only, plus an explicit instruction to compare it by eye.",
        "Duplicate detection: if the sandbox and live signature keys are identical, the test fails "
        "loudly. That state means one environment's key is missing and the other is duplicated.",
    ]:
        b = doc.add_paragraph(style="List Bullet")
        plain(b, line, 8)

    p = doc.add_paragraph()
    plain(p, "Result on ", 8.5)
    plain(p, TODAY, 8.5, bold=True)
    plain(p, ":  ", 8.5)
    plain(p, "verified 4   failed 0   missing 0", 9, bold=True, colour="166534")

    p = doc.add_paragraph()
    plain(p,
          "One limit worth stating: Supabase stores edge-function secrets encrypted and does not "
          "return them, so a local run proves the VALUES ARE GOOD, not that the same values are "
          "the ones deployed. Compare the fingerprints above against a run in the deployed "
          "environment to close that gap.", 8, italic=True)

    # ---- cleanup ---------------------------------------------------------
    doc.add_paragraph()
    p = doc.add_paragraph()
    r = p.add_run("Recommended cleanup - nothing has been changed")
    r.font.size = Pt(11); r.font.bold = True

    t3 = doc.add_table(rows=1, cols=3)
    t3.style = "Table Grid"
    for i, name in enumerate(["Variable", "Action", "Reason"]):
        c = t3.rows[0].cells[i]
        shade(c, CLR_HEAD_BG)
        cell_p(c); plain(c.paragraphs[0], name, 7.5, bold=True, colour="334155")
    for name, action, why in CLEANUP:
        cells = t3.add_row().cells
        shade(cells[0], CLR_DEAD_BG)
        cell_p(cells[0]); mono(cells[0].paragraphs[0], name, 7.5, bold=True)
        cell_p(cells[1]); plain(cells[1].paragraphs[0], action, 7.5, bold=True, colour="9B1C1C")
        cell_p(cells[2]); plain(cells[2].paragraphs[0], why, 7.5)
    for r_ in t3.rows:
        for c, w in zip(r_.cells, [2.4, 0.9, 7.3]):
            c.width = Inches(w)

    p = doc.add_paragraph()
    plain(p,
          "Removing the three dead variables frees three slots. The project currently holds 106 "
          "secrets against a 100 user-secret cap, which is why a recent push was rejected outright.",
          8.5, bold=True)

    p = doc.add_paragraph()
    plain(p,
          "No credential has been rotated, revoked, modified, overwritten or deleted. Every action "
          "above is a recommendation awaiting approval.", 8.5, italic=True)

    out = "docs/square-integration/Drive247-Square-Secrets-Inventory.docx"
    doc.save(out)
    print("written:", out)


if __name__ == "__main__":
    build()
