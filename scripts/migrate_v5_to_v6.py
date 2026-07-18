"""Migrate dji_products_tagged_v5.csv -> dji_products_tagged_v6.csv.

Adds two new columns and rewrites one existing column with sharper,
more-curated values so the LLM-as-recipe-author workflow has a
vocabulary worth composing against:

    capabilities       (existing, REWRITTEN to top 3-5 differentiating tags)
    subtypes           (NEW, structured per-category subtype taxonomy)
    primary_activities (NEW, 0-3 activity tokens per SKU)

The migration is a one-shot, rule-based generator. Reproducible: edit
the family table or vocab lists below and re-run. Every SKU is matched
against the family table by title regex; unmatched SKUs end up with
empty subtypes/primary_activities and their original `capabilities`
preserved (so we never silently lose data — the spot-check script
reports them).

Run with:
    python3 scripts/migrate_v5_to_v6.py
"""

from __future__ import annotations

import ast
import csv
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Dict, List, Tuple

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SRC = DATA / "dji_products_tagged_v5.csv"
DST = DATA / "dji_products_tagged_v6.csv"


# ---------- Vocab (single source of truth) ----------

ALLOWED_SUBTYPES = {
    # cameras
    "cam_action", "cam_pocket", "cam_360", "cam_dual_screen", "cam_nano",
    # drones
    "drone_compact", "drone_cinema", "drone_fpv", "drone_selfie",
    "drone_racing", "drone_enterprise",
    # gimbals
    "gimbal_phone", "gimbal_camera", "gimbal_compact",
    # microphones
    "mic_wireless", "mic_lavalier", "mic_phone_adapter", "mic_transmitter",
    "mic_receiver", "mic_windscreen", "mic_charging_case", "mic_kit",
    # mounts
    "mount_helmet", "mount_handlebar", "mount_suction", "mount_chest",
    "mount_neck", "mount_wrist", "mount_tripod", "mount_clamp",
    "mount_magnetic", "mount_extension",
    # other accessories
    "acc_battery", "acc_charger", "acc_filter_nd", "acc_filter_cpl",
    "acc_filter_uv", "acc_lens_wide", "acc_lens_macro", "acc_propeller",
    "acc_case", "acc_strap", "acc_remote", "acc_landing_gear",
}

ALLOWED_ACTIVITIES = {
    "motorcycle", "cycling", "skiing_snowboarding", "surfing",
    "watersports", "hiking_outdoor", "travel", "vlog", "podcast",
    "interview", "livestream", "wedding", "real_estate_aerial",
    "news_journalism", "concert_event", "theatre", "indoor_sports",
    "family", "beginner_creator", "professional_filmmaker",
}

ALLOWED_CAPABILITIES = {
    # raw CSV vocab — kept for AND-intersection in recipes
    "vlogging", "rugged", "sports", "outdoor", "waterproof", "underwater",
    "cinematic", "professional", "beginner", "portable", "lightweight",
    "wind_resistant", "hands_free", "mounting", "navigation", "tracking",
    "low_light", "smooth_video", "light_control", "protection", "power",
    "storage", "battery_extension", "flight_support", "control", "travel",
    "intermediate",
}


# ---------- Two-pass detection ----------
#
# Pass A: ACCESSORY_RULES (mount, battery, filter, case…). If a SKU
#   matches an accessory rule, its SUBTYPE + CAPS come from there —
#   `acc_battery` instead of the host product's `drone_compact`. The
#   accessory inherits the host family's primary activities so that
#   e.g. a Mini 3 battery still surfaces under "travel" recipes.
#
# Pass B: FAMILY_RULES (Mavic, Mini, Action, Pocket, Mic 2…). If the
#   SKU isn't an accessory, we use the family's subtype + acts + caps
#   verbatim. If it IS an accessory, we ignore family.subtypes /
#   family.caps and only borrow family.activities.
#
# Order inside each list still matters (first match wins per pass).

