#!/usr/bin/env python3
"""Backfill the `In_The_Box` column for SKUs whose value is empty.

The original `scrape_in_the_box.py` pulled from JB Hi-Fi PDPs which had a
~34% gap (stub listings, delisted SKUs, brand-new releases). This script
applies a curated lookup table sourced from manufacturer documentation
(DJI Store / Freewell / PGYTech / SmallRig product pages) so the
PDP FAQ "What's in the box?" answer always has real data.

Behaviour:
    - Reads `data/dji_products_tagged_v6.csv` (relative to repo root).
    - For each row whose `In_The_Box` is blank, looks up the title in
      LOOKUP and writes the value back. Existing non-empty values are
      left untouched.
    - Writes a backup alongside the source CSV (`*.csv.bak`) first.
    - Reports rows updated and rows still empty (titles missing from
      the lookup) so we can extend the table iteratively.

Item delimiter is ` | ` to match the loader in
`src/catalog/catalog.ts` (parseInTheBox).
"""
from __future__ import annotations

import csv
import shutil
import sys
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parent.parent / "data" / "dji_products_tagged_v6.csv"
BACKUP_PATH = CSV_PATH.with_suffix(".csv.bak")

# ---------------------------------------------------------------------------
# Curated lookup. Keys are exact `Product_title` values from the v6 CSV.
# Values are the full `In_The_Box` strings, items joined by ` | `.
# Sources: dji.com store PDPs, Freewell store, PGYTech store, SmallRig store.
# ---------------------------------------------------------------------------
LOOKUP: dict[str, str] = {
    # ===== DJI Neo 2 family =====
    "DJI Neo 2 4K Drone": (
        "1 x DJI Neo 2 Aircraft | 1 x DJI Neo 2 Intelligent Flight Battery | "
        "1 x DJI Neo 2 Propeller Guard (Pair) | "
        "2 x DJI Neo 2 Spare Propellers (Pair) | "
        "4 x DJI Neo 2 Spare Propeller Screw | 1 x Screwdriver | "
        "1 x DJI Neo 2 Gimbal Protector | 1 x Type-C to Type-C PD Cable | "
        "1 x Documents (Quick Start Guide, Safety Guidelines, and DJI Logo Stickers)"
    ),
    "DJI Neo 2 4K Drone Fly More Combo": (
        "1 x DJI Neo 2 Aircraft | 1 x DJI RC-N3 Remote Controller | "
        "1 x DJI RC-N3 RC Cable (USB-C Connector) | "
        "3 x DJI Neo 2 Intelligent Flight Battery | "
        "1 x DJI Neo 2 Two-Way Charging Hub | "
        "1 x DJI Neo 2 Propeller Guard (Pair) | "
        "2 x DJI Neo 2 Spare Propellers (Pair) | "
        "4 x DJI Neo 2 Spare Propeller Screw | 1 x Screwdriver | "
        "1 x DJI Neo 2 Gimbal Protector | 1 x Type-C to Type-C PD Cable | "
        "1 x Shoulder Bag | 1 x Documents"
    ),
    "DJI Neo 2 4K Drone Fly More Combo (Drone Only)": (
        "1 x DJI Neo 2 Aircraft | 3 x DJI Neo 2 Intelligent Flight Battery | "
        "1 x DJI Neo 2 Two-Way Charging Hub | "
        "1 x DJI Neo 2 Propeller Guard (Pair) | "
        "2 x DJI Neo 2 Spare Propellers (Pair) | "
        "4 x DJI Neo 2 Spare Propeller Screw | 1 x Screwdriver | "
        "1 x DJI Neo 2 Gimbal Protector | 1 x Type-C to Type-C PD Cable | "
        "1 x Shoulder Bag | 1 x Documents"
    ),
    "DJI Neo 2 Motion 4K Drone Fly More Combo": (
        "1 x DJI Neo 2 Aircraft | 1 x DJI Goggles N3 | 1 x DJI RC Motion 3 | "
        "3 x DJI Neo 2 Intelligent Flight Battery | "
        "1 x DJI Neo 2 Two-Way Charging Hub | "
        "1 x DJI Neo 2 Propeller Guard (Pair) | "
        "2 x DJI Neo 2 Spare Propellers (Pair) | "
        "4 x DJI Neo 2 Spare Propeller Screw | 1 x Screwdriver | "
        "1 x DJI Neo 2 Gimbal Protector | 1 x Type-C to Type-C PD Cable | "
        "1 x DJI RC Motion 3 Lanyard | 1 x Shoulder Bag | 1 x Documents"
    ),
    "DJI Neo 2 Intelligent Flight Battery": (
        "1 x DJI Neo 2 Intelligent Flight Battery"
    ),
    "DJI Neo 2 Propellers": (
        "4 x DJI Neo 2 Propellers | 8 x DJI Neo 2 Propeller Screw | "
        "1 x Screwdriver"
    ),
    "DJI Neo 2 Two-Way Charging Hub": "1 x DJI Neo 2 Two-Way Charging Hub",
    "DJI Neo 2 Digital Transceiver": (
        "1 x DJI Neo 2 Digital Transceiver | 1 x USB-C Cable | 1 x Documents"
    ),

    # ===== DJI Mini 5 Pro family =====
    "DJI Mini 5 Pro Drone": (
        "1 x DJI Mini 5 Pro Aircraft | 1 x DJI RC-N3 Remote Controller | "
        "1 x DJI RC-N3 RC Cable (USB-C Connector) | "
        "1 x DJI Mini 5 Pro Intelligent Flight Battery | "
        "3 x DJI Mini 5 Pro Spare Propellers (Pair) | "
        "12 x Spare Propeller Screws | 1 x Screwdriver | "
        "1 x Gimbal Protector | 1 x Type-C to Type-C PD Cable | 1 x Documents"
    ),
    "DJI Mini 5 Pro Drone Fly More Combo (DJI RC2)": (
        "1 x DJI Mini 5 Pro Aircraft | 1 x DJI RC2 Remote Controller | "
        "3 x DJI Mini 5 Pro Intelligent Flight Battery | "
        "1 x DJI Mini 5 Pro Two-Way Charging Hub | "
        "3 x DJI Mini 5 Pro Spare Propellers (Pair) | "
        "12 x Spare Propeller Screws | 1 x Screwdriver | "
        "1 x Gimbal Protector | 1 x Type-C to Type-C PD Cable | "
        "1 x Shoulder Bag | 1 x Documents"
    ),
    "DJI Mini 5 Pro Intelligent Flight Battery": (
        "1 x DJI Mini 5 Pro Intelligent Flight Battery"
    ),
    "DJI Mini 5 Pro Intelligent Flight Battery Plus": (
        "1 x DJI Mini 5 Pro Intelligent Flight Battery Plus"
    ),
    "DJI Mini 5 Pro Two-Way Charging Hub": (
        "1 x DJI Mini 5 Pro Two-Way Charging Hub"
    ),
    "DJI Mini 5 Pro Propeller (Pair)": (
        "1 x DJI Mini 5 Pro Propellers (Pair)"
    ),
    "DJI Mini 5 Pro ND Filter Set (ND8/32/128)": (
        "1 x ND8 Filter | 1 x ND32 Filter | 1 x ND128 Filter | "
        "1 x Filter Case"
    ),

    # ===== DJI Avata family =====
    "DJI Avata Pro-View Combo FPV Drone": (
        "1 x DJI Avata Aircraft | 1 x DJI Goggles 2 | "
        "1 x DJI Motion Controller | 1 x DJI Avata Intelligent Flight Battery | "
        "1 x DJI Avata Propeller Guard | 1 x DJI Avata Top Cover | "
        "4 x DJI Avata Spare Propellers (Pair) | "
        "1 x DJI Avata Goggles Power Cable (USB-C) | "
        "1 x DJI Avata Goggles Headband | "
        "1 x DJI Avata Goggles Antennas (Pair) | "
        "1 x DJI Avata Goggles Battery | 1 x Documents"
    ),
    "DJI Avata 2 Intelligent Flight Battery": (
        "1 x DJI Avata 2 Intelligent Flight Battery"
    ),
    "DJI Avata 2 Propellers": (
        "4 x DJI Avata 2 Propellers | 16 x DJI Avata 2 Propeller Screw | "
        "1 x Screwdriver"
    ),

    # ===== DJI Flip / Mini 2 batteries =====
    "DJI Flip Intelligent Flight Battery": (
        "1 x DJI Flip Intelligent Flight Battery"
    ),
    "DJI Intelligent Flight Battery for Mini 2 + Mini 2 SE": (
        "1 x DJI Mini 2 / Mini 2 SE Intelligent Flight Battery"
    ),

    # ===== DJI Osmo Action 3 / 4 / 6 combos =====
    "DJI Osmo Action 3 Adventure Combo": (
        "1 x DJI Osmo Action 3 Camera | 3 x Osmo Action 3 Extreme Battery | "
        "1 x Osmo Action 3 Multifunctional Battery Case | "
        "1 x Osmo Action 3 Quick-Release Adapter Mount | "
        "1 x Osmo Action 3 Adhesive Base (Curved) | "
        "1 x Osmo Action 3 Anti-Slip Pad for Adhesive Base | "
        "1 x Osmo Action 1.5m Extension Rod | 1 x Osmo Action Locking Screw | "
        "1 x Type-C to Type-C PD Cable"
    ),
    "DJI Osmo Action 4 Standard Combo": (
        "1 x DJI Osmo Action 4 Camera | 1 x Osmo Action 4 Extreme Battery | "
        "1 x Osmo Action Quick-Release Adapter Mount | "
        "1 x Osmo Action Adhesive Base (Curved) | "
        "1 x Osmo Action Anti-Slip Pad for Adhesive Base | "
        "1 x Osmo Action Locking Screw | 1 x Type-C to Type-C PD Cable"
    ),
    "DJI Osmo Action 4 Adventure Combo": (
        "1 x DJI Osmo Action 4 Camera | 3 x Osmo Action 4 Extreme Battery | "
        "1 x Osmo Action Multifunctional Battery Case | "
        "1 x Osmo Action Quick-Release Adapter Mount | "
        "1 x Osmo Action Adhesive Base (Curved) | "
        "1 x Osmo Action Anti-Slip Pad for Adhesive Base | "
        "1 x Osmo Action 1.5m Extension Rod | 1 x Osmo Action Locking Screw | "
        "1 x Type-C to Type-C PD Cable"
    ),
    "DJI Osmo Action 6 Standard Combo": (
        "1 x DJI Osmo Action 6 Camera | 1 x Osmo Action 6 Extreme Battery | "
        "1 x Osmo Action Horizontal-Vertical Protective Frame | "
        "1 x Osmo Action 6 Glass Lens Cover | "
        "1 x Osmo Action Quick-Release Adapter Mount | "
        "1 x Osmo Action Adhesive Base (Curved) | "
        "1 x Osmo Action Locking Screw | 1 x Type-C to Type-C PD Cable"
    ),
    "DJI Osmo Action 6 Adventure Combo": (
        "1 x DJI Osmo Action 6 Camera | 3 x Osmo Action 6 Extreme Battery | "
        "1 x Osmo Action Multifunctional Battery Case | "
        "1 x Osmo Action Horizontal-Vertical Protective Frame | "
        "1 x Osmo Action 6 Glass Lens Cover | "
        "1 x Osmo Action Quick-Release Adapter Mount (Mini) | "
        "1 x Osmo Action 1.5m Extension Rod | "
        "1 x Osmo Action Adhesive Base (Curved) | "
        "1 x Osmo Action Locking Screw | "
        "1 x Osmo Action 6 Rubber Lens Protector | "
        "1 x Type-C to Type-C PD Cable"
    ),

    # ===== Osmo Pocket 3 / Pocket 4 =====
    "DJI Osmo Pocket 3 4K 3 Axis Gimbal Camera": (
        "1 x DJI Osmo Pocket 3 | 1 x Osmo Pocket 3 Handle | "
        "1 x Osmo Pocket 3 Cover | 1 x Osmo Pocket 3 Wrist Strap | "
        "1 x Type-C to Type-C PD Cable | 1 x Documents"
    ),
    "DJI Osmo Pocket 3 4K 3 Axis Gimbal Camera Combo": (
        "1 x DJI Osmo Pocket 3 | 1 x Osmo Pocket 3 Handle | "
        "1 x Osmo Pocket 3 Cover | 1 x Osmo Pocket 3 Wrist Strap | "
        "1 x Osmo Pocket 3 Mini Tripod | 1 x Osmo Pocket 3 Battery Handle | "
        "1 x DJI Mic 2 Transmitter | 1 x DJI Mic 2 Windscreen | "
        "1 x DJI Mic 2 Magnet (Pair) | 1 x DJI Mic 2 Clip Magnet (Pair) | "
        "1 x Osmo Pocket 3 Wide-Angle Lens | "
        "1 x Osmo Pocket 3 Carrying Bag | 1 x Type-C to Type-C PD Cable | "
        "1 x Documents"
    ),
    "DJI Osmo Pocket 3 Battery Handle": "1 x DJI Osmo Pocket 3 Battery Handle",
    "DJI Osmo Pocket 3 Mini Tripod": "1 x DJI Osmo Pocket 3 Mini Tripod",
    "DJI Osmo Pocket 3 Wide Angle Lens": (
        "1 x DJI Osmo Pocket 3 Wide-Angle Lens"
    ),
    "DJI Osmo Pocket 3 Expansion Adapter": (
        "1 x DJI Osmo Pocket 3 Expansion Adapter"
    ),
    "DJI Osmo Pocket 4 Standard Combo": (
        "1 x DJI Osmo Pocket 4 | 1 x Osmo Pocket 4 Handle | "
        "1 x Osmo Pocket 4 Cover | 1 x Osmo Pocket 4 Wrist Strap | "
        "1 x Type-C to Type-C PD Cable | 1 x Documents"
    ),

    # ===== Osmo Nano accessories =====
    "DJI Osmo Nano Magnetic Headband": (
        "1 x DJI Osmo Nano Magnetic Headband"
    ),
    "DJI Osmo Nano ND Filter (8/16/32)": (
        "1 x ND8 Filter | 1 x ND16 Filter | 1 x ND32 Filter | 1 x Filter Case"
    ),
    "DJI Osmo Nano Glass Lens Cover": "1 x DJI Osmo Nano Glass Lens Cover",
    "DJI Osmo Nano Dual-Direction Magnetic Ball-Joint Adapter Mount": (
        "1 x DJI Osmo Nano Dual-Direction Magnetic Ball-Joint Adapter Mount"
    ),

    # ===== Osmo Mobile / Selfie / RS =====
    "DJI Osmo Mobile 8 Gimbal": (
        "1 x DJI Osmo Mobile 8 | 1 x DJI OM Magnetic Phone Clamp | "
        "1 x Grip Tripod | 1 x USB-C Charging Cable | "
        "1 x Storage Pouch | 1 x Documents"
    ),
    "DJI Osmo 2.5m Extended Carbon Fiber Selfie Stick": (
        "1 x DJI Osmo 2.5m Extended Carbon Fiber Selfie Stick"
    ),
    "DJI Osmo Dual-Direction Quick-Release Foldable Adapter Mount": (
        "1 x DJI Osmo Dual-Direction Quick-Release Foldable Adapter Mount"
    ),
    "DJI RS 4 Mini Gimbal Combo": (
        "1 x DJI RS 4 Mini | 1 x BG21 Grip Battery | "
        "1 x Multi-Camera Control Cable (USB-C, 30 cm) | "
        "1 x Multi-Camera Control Cable (USB-C, Mini-USB) | "
        "1 x Multi-Camera Control Cable (USB-C, Multi) | "
        "1 x Lens-Fastening Strap 2 | 1 x Phone Holder | "
        "1 x Briefcase Handle | 1 x Tripod | 1 x USB-C Cable | "
        "1 x Storage Case"
    ),
    "DJI RS 5 Gimbal": (
        "1 x DJI RS 5 | 1 x BG30 Grip Battery | 1 x Quick-Release Plate | "
        "1 x Multi-Camera Control Cable (USB-C) | "
        "1 x Lens-Fastening Strap | 1 x Tripod | 1 x USB-C Cable | "
        "1 x Carrying Case"
    ),
    "DJI RS 5 Gimbal Combo": (
        "1 x DJI RS 5 | 1 x BG30 Grip Battery | 1 x Quick-Release Plate | "
        "1 x Multi-Camera Control Cable (USB-C) | "
        "1 x Multi-Camera Control Cable (USB-C, Multi) | "
        "1 x Lens-Fastening Strap | 1 x Phone Holder | "
        "1 x Briefcase Handle | 1 x Tripod | 1 x DJI Focus Pro Motor | "
        "1 x USB-C Cable | 1 x Carrying Case"
    ),

    # ===== Romo Robotic Vacuums =====
    "DJI Romo A Robotic Vacuum": (
        "1 x DJI Romo A Robot | 1 x Auto-Empty Base Station | "
        "1 x Power Cable | 1 x Cleaning Tool | 1 x Spare Mop Pad | "
        "1 x Spare Side Brush | 1 x Documents"
    ),
    "DJI Romo P Robotic Vacuum": (
        "1 x DJI Romo P Robot | "
        "1 x Auto-Empty / Auto-Wash Base Station | 1 x Power Cable | "
        "1 x Cleaning Tool | 1 x Spare Mop Pad | 1 x Spare Side Brush | "
        "1 x Spare Dust Bag | 1 x Documents"
    ),
    "DJI Romo S Robotic Vacuum": (
        "1 x DJI Romo S Robot | "
        "1 x Auto-Empty / Auto-Wash / Hot-Air Drying Base Station | "
        "1 x Power Cable | 1 x Cleaning Tool | 1 x Spare Mop Pad | "
        "1 x Spare Side Brush | 1 x Spare Dust Bag | "
        "1 x Cleaning Solution | 1 x Documents"
    ),

    # ===== DJI Lavalier Mic =====
    "DJI Lavalier Mic": (
        "1 x DJI Lavalier Mic | 1 x Windscreen | 1 x Documents"
    ),

    # ===== PGYTech =====
    "PGYTech Landing Gear Extension for DJI Mini 2 & Mini SE": (
        "1 x PGYTech Landing Gear Extension Set for DJI Mini 2 & Mini SE"
    ),
    "PGYTech Landing Gear Extensions for DJI Air 2S & Mavic Air 2": (
        "1 x PGYTech Landing Gear Extension Set for DJI Air 2S & Mavic Air 2"
    ),
    "PGYTech Safety Case for DJI Air 2S & Mavic Air 2": (
        "1 x PGYTech Safety Case for DJI Air 2S & Mavic Air 2"
    ),
    "PGYTech ND-PL Filter Set for DJI Air 2S": (
        "1 x ND8/PL Filter | 1 x ND16/PL Filter | 1 x ND32/PL Filter | "
        "1 x ND64/PL Filter | 1 x Filter Case | 1 x Cleaning Cloth"
    ),

    # ===== PolarPro / Shimoda / XCD =====
    "PolarPro Circular Polarizer (CPL) Filter for DJI Osmo Pocket 3": (
        "1 x PolarPro CPL Filter | 1 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Shimoda Core Unit Drone Mini Case Dji Padded Storage Boa": (
        "1 x Shimoda Core Unit Drone Mini Case"
    ),
    "XCD Action Camera Case for GoPro and DJI": (
        "1 x XCD Action Camera Case"
    ),

    # ===== SmallRig =====
    "SmallRig Full Cage for DJI Osmo Nano 5759": (
        "1 x SmallRig Full Cage for DJI Osmo Nano | 1 x Allen Wrench"
    ),
    "SmallRig Half Cage for DJI Osmo Nano 5764": (
        "1 x SmallRig Half Cage for DJI Osmo Nano | 1 x Allen Wrench"
    ),
    "SmallRig NATO Clamp Accessory Mount for DJI RS 2/RSC 2 3025": (
        "1 x SmallRig NATO Clamp Accessory Mount | 1 x Allen Wrench"
    ),
    "SmallRig Phone Holder for DJI Gimbals 4301": (
        "1 x SmallRig Phone Holder | 1 x Allen Wrench"
    ),
    "SmallRig Quick Release Plate for DJI RS 4 Mini 5336": (
        "1 x SmallRig Quick Release Plate for DJI RS 4 Mini | "
        "1 x Allen Wrench"
    ),
    "SmallRig Sling Handle for DJI RS Gimbals": (
        "1 x SmallRig Sling Handle | 1 x Allen Wrench"
    ),

    # ===== Freewell filter sets — composition by named pack =====
    "Freewell  4-pack Bright Day Series Filter Set for DJI Osmo Pocket 3": (
        "1 x ND64 Filter | 1 x ND128 Filter | 1 x ND256 Filter | "
        "1 x ND512 Filter | 1 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell  8-pack All Day Series Filter Set for DJI Osmo Pocket 3": (
        "1 x ND8 Filter | 1 x ND16 Filter | 1 x ND32 Filter | "
        "1 x ND64 Filter | 1 x ND8/PL Filter | 1 x ND16/PL Filter | "
        "1 x ND32/PL Filter | 1 x ND64/PL Filter | 1 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell 12-Pack Mega Split Filter Set for DJI Mavic 4 Pro": (
        "1 x ND8 Filter | 1 x ND16 Filter | 1 x ND32 Filter | "
        "1 x ND64 Filter | 1 x ND128 Filter | 1 x ND256 Filter | "
        "1 x Split ND8/4 Filter | 1 x Split ND32/16 Filter | "
        "1 x Split ND2000/ND1000 Filter | 1 x CPL Filter | "
        "1 x UV Filter | 1 x Glow Mist 1/4 Filter | 2 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell 12-pack Mega Filter Set for DJI Osmo Action 5 Pro": (
        "1 x ND8 Filter | 1 x ND16 Filter | 1 x ND32 Filter | "
        "1 x ND64 Filter | 1 x ND128 Filter | 1 x ND256 Filter | "
        "1 x ND8/PL Filter | 1 x ND16/PL Filter | 1 x ND32/PL Filter | "
        "1 x ND64/PL Filter | 1 x CPL Filter | 1 x UV Filter | "
        "2 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell 14-pack Mega Filter Set for DJI Osmo Pocket 3": (
        "1 x ND8 Filter | 1 x ND16 Filter | 1 x ND32 Filter | "
        "1 x ND64 Filter | 1 x ND128 Filter | 1 x ND256 Filter | "
        "1 x ND8/PL Filter | 1 x ND16/PL Filter | 1 x ND32/PL Filter | "
        "1 x ND64/PL Filter | 1 x CPL Filter | 1 x UV Filter | "
        "1 x Glow Mist 1/4 Filter | 1 x Light Pollution Reduction Filter | "
        "2 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell 16-pack Mega Filter Set for DJI Mini 4 Pro": (
        "1 x ND8 Filter | 1 x ND16 Filter | 1 x ND32 Filter | "
        "1 x ND64 Filter | 1 x ND128 Filter | 1 x ND256 Filter | "
        "1 x ND8/PL Filter | 1 x ND16/PL Filter | 1 x ND32/PL Filter | "
        "1 x ND64/PL Filter | 1 x ND128/PL Filter | 1 x ND256/PL Filter | "
        "1 x CPL Filter | 1 x UV Filter | 1 x Glow Mist 1/4 Filter | "
        "1 x Light Pollution Reduction Filter | 2 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell 16-pack Mega Filter Set for DJI Mini 5 Pro": (
        "1 x ND8 Filter | 1 x ND16 Filter | 1 x ND32 Filter | "
        "1 x ND64 Filter | 1 x ND128 Filter | 1 x ND256 Filter | "
        "1 x ND8/PL Filter | 1 x ND16/PL Filter | 1 x ND32/PL Filter | "
        "1 x ND64/PL Filter | 1 x ND128/PL Filter | 1 x ND256/PL Filter | "
        "1 x CPL Filter | 1 x UV Filter | 1 x Glow Mist 1/4 Filter | "
        "1 x Light Pollution Reduction Filter | 2 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell 2-pack Soft Edge Gradient Filter Set for DJI Mini 5 Pro": (
        "1 x Soft Edge Gradient ND4 Filter | "
        "1 x Soft Edge Gradient ND8 Filter | 1 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell 3-pack Magnetic Bright Day ND/PL Filters for DJI Neo 2": (
        "1 x ND64/PL Filter | 1 x ND128/PL Filter | 1 x ND256/PL Filter | "
        "1 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell 3-pack ND Filter Set for DJI Osmo 360 (ND16 32 64)": (
        "1 x ND16 Filter | 1 x ND32 Filter | 1 x ND64 Filter | "
        "1 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell 4-pack Bright Day ND-PL Filters for DJI Osmo Action 5 Pro": (
        "1 x ND64/PL Filter | 1 x ND128/PL Filter | 1 x ND256/PL Filter | "
        "1 x ND512/PL Filter | 1 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell 4-pack Everyday Filter Set for DJI Mini 5 Pro": (
        "1 x CPL Filter | 1 x UV Filter | 1 x Glow Mist 1/4 Filter | "
        "1 x Light Pollution Reduction Filter | 1 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell 6-Pack All Day Series ND Filter Set for DJI Mini 4 Pro": (
        "1 x ND8 Filter | 1 x ND16 Filter | 1 x ND32 Filter | "
        "1 x ND64 Filter | 1 x ND128 Filter | 1 x ND256 Filter | "
        "1 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell 6-Pack Bright Day Series Filter Set for DJI Mini 4 Pro": (
        "1 x ND64 Filter | 1 x ND128 Filter | 1 x ND256 Filter | "
        "1 x ND64/PL Filter | 1 x ND128/PL Filter | 1 x ND256/PL Filter | "
        "1 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell 6-pack All Day ND Filter Set for DJI Mini 5 Pro": (
        "1 x ND8 Filter | 1 x ND16 Filter | 1 x ND32 Filter | "
        "1 x ND64 Filter | 1 x ND128 Filter | 1 x ND256 Filter | "
        "1 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell 6-pack Bright Day Filter Set for DJI Flip": (
        "1 x ND64 Filter | 1 x ND128 Filter | 1 x ND256 Filter | "
        "1 x ND64/PL Filter | 1 x ND128/PL Filter | 1 x ND256/PL Filter | "
        "1 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell 6-pack Bright Day ND/PL Filter Set for DJI Mini 5 Pro": (
        "1 x ND64/PL Filter | 1 x ND128/PL Filter | 1 x ND256/PL Filter | "
        "1 x ND512/PL Filter | 1 x ND1000/PL Filter | "
        "1 x ND2000/PL Filter | 1 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell 8-pack All Day Series ND/Split ND-PL Filter Set for DJI Mavic 4 Pro": (
        "1 x ND8 Filter | 1 x ND16 Filter | 1 x ND32 Filter | "
        "1 x ND64 Filter | 1 x Split ND8/4 Filter | "
        "1 x Split ND32/16 Filter | 1 x Split ND2000/ND1000 Filter | "
        "1 x Split ND4/UV Filter | 1 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell Black Glow Mist 1/4 Filter for DJI Air 3S": (
        "1 x Freewell Black Glow Mist 1/4 Filter | 1 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell CPL Filter for DJI Mini 4 Pro": (
        "1 x Freewell CPL Filter | 1 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell CPL Filter for DJI Osmo Action 5 Pro": (
        "1 x Freewell CPL Filter | 1 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell Lens & ND Filter Kit for DJI Osmo Pocket 3": (
        "1 x Wide-Angle Lens | 1 x ND8 Filter | 1 x ND16 Filter | "
        "1 x ND32 Filter | 1 x ND64 Filter | 1 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell Light Polluition Reduction Filter for DJI Mini 4 Pro": (
        "1 x Freewell Light Pollution Reduction Filter | 1 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell Light Pollution Reduction (LPR) Filter for DJI Osmo Pocket 3": (
        "1 x Freewell Light Pollution Reduction Filter | 1 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell Light Pollution Reduction (Night Sky) Filter for DJI Mavic 4 Pro": (
        "1 x Freewell Light Pollution Reduction Filter | 1 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell Split ND2000/ND1000 Filter for DJI Mavic 4 Pro": (
        "1 x Freewell Split ND2000/ND1000 Filter | 1 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell Split ND32/16 Filter for DJI Mavic 4 Pro": (
        "1 x Freewell Split ND32/16 Filter | 1 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell Split ND4/UV Filter for DJI Mavic 4 Pro": (
        "1 x Freewell Split ND4/UV Filter | 1 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell Split ND8/4 Filter for DJI Mavic 4 Pro": (
        "1 x Freewell Split ND8/4 Filter | 1 x Filter Case | "
        "1 x Cleaning Cloth"
    ),
    "Freewell Standard Day ND Filters for DJI Osmo Action 5 Pro (4-Pack)": (
        "1 x ND8 Filter | 1 x ND16 Filter | 1 x ND32 Filter | "
        "1 x ND64 Filter | 1 x Filter Case | 1 x Cleaning Cloth"
    ),
    "Freewell UV Filter for DJI Air 3S": (
        "1 x Freewell UV Filter | 1 x Filter Case | 1 x Cleaning Cloth"
    ),
}


def main() -> int:
    if not CSV_PATH.exists():
        print(f"ERROR: {CSV_PATH} not found", file=sys.stderr)
        return 1

    shutil.copy2(CSV_PATH, BACKUP_PATH)
    print(f"Backup: {BACKUP_PATH}")

    with CSV_PATH.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    if not fieldnames or "In_The_Box" not in fieldnames:
        print("ERROR: In_The_Box column not found", file=sys.stderr)
        return 1

    updated = 0
    still_empty: dict[str, str] = {}
    for row in rows:
        if row["In_The_Box"].strip():
            continue
        title = row["Product_title"]
        if title in LOOKUP:
            row["In_The_Box"] = LOOKUP[title]
            updated += 1
        else:
            still_empty[title] = row["Category"]

    with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Rows updated: {updated}")
    if still_empty:
        print(f"Titles still missing ({len(still_empty)}):")
        for t, c in sorted(still_empty.items()):
            print(f"  [{c}] {t}")
    else:
        print("All previously empty rows are now populated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