ACCESSORY_RULES: List[Tuple[re.Pattern, str, List[str], List[str], List[str]]] = [
    # tuple: (regex, name, subtypes, accessory_activities, accessory_caps)
    # Activities here are UNIONED with the host family's activities so
    # that a Mini 3 battery picks up both `acc_battery` (subtype) AND
    # `travel/family/beginner_creator` (inherited Mini 3 activities).
    # Mounts that don't pair with a host family rely entirely on these.

    # ---------- Mounts (action camera mounts) ----------
    (re.compile(r"\bhelmet\b|\bmagnetic\s+headband\b", re.I), "Helmet mount",
        ["mount_helmet"],
        ["motorcycle", "cycling", "skiing_snowboarding"],
        ["mounting", "rugged", "sports"]),
    (re.compile(r"\bhandlebar\b", re.I), "Handlebar mount",
        ["mount_handlebar"],
        ["motorcycle", "cycling"],
        ["mounting", "rugged", "sports"]),
    (re.compile(r"\bsuction\s+cup\b", re.I), "Suction Cup mount",
        ["mount_suction"],
        ["motorcycle", "cycling", "watersports"],
        ["mounting", "rugged"]),
    (re.compile(r"\bchest\s+strap\b", re.I), "Chest mount",
        ["mount_chest"],
        ["motorcycle", "cycling", "skiing_snowboarding", "surfing"],
        ["mounting", "rugged", "sports"]),
    (re.compile(r"\bhanging\s+neck\s+mount\b", re.I), "Neck mount",
        ["mount_neck"],
        ["vlog", "hiking_outdoor", "travel"],
        ["mounting", "hands_free"]),
    (re.compile(r"\bwrist\s+strap\b", re.I), "Wrist mount",
        ["mount_wrist"],
        ["watersports", "skiing_snowboarding"],
        ["mounting", "sports"]),
    (re.compile(r"\bmagnetic\s+ball[- ]?joint\b", re.I), "Magnetic ball joint",
        ["mount_magnetic"],
        ["vlog", "livestream"],
        ["mounting"]),
    (re.compile(r"\bquick[- ]release\b", re.I), "Quick-release adapter",
        ["mount_extension"],
        [],
        ["mounting"]),
    (re.compile(r"\bheavy\s+duty\s+clamp\b|\bnato\s+clamp\b", re.I), "Clamp",
        ["mount_clamp"],
        [],
        ["mounting"]),
    (re.compile(r"\bphone\s+holder\b", re.I), "Phone holder",
        ["mount_clamp"],
        [],
        ["mounting"]),
    (re.compile(r"\bbike\s+accessory\s+kit\b|\broad\s+cycling\s+accessory\s+kit\b", re.I),
        "Cycling kit",
        ["mount_handlebar", "mount_helmet"],
        ["cycling", "motorcycle"],
        ["mounting", "sports"]),
    (re.compile(r"\bdiving\s+accessory\s+kit\b", re.I), "Diving kit",
        ["acc_case"],
        ["watersports", "surfing"],
        ["protection", "waterproof", "underwater"]),
    (re.compile(r"\bcage\b", re.I), "Cage",
        ["mount_clamp", "mount_extension"],
        ["professional_filmmaker"],
        ["mounting", "protection"]),
    (re.compile(r"\bcold\s+shoe\b", re.I), "Cold shoe",
        ["mount_extension"],
        [],
        ["mounting"]),
    (re.compile(r"\b1\.6m\s+tripod\b|\btripod\s+selfie\s+stick\b", re.I),
        "Tripod selfie stick",
        ["mount_tripod", "mount_extension"],
        ["vlog", "travel"],
        ["mounting", "portable"]),
    (re.compile(r"\bmini\s+tripod\b", re.I), "Mini tripod",
        ["mount_tripod"],
        ["vlog", "podcast"],
        ["mounting", "portable"]),
    (re.compile(r"\bextension\s+rod\b|\bselfie\s+stick\b", re.I),
        "Selfie stick / extension rod",
        ["mount_extension"],
        ["vlog", "travel"],
        ["mounting", "portable"]),
    (re.compile(r"\bdual[- ]direction.*adapter\s+mount\b|\badapter\s+mount\b|\bexpansion\s+adapter\b",
        re.I),
        "Adapter mount",
        ["mount_extension"],
        [],
        ["mounting"]),
    (re.compile(r"\bmonitor\s+mounting\s+support\b", re.I), "Monitor mounting support",
        ["mount_clamp", "mount_extension"],
        ["professional_filmmaker"],
        ["mounting"]),
    (re.compile(r"\bsling\s+handle\b", re.I), "Sling handle",
        ["acc_strap"],
        ["professional_filmmaker"],
        ["mounting"]),

    # ---------- Microphone-class accessories ----------
    # Phone adapter / windscreen come BEFORE the family pass so they
    # take their own subtype (mic_phone_adapter) but still inherit
    # the Mic 2/3/Mini family's activities.
    (re.compile(r"\bmic\s*3\s+mobile\s+phone\s+adapter\b", re.I),
        "Mic 3 Phone Adapter",
        ["mic_phone_adapter", "mic_wireless"],
        [],
        ["vlogging", "portable"]),
    (re.compile(r"\bmic\s*3?\s+multi[- ]color\s+windscreens?\b", re.I),
        "Mic Windscreens",
        ["mic_windscreen", "mic_wireless"],
        [],
        ["wind_resistant"]),

    # ---------- Power & charging ----------
    (re.compile(r"\bbattery\s+extension\s+rod\b", re.I), "Battery extension rod",
        ["acc_battery", "mount_extension"],
        [],
        ["power", "battery_extension"]),
    (re.compile(r"\b(intelligent\s+flight\s+battery|extreme\s+battery|battery\s+handle)\b",
        re.I),
        "Battery",
        ["acc_battery"],
        [],
        ["power", "battery_extension"]),
    (re.compile(r"\bbattery\s+case\b|\bmultifunctional\s+battery\b", re.I),
        "Battery case",
        ["acc_charger", "acc_case"],
        [],
        ["power", "storage", "protection"]),
    (re.compile(r"\bcharging\s+hub\b", re.I), "Charging hub",
        ["acc_charger"],
        [],
        ["power"]),

    # ---------- Drone-specific ----------
    (re.compile(r"\bpropeller\s+guard\b", re.I), "Propeller guard",
        ["acc_propeller"],
        [],
        ["protection"]),
    (re.compile(r"\bpropellers?\b", re.I), "Propeller",
        ["acc_propeller"],
        [],
        ["flight_support"]),
    (re.compile(r"\blanding\s+gear\b", re.I), "Landing gear",
        ["acc_landing_gear"],
        [],
        ["flight_support", "protection"]),
    (re.compile(r"\bdigital\s+transceiver\b", re.I), "Transceiver",
        ["acc_remote"],
        [],
        ["control"]),

    # ---------- Bags / strap / remote ----------
    (re.compile(r"\b(carrying\s+bag|shoulder\s+bag|safety\s+case|drone\s+mini\s+case|backpack|action\s+camera\s+case|fly\s+more\s+kit)\b",
        re.I),
        "Bag / case",
        ["acc_case"],
        ["travel"],
        ["storage", "protection"]),
    (re.compile(r"\b(backpack|shoulder)\s+strap\b", re.I), "Strap",
        ["acc_strap"],
        ["travel"],
        ["mounting"]),
    (re.compile(r"\bremote\s+controller\b", re.I), "Remote controller",
        ["acc_remote"],
        [],
        ["control"]),

    # ---------- Lens filters ----------
    (re.compile(r"\bnd[/\s-]*pl\b|\bnd[- ]?pl\b|\bpl\s+hybrid\b", re.I),
        "ND/PL filter",
        ["acc_filter_nd", "acc_filter_cpl"],
        [],
        ["light_control"]),
    (re.compile(r"\b(cpl|circular polarizer|polarizer)\b", re.I),
        "CPL filter",
        ["acc_filter_cpl"],
        [],
        ["light_control"]),
    (re.compile(r"\buv\s+filter\b", re.I), "UV filter",
        ["acc_filter_uv"],
        [],
        ["light_control", "protection"]),
    (re.compile(r"\bnd\s*\d|\bnd\s+filter|\bsplit\s+nd|\bvnd\b|\blong\s+exposure\b|\bgradient\s+filter\b|\bglow\s+mist\b|\bblack\s+(diffusion|mist)\b|\blight\s+poll\w*\b|\bnight\s+sky\b|\blpr\b",
        re.I),
        "ND filter / mist / lpr",
        ["acc_filter_nd"],
        [],
        ["light_control"]),
    (re.compile(r"\bfilter\s+kit\b|\bfilter\s+set\b", re.I),
        "Filter kit",
        ["acc_filter_nd"],
        [],
        ["light_control"]),
    (re.compile(r"\bwide[- ]?angle\s+lens\b", re.I), "Wide-angle lens",
        ["acc_lens_wide"],
        [],
        ["light_control"]),
    (re.compile(r"\b(glass\s+lens\s+cover|lens\s+protector|transparent\s+lens|lens\s+cover)\b",
        re.I),
        "Lens protector",
        ["acc_lens_macro"],
        [],
        ["protection"]),
]

FAMILY_RULES: List[Tuple[re.Pattern, str, List[str], List[str], List[str]]] = [
    # ---------- Action cameras ----------
    (re.compile(r"\bosmo\s+pocket\s*4\b", re.I), "Osmo Pocket 4",
        ["cam_pocket"],
        ["vlog", "travel", "interview", "livestream"],
        ["vlogging", "low_light", "hands_free", "portable"]),
    (re.compile(r"\bosmo\s+pocket\s*3\b", re.I), "Osmo Pocket 3",
        ["cam_pocket"],
        ["vlog", "travel", "interview", "livestream"],
        ["vlogging", "low_light", "hands_free", "portable"]),
    (re.compile(r"\bosmo\s*360\b", re.I), "Osmo 360",
        ["cam_360", "cam_action"],
        ["motorcycle", "travel", "real_estate_aerial", "skiing_snowboarding"],
        ["vlogging", "rugged", "wind_resistant", "hands_free"]),
    (re.compile(r"\bosmo\s+nano\s+action\b", re.I), "Osmo Nano Action",
        ["cam_nano", "cam_action"],
        ["vlog", "hiking_outdoor", "family", "travel"],
        ["vlogging", "portable", "hands_free", "beginner"]),
    (re.compile(r"\baction\s*2\s+dual[- ]screen\b", re.I), "Action 2 Dual-Screen",
        ["cam_action", "cam_dual_screen"],
        ["motorcycle", "cycling", "vlog"],
        ["rugged", "vlogging", "portable"]),
    (re.compile(r"\baction\s*2\b", re.I), "Action 2",
        ["cam_action"],
        ["motorcycle", "cycling", "vlog"],
        ["rugged", "vlogging", "portable"]),
    (re.compile(r"\bosmo\s+action\s*6\b", re.I), "Osmo Action 6",
        ["cam_action"],
        ["motorcycle", "cycling", "skiing_snowboarding", "surfing", "vlog"],
        ["rugged", "sports", "waterproof", "vlogging", "wind_resistant"]),
    (re.compile(r"\bosmo\s+action\s*5\s*pro\b", re.I), "Osmo Action 5 Pro",
        ["cam_action"],
        ["motorcycle", "cycling", "skiing_snowboarding", "surfing", "vlog"],
        ["rugged", "sports", "waterproof", "vlogging", "hands_free"]),
    (re.compile(r"\bosmo\s+action\s*4\b", re.I), "Osmo Action 4",
        ["cam_action"],
        ["motorcycle", "cycling", "skiing_snowboarding", "surfing"],
        ["rugged", "sports", "waterproof", "vlogging"]),
    (re.compile(r"\bosmo\s+action\s*3\b", re.I), "Osmo Action 3",
        ["cam_action"],
        ["motorcycle", "cycling", "skiing_snowboarding", "surfing"],
        ["rugged", "sports", "waterproof", "vlogging"]),

    # ---------- Drones ----------
    (re.compile(r"\bmavic\s*4\s*pro\b", re.I), "Mavic 4 Pro",
        ["drone_cinema"],
        ["professional_filmmaker", "real_estate_aerial", "wedding"],
        ["cinematic", "professional", "wind_resistant", "navigation"]),
    (re.compile(r"\bmavic\s*3\s*pro\b", re.I), "Mavic 3 Pro",
        ["drone_cinema"],
        ["professional_filmmaker", "real_estate_aerial", "wedding"],
        ["cinematic", "professional", "wind_resistant"]),
    (re.compile(r"\bmavic\s*3\b", re.I), "Mavic 3",
        ["drone_cinema"],
        ["professional_filmmaker", "real_estate_aerial", "wedding"],
        ["cinematic", "professional", "wind_resistant"]),
    (re.compile(r"\bavata\s+pro[- ]view\b", re.I), "Avata Pro-View",
        ["drone_fpv"],
        ["professional_filmmaker", "indoor_sports", "livestream"],
        ["cinematic", "professional", "sports"]),
    (re.compile(r"\bavata\s*360\b", re.I), "Avata 360",
        ["drone_fpv"],
        ["professional_filmmaker", "indoor_sports", "real_estate_aerial"],
        ["cinematic", "professional", "wind_resistant"]),
    (re.compile(r"\bavata\s*2?\b", re.I), "Avata / Avata 2",
        ["drone_fpv"],
        ["professional_filmmaker", "indoor_sports", "livestream"],
        ["cinematic", "professional", "sports"]),
    (re.compile(r"\bair\s*3s\b", re.I), "Air 3S",
        ["drone_compact"],
        ["travel", "beginner_creator", "real_estate_aerial"],
        ["portable", "lightweight", "cinematic"]),
    (re.compile(r"\bmini\s*5\s*pro\b", re.I), "Mini 5 Pro",
        ["drone_compact"],
        ["travel", "family", "beginner_creator", "hiking_outdoor"],
        ["portable", "lightweight", "beginner", "tracking"]),
    (re.compile(r"\bmini\s*4k\b", re.I), "Mini 4K",
        ["drone_compact"],
        ["travel", "family", "beginner_creator"],
        ["portable", "lightweight", "beginner"]),
    (re.compile(r"\bmini\s*3\b", re.I), "Mini 3",
        ["drone_compact"],
        ["travel", "family", "beginner_creator"],
        ["portable", "lightweight", "beginner", "tracking"]),
    (re.compile(r"\bmini\s*2\b", re.I), "Mini 2",
        ["drone_compact"],
        ["travel", "family", "beginner_creator"],
        ["portable", "lightweight", "beginner"]),
    (re.compile(r"\blito\s*x?\s*1\b", re.I), "Lito",
        ["drone_compact"],
        ["beginner_creator", "family"],
        ["portable", "lightweight", "beginner"]),
    (re.compile(r"\bflip\b", re.I), "Flip",
        ["drone_compact"],
        ["travel", "family", "beginner_creator"],
        ["portable", "beginner", "tracking"]),
    (re.compile(r"\bneo\s*2\b", re.I), "Neo 2",
        ["drone_selfie"],
        ["vlog", "family", "indoor_sports", "beginner_creator"],
        ["portable", "lightweight", "beginner", "tracking", "vlogging"]),
    (re.compile(r"\bneo\b", re.I), "Neo",
        ["drone_selfie"],
        ["vlog", "family", "indoor_sports", "beginner_creator"],
        ["portable", "lightweight", "beginner", "vlogging"]),

    # ---------- Gimbals ----------
    (re.compile(r"\bosmo\s+mobile\s*7p\b", re.I), "Osmo Mobile 7P",
        ["gimbal_phone", "gimbal_compact"],
        ["vlog", "family", "beginner_creator"],
        ["vlogging", "portable", "beginner", "tracking"]),
    (re.compile(r"\bosmo\s+mobile\s*7\b", re.I), "Osmo Mobile 7",
        ["gimbal_phone", "gimbal_compact"],
        ["vlog", "family", "beginner_creator"],
        ["vlogging", "portable", "beginner", "tracking"]),
    (re.compile(r"\bosmo\s+mobile\s*8\b", re.I), "Osmo Mobile 8",
        ["gimbal_phone", "gimbal_compact"],
        ["vlog", "family", "beginner_creator"],
        ["vlogging", "portable", "beginner", "tracking"]),
    (re.compile(r"\bosmo\s+mobile\s*se\b", re.I), "Osmo Mobile SE",
        ["gimbal_phone", "gimbal_compact"],
        ["vlog", "family", "beginner_creator"],
        ["vlogging", "portable", "beginner"]),
    (re.compile(r"\brs\s*4\s*mini\b", re.I), "RS 4 Mini",
        ["gimbal_camera", "gimbal_compact"],
        ["vlog", "wedding", "professional_filmmaker"],
        ["cinematic", "portable", "professional"]),
    (re.compile(r"\brs\s*5\b", re.I), "RS 5",
        ["gimbal_camera"],
        ["professional_filmmaker", "wedding"],
        ["cinematic", "professional"]),
    (re.compile(r"\brs\s*4\s*pro\b", re.I), "RS 4 Pro",
        ["gimbal_camera"],
        ["professional_filmmaker", "wedding"],
        ["cinematic", "professional"]),
    (re.compile(r"\brs\s*4\b", re.I), "RS 4",
        ["gimbal_camera"],
        ["professional_filmmaker", "wedding"],
        ["cinematic", "professional"]),
    # ---------- Microphones ----------
    (re.compile(r"\blavalier\s+mic\b", re.I), "Lavalier Mic",
        ["mic_lavalier", "mic_wireless"],
        ["interview", "vlog", "livestream", "news_journalism"],
        ["vlogging", "hands_free", "portable"]),
    (re.compile(r"\bmic\s*3\s+receiver\b", re.I), "Mic 3 Receiver",
        ["mic_receiver", "mic_wireless"],
        ["vlog", "podcast"],
        ["vlogging"]),
    (re.compile(r"\bmic\s*3\s+transmitter\b", re.I), "Mic 3 Transmitter",
        ["mic_transmitter", "mic_wireless"],
        ["vlog", "podcast"],
        ["vlogging"]),
    (re.compile(r"\bmic\s*3\b", re.I), "Mic 3",
        ["mic_wireless"],
        ["vlog", "podcast", "interview", "livestream"],
        ["vlogging", "hands_free", "portable"]),
    (re.compile(r"\bmic\s*2\s+transmitter\b", re.I), "Mic 2 Transmitter",
        ["mic_transmitter", "mic_wireless"],
        ["vlog", "podcast"],
        ["vlogging"]),
    (re.compile(r"\bmic\s*2\b", re.I), "Mic 2",
        ["mic_wireless"],
        ["vlog", "podcast", "interview", "livestream"],
        ["vlogging", "hands_free", "portable"]),
    (re.compile(r"\bmic\s+mini\b", re.I), "Mic Mini",
        ["mic_wireless"],
        ["vlog", "podcast", "interview"],
        ["vlogging", "hands_free", "portable"]),

    # ---------- Robot vacuums (no recipe applicability) ----------
    (re.compile(r"\bromo\b", re.I), "Romo robotic vacuum", [], [], []),
]


# ---------- Helpers ----------

def parse_list_literal(raw: str) -> List[str]:
    """Parse the Python-list-literal `capabilities` column.

    Tolerant of stray whitespace / mixed quoting. Returns a list of
    lowercased tokens.
    """
    raw = (raw or "").strip()
    if not raw:
        return []
    try:
        v = ast.literal_eval(raw)
        if isinstance(v, list):
            return [str(x).strip().lower() for x in v if str(x).strip()]
    except Exception:
        pass
    cleaned = raw.strip("[]")
    return [t.strip().strip("'\"").lower() for t in cleaned.split(",") if t.strip()]


def format_list_literal(values: List[str]) -> str:
    """Write tokens back as a Python-list-literal so existing parsers stay happy."""
    if not values:
        return "[]"
    seen = []
    for v in values:
        if v not in seen:
            seen.append(v)
    inner = ", ".join(f"'{v}'" for v in seen)
    return f"[{inner}]"


# =============================================================
# `compatible_with_models` inference
#
# In v5/v6 only ~146/459 SKUs have curated compat data (third-party
# accessories from Freewell/SmallRig/PGYTech). The rest — DJI's own
# accessories, drone accessories, kits — leave the column empty even
# though their title clearly names a host model. We infer compat
# from the title via the same family table we use for subtypes /
# activities. Flagship products list themselves so the column is
# never-empty for primary SKUs.
#
# Each entry maps a title regex to the canonical model strings it
# implies. "Mini 3 Series" → both Mini 3 and Mini 3 Pro because the
# accessory is shared across the family. ORDER MATTERS — more
# specific patterns first so e.g. "Mini 5 Pro" wins over "Mini".
# =============================================================

COMPAT_INFERENCE_PATTERNS: List[Tuple[re.Pattern, List[str]]] = [
    # Drones — Mavic family
    (re.compile(r"\bmavic\s*4\s*pro\b", re.I), ["DJI Mavic 4 Pro"]),
    (re.compile(r"\bmavic\s*3\s*pro\b", re.I), ["DJI Mavic 3 Pro"]),
    (re.compile(r"\bmavic\s*3\b", re.I), ["DJI Mavic 3"]),
    (re.compile(r"\bmavic\s*air\s*2\b", re.I), ["DJI Mavic Air 2"]),
    # Drones — Mini family. "Mini 3 Series" → covers Mini 3 + Mini 3 Pro.
    (re.compile(r"\bmini\s*5\s*pro\b", re.I), ["DJI Mini 5 Pro"]),
    (re.compile(r"\bmini\s*4\s*pro\b", re.I), ["DJI Mini 4 Pro"]),
    (re.compile(r"\bmini\s*4k\b", re.I), ["DJI Mini 4K"]),
    (re.compile(r"\bmini\s*3\s*series\b", re.I), ["DJI Mini 3", "DJI Mini 3 Pro"]),
    (re.compile(r"\bmini\s*3\b", re.I), ["DJI Mini 3"]),
    (re.compile(r"\bmini\s*2\s*se\b", re.I), ["DJI Mini 2 SE"]),
    (re.compile(r"\bmini\s*2\b", re.I), ["DJI Mini 2"]),
    (re.compile(r"\bmini\s*se\b", re.I), ["DJI Mini SE"]),
    # Drones — Avata / Air / Neo / Flip / Lito
    (re.compile(r"\bavata\s*360\b", re.I), ["DJI Avata 360"]),
    (re.compile(r"\bavata\s*2\b", re.I), ["DJI Avata 2"]),
    (re.compile(r"\bavata\b", re.I), ["DJI Avata"]),
    (re.compile(r"\bair\s*3s\b", re.I), ["DJI Air 3S"]),
    (re.compile(r"\bair\s*2s\b", re.I), ["DJI Air 2S"]),
    (re.compile(r"\bneo\s*2\b", re.I), ["DJI Neo 2"]),
    (re.compile(r"\bneo\b", re.I), ["DJI Neo"]),
    (re.compile(r"\bflip\b", re.I), ["DJI Flip"]),
    (re.compile(r"\blito\s*x?\s*1\b", re.I), ["DJI Lito X1"]),
    # Action cameras
    (re.compile(r"\bosmo\s*action\s*6\b", re.I), ["DJI Osmo Action 6"]),
    (re.compile(r"\bosmo\s*action\s*5\s*pro\b", re.I), ["DJI Osmo Action 5 Pro"]),
    (re.compile(r"\baction\s*5\s*pro\b", re.I), ["DJI Osmo Action 5 Pro"]),
    # "Action 4/5 Pro" or "Action 4 and 5" → both models
    (re.compile(r"\baction\s*4\s*[/&-]\s*5\s*pro\b", re.I),
        ["DJI Osmo Action 4", "DJI Osmo Action 5 Pro"]),
    (re.compile(r"\baction\s*4\s+and\s*5\b", re.I),
        ["DJI Osmo Action 4", "DJI Osmo Action 5 Pro"]),
    (re.compile(r"\bosmo\s*action\s*4\b", re.I), ["DJI Osmo Action 4"]),
    (re.compile(r"\baction\s*4\b", re.I), ["DJI Osmo Action 4"]),
    (re.compile(r"\bosmo\s*action\s*3\b", re.I), ["DJI Osmo Action 3"]),
    (re.compile(r"\baction\s*3\b", re.I), ["DJI Osmo Action 3"]),
    (re.compile(r"\bosmo\s*nano\b", re.I), ["DJI Osmo Nano Action"]),
    (re.compile(r"\bosmo\s*360\b", re.I), ["DJI Osmo 360"]),
    (re.compile(r"\baction\s*2\b", re.I), ["DJI Action 2"]),
    # Pockets
    (re.compile(r"\bosmo\s*pocket\s*4\b", re.I), ["DJI Osmo Pocket 4"]),
    (re.compile(r"\bpocket\s*4\b", re.I), ["DJI Osmo Pocket 4"]),
    (re.compile(r"\bosmo\s*pocket\s*3\b", re.I), ["DJI Osmo Pocket 3"]),
    (re.compile(r"\bpocket\s*3\b", re.I), ["DJI Osmo Pocket 3"]),
    # Gimbals
    (re.compile(r"\brs\s*5\b", re.I), ["DJI RS 5"]),
    (re.compile(r"\brs\s*4\s*pro\b", re.I), ["DJI RS 4 Pro"]),
    (re.compile(r"\brs\s*4\s*mini\b", re.I), ["DJI RS 4 Mini"]),
    (re.compile(r"\brs\s*4\b", re.I), ["DJI RS 4"]),
    # "RS 2 / RSC 2 / RS 3 / RS 3 Pro / RS 3 mini" — split into a series
    (re.compile(r"\brsc\s*2\b", re.I), ["DJI RSC 2"]),
    (re.compile(r"\brs\s*3\s*pro\b", re.I), ["DJI RS 3 Pro"]),
    (re.compile(r"\brs\s*3\s*mini\b", re.I), ["DJI RS 3 Mini"]),
    (re.compile(r"\brs\s*3\b", re.I), ["DJI RS 3"]),
    (re.compile(r"\brs\s*2\b", re.I), ["DJI RS 2"]),
    (re.compile(r"\bosmo\s*mobile\s*8\b", re.I), ["DJI Osmo Mobile 8"]),
    (re.compile(r"\bosmo\s*mobile\s*7p\b", re.I), ["DJI Osmo Mobile 7P"]),
    (re.compile(r"\bosmo\s*mobile\s*7\b", re.I), ["DJI Osmo Mobile 7"]),
    (re.compile(r"\bosmo\s*mobile\s*se\b", re.I), ["DJI Osmo Mobile SE"]),
    # Mics
    (re.compile(r"\bmic\s*3\b", re.I), ["DJI Mic 3"]),
    (re.compile(r"\bmic\s*2\b", re.I), ["DJI Mic 2"]),
    (re.compile(r"\bmic\s*mini\b", re.I), ["DJI Mic Mini"]),
    (re.compile(r"\blavalier\s*mic\b", re.I), ["DJI Lavalier Mic"]),
]


# Family-level fallback: when a title mentions a product LINE without
# specifying a model (e.g. "DJI Osmo Action Helmet Chin Mount" — works
# with every Osmo Action camera), expand to the full family roster so
# queries like "Helmet mount for Osmo Action 5 Pro" resolve through
# the compatibility filter rather than emptying the row.
COMPAT_FAMILY_FALLBACKS: List[Tuple[re.Pattern, List[str]]] = [
    (
        re.compile(r"\bosmo\s*action\b", re.I),
        [
            "DJI Osmo Action 3",
            "DJI Osmo Action 4",
            "DJI Osmo Action 5 Pro",
            "DJI Osmo Action 6",
            "DJI Action 2",
            "DJI Osmo Nano Action",
        ],
    ),
    (
        re.compile(r"\bosmo\s*mobile\b", re.I),
        [
            "DJI Osmo Mobile 7",
            "DJI Osmo Mobile 7P",
            "DJI Osmo Mobile 8",
            "DJI Osmo Mobile SE",
        ],
    ),
    (
        re.compile(r"\brs\s*gimbals?\b", re.I),
        ["DJI RS 4 Mini", "DJI RS 4", "DJI RS 4 Pro", "DJI RS 5"],
    ),
    (
        re.compile(r"\baction\s*camera\b", re.I),
        [
            "DJI Osmo Action 3",
            "DJI Osmo Action 4",
            "DJI Osmo Action 5 Pro",
            "DJI Osmo Action 6",
            "DJI Action 2",
            "DJI Osmo Nano Action",
        ],
    ),
]


def infer_compatible_models(title: str) -> List[str]:
    """Scan a SKU title for host-model references and return the
    canonical model strings it implies. Used to fill empty
    `compatible_with_models` cells without overwriting curated data.
    Falls back to family-level expansion when the title names a line
    (e.g. "Osmo Action") without a specific model number — generic
    mounts, straps, kits."""
    found: List[str] = []
    for pattern, models in COMPAT_INFERENCE_PATTERNS:
        if not pattern.search(title):
            continue
        for m in models:
            if m not in found:
                found.append(m)
    if found:
        return found
    # No specific model matched — fall back to family expansion so
    # generic line accessories aren't left empty.
    for pattern, models in COMPAT_FAMILY_FALLBACKS:
        if pattern.search(title):
            for m in models:
                if m not in found:
                    found.append(m)
            break
    return found


def detect_accessory(title: str) -> Tuple[List[str], List[str], List[str], str]:
    """Pass A: detect an accessory class. Returns (subtypes, activities, caps, name)."""
    for pattern, name, subs, acts, caps in ACCESSORY_RULES:
        if pattern.search(title):
            return list(subs), list(acts), list(caps), name
    return [], [], [], ""


def detect_family(title: str) -> Tuple[List[str], List[str], List[str], str]:
    """Pass B: detect the host product family. Returns (subtypes, activities, caps, name)."""
    for pattern, name, subs, acts, caps in FAMILY_RULES:
        if pattern.search(title):
            return list(subs), list(acts), list(caps), name
    return [], [], [], ""


def merge_two_pass(
    acc_subs: List[str], acc_acts: List[str], acc_caps: List[str],
    fam_subs: List[str], fam_acts: List[str], fam_caps: List[str],
) -> Tuple[List[str], List[str], List[str]]:
    """
    Combine two-pass output.

    - If accessory matched: subtype = accessory's; caps = accessory's;
      activities = UNION(accessory_acts, family_acts) so a helmet
      mount picks up `motorcycle/cycling` (its own) and a Mini-3
      battery picks up `travel/family/beginner_creator` (host).
    - If only family matched: subtype/acts/caps all from family.
    - If neither: empty (caller falls back to category defaults).
    """
    if acc_subs:
        merged_acts = list(acc_acts)
        for a in fam_acts:
            if a not in merged_acts:
                merged_acts.append(a)
        return acc_subs, merged_acts, acc_caps
    return fam_subs, fam_acts, fam_caps


def category_default_subtypes(category: str, title: str) -> List[str]:
    """Catch-all subtype hints for SKUs that didn't hit a family rule.

    Lets us fill in the long-tail of accessories without enumerating
    every single SKU in the family table. Each rule is OR-ed onto the
    family-detected subtypes (so families always win).
    """
    cat = (category or "").lower()
    title_l = (title or "").lower()
    out: List[str] = []
    if "lens filter" in cat:
        if "uv" in title_l: out.append("acc_filter_uv")
        if "cpl" in title_l or "polarizer" in title_l: out.append("acc_filter_cpl")
        if not out: out.append("acc_filter_nd")
    elif "case" in cat or "bag" in cat or "backpack" in cat:
        out.append("acc_case")
    elif "strap" in cat:
        out.append("acc_strap")
    elif "tripod" in cat or "monopod" in cat:
        out.append("mount_tripod")
    elif "wide-angle lens" in cat:
        out.append("acc_lens_wide")
    elif "remote" in cat:
        out.append("acc_remote")
    elif "battery" in cat:
        out.append("acc_battery")
    elif "charger" in cat:
        out.append("acc_charger")
    elif "adaptor" in cat or "adapter" in cat:
        out.append("mount_extension")
    elif "grip" in cat or "stick" in cat:
        out.append("mount_extension")
    elif "phone accessor" in cat:
        out.append("mount_clamp")
    elif "mount" in cat:
        # Action camera mounts that didn't hit a specific helmet/handlebar
        # rule — fall back to a generic extension marker so the row at
        # least has SOMETHING.
        out.append("mount_extension")
    return out


def tighten_capabilities(detected: List[str], original: List[str]) -> List[str]:
    """Apply the cap whitelist + cap at 5 tokens.

    If the family rule already supplied caps, use those verbatim
    (already curated). Otherwise filter the original CSV caps through
    `ALLOWED_CAPABILITIES` and trim the lowest-information ones.
    """
    if detected:
        seen = []
        for tag in detected:
            t = tag.strip().lower()
            if t in ALLOWED_CAPABILITIES and t not in seen:
                seen.append(t)
        return seen[:5]

    keep_priority = [
        "vlogging", "rugged", "sports", "waterproof", "underwater",
        "cinematic", "professional", "beginner",
        "portable", "lightweight", "wind_resistant", "tracking",
        "low_light", "hands_free", "outdoor", "navigation", "control",
        "smooth_video", "light_control", "mounting", "protection",
        "power", "storage", "battery_extension", "flight_support",
        "travel", "intermediate",
    ]
    seen = []
    for tag in original:
        t = tag.strip().lower()
        if t in ALLOWED_CAPABILITIES and t not in seen:
            seen.append(t)
    seen.sort(key=lambda t: keep_priority.index(t) if t in keep_priority else 99)
    return seen[:5]


def validate_tokens(tokens: List[str], allowed: set, label: str, title: str) -> List[str]:
    out = []
    for t in tokens:
        if t in allowed:
            out.append(t)
        else:
            print(f"  [warn] {label} token '{t}' not in vocab (sku: {title!r})", file=sys.stderr)
    return out


def main() -> int:
    if not SRC.exists():
        print(f"ERROR: {SRC} not found", file=sys.stderr)
        return 1

    with SRC.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    # Insert the new columns next to `capabilities` for readability
    # in spreadsheet tools. If they already exist (idempotent re-run)
    # we leave the column order alone.
    if "subtypes" not in fieldnames:
        idx = fieldnames.index("capabilities") + 1 if "capabilities" in fieldnames else len(fieldnames)
        fieldnames.insert(idx, "subtypes")
    if "primary_activities" not in fieldnames:
        idx = fieldnames.index("subtypes") + 1
        fieldnames.insert(idx, "primary_activities")

    family_hits = Counter()
    no_family = []

    for row in rows:
        title = (row.get("Product_title") or "").strip()
        if not title:
            row["subtypes"] = "[]"
            row["primary_activities"] = "[]"
            continue

        category = (row.get("Category") or "").strip()
        original_caps = parse_list_literal(row.get("capabilities", ""))

        acc_subs, acc_acts, acc_caps, acc_name = detect_accessory(title)
        fam_subs, fam_acts, fam_caps, family_name = detect_family(title)
        subs, acts, caps = merge_two_pass(
            acc_subs, acc_acts, acc_caps, fam_subs, fam_acts, fam_caps,
        )

        # Family hits track which product line the SKU belongs to,
        # regardless of whether it's the flagship or an accessory.
        if family_name:
            family_hits[family_name] += 1
        elif acc_name:
            family_hits[f"(accessory) {acc_name}"] += 1
        else:
            no_family.append((category, title))

        # Fold in category-default subtypes for long-tail accessories
        for s in category_default_subtypes(category, title):
            if s not in subs:
                subs.append(s)

        # Validate against vocab
        subs = validate_tokens(subs, ALLOWED_SUBTYPES, "subtype", title)
        acts = validate_tokens(acts, ALLOWED_ACTIVITIES, "activity", title)
        caps_final = tighten_capabilities(caps, original_caps)

        row["subtypes"] = format_list_literal(subs)
        row["primary_activities"] = format_list_literal(acts)
        row["capabilities"] = format_list_literal(caps_final)

        # Fill `compatible_with_models` only when empty — preserves
        # the 146 SKUs already curated by the data team.
        existing_compat = (row.get("compatible_with_models") or "").strip()
        if existing_compat in ("", "[]"):
            inferred = infer_compatible_models(title)
            if inferred:
                row["compatible_with_models"] = format_list_literal(inferred)

    with DST.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            # DictWriter complains about extra keys; restrict.
            writer.writerow({k: row.get(k, "") for k in fieldnames})

    print(f"Wrote {DST.name} ({len(rows)} rows)")
    print(f"\nTop families matched ({len(family_hits)} distinct):")
    for name, n in family_hits.most_common(20):
        print(f"  {n:>3}  {name}")

    if no_family:
        print(f"\n{len(no_family)} SKUs without a family rule:")
        for cat, title in no_family[:30]:
            print(f"  [{cat}]  {title}")
        if len(no_family) > 30:
            print(f"  ... and {len(no_family) - 30} more")

    return 0


if __name__ == "__main__":
    sys.exit(main())
