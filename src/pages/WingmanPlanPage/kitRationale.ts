import type { CatalogProduct } from "../../catalog/catalog";

/* =============================================================
 * kitRationale — heuristic "why this is in your kit" copy.
 *
 * For every tile in a Wingman kit (the hero core + each accessory),
 * resolve a single short line (10-15 words) that explains why this
 * product was picked for the kit. This is the synchronous fallback
 * that paints immediately on first render; the LLM upgrade in
 * `kitRationaleLLM.ts` later replaces it tile-by-tile when the
 * network round-trip resolves.
 *
 * Resolution priority (most specific to least):
 *   1. Series — flagship / marquee product lines that deserve a
 *      bespoke line (Inspire, Mavic, Osmo Pocket / Action / Nano,
 *      DJI Mic, FPV goggles).
 *   2. Subtype — fine-grained taxonomy from v6 tagging (e.g.
 *      `acc_filter_nd`, `mount_helmet`, `cam_360`). Most specific
 *      shopper-facing answer per category.
 *   3. AccessoryRole — coarse role bucket (`power`, `mounting`,
 *      `stabilization`, `visual_enhancement`, `storage`,
 *      `fpv_component`, `general`). Catches anything the subtype
 *      didn't.
 *   4. ProductType — last-resort generic line per high-level
 *      category (drone, action_camera, mobile_gimbal, camera_gimbal).
 *   5. Hard-coded universal fallback so the function never returns
 *      an empty string.
 *
 * Templates are intentionally short (~10-15 words, ≤140 chars) so
 * they fit inside the on-tile overlay without overflowing the
 * smallest n=4 short tile (~186×120). All copy is hand-authored —
 * no per-SKU work, no per-product overrides, just category-level
 * lines that read sensibly across the entire DJI catalog. The hero
 * (core) tile gets the same line as any other product of its
 * category — its prominence in the grid layout is already the
 * "this is the centerpiece" cue, no copy framing needed.
 * ============================================================= */

/** A single short rationale line explaining why a product is in
 *  the kit. Kept as a plain string (rather than `{title, body}`)
 *  because we only want one tight snippet per tile — no headline,
 *  no description, just the reason. */
export type KitRationale = string;

export type KitRationaleContext = {
  /** Anchor product the kit was assembled around. Currently unused
   *  by the heuristic (no hero-specific framing) but kept on the
   *  signature so the LLM call (which DOES use it for kit-aware
   *  framing) shares the same input shape. */
  core: CatalogProduct;
  /** First detected primary activity from `plan.detectedActivities`,
   *  if any. Currently unused by the heuristic; the LLM uses it for
   *  activity-tinted copy. */
  primaryActivity?: string | undefined;
};

/* ---------- Series-level overrides (highest priority) ----------
 * Reserved for marquee product lines where a generic "drone" /
 * "action camera" line would undersell what the shopper is buying. */
const SERIES_RATIONALE: Record<string, KitRationale> = {
  inspire:
    "Flagship cinema drone — full-frame sensors and swappable lenses for serious aerial cinematography.",
  matrice:
    "Industrial airframe for inspection, mapping and survey work where payload flexibility matters most.",
  mavic:
    "Pro-grade folding drone — the everyday workhorse for aerial photo, video and travel B-roll.",
  air: "Mid-tier folding drone — sweet spot between the compact Mini and the pro Mavic line.",
  mini: "Sub-249g travel drone — small enough to skip most paperwork and fit a jacket pocket.",
  neo: "Palm-launch follow drone — captures hands-free orbits without needing a remote in the frame.",
  avata:
    "Cinewhoop FPV drone for immersive indoor and proximity flying — pairs with FPV goggles.",
  osmo_pocket:
    "Three-axis stabilized pocket camera for buttery-smooth run-and-gun footage on the go.",
  osmo_action:
    "Waterproof action camera built for chest, helmet and bar mounts in sports and travel.",
  osmo_360:
    "Captures everything around you in one shot — reframe the angle freely in post.",
  osmo_nano:
    "Magnetic clip-on capture cam for hands-free POV — sticks to a strap, hat or shirt.",
  osmo_mobile:
    "Smartphone gimbal for buttery handheld video — pairs with active tracking for solo shoots.",
  ronin_rs:
    "Pro three-axis gimbal for mirrorless and cinema cameras — cornerstone of any gimbal-led shoot.",
  dji_mic:
    "Wireless lavalier audio system — clean dialogue that travels with the talent, no boom required.",
  fpv_goggles:
    "Low-latency video receiver — the headset half of any FPV setup, puts you in the cockpit.",
  fpv_controller:
    "Dedicated FPV radio — purpose-built sticks and switches that swap in for the standard remote.",
};

/* ---------- Subtype-level rationales (mid priority) ----------
 * Per-category copy that answers "what is this thing for in this
 * specific kit". Covers the full v6 subtype taxonomy that ships in
 * `CatalogProduct.subtypes`. */
const SUBTYPE_RATIONALE: Record<string, KitRationale> = {
  /* Cameras */
  cam_action:
    "Rugged POV camera for body, helmet or vehicle mounts — gets shots your main camera can't.",
  cam_pocket:
    "Stabilized pocket camera for handheld walk-and-talk — the smallest reliable B-roll camera in the kit.",
  cam_360: "Films everything at once so you can reframe the angle freely in post.",
  cam_dual_screen:
    "Front and rear screens let you frame yourself while still seeing what the lens sees.",
  cam_nano:
    "Magnetic clip-on cam for true hands-free POV — sticks to a strap, hat or shirt.",

  /* Drones */
  drone_compact:
    "Folding travel drone — your aerial workhorse for wide establishing shots and overhead angles.",
  drone_cinema:
    "Pro aerial platform with cinema-grade optics — for sets where the aerial shot is the hero.",
  drone_fpv:
    "Immersive cinewhoop airframe — for chase shots and proximity flying a Mavic can't pull off.",
  drone_selfie:
    "Palm-launch follow drone — captures hands-free orbits without a remote ever entering the frame.",
  drone_racing:
    "Speed-tuned FPV airframe for race-line flying — pairs with goggles and a controller.",
  drone_enterprise:
    "Industrial drone for survey, mapping and inspection — payload flexibility over consumer portability.",

  /* Gimbals */
  gimbal_phone:
    "Smooths handheld phone footage and unlocks tracking shots — the smallest stabilization upgrade here.",
  gimbal_camera:
    "Three-axis stabilizer for mirrorless or cinema cameras — pro gimbal-led movement for narrative work.",
  gimbal_compact:
    "Travel-friendly stabilizer that fits the carry-on and supports a wide payload range.",

  /* Audio */
  mic_wireless:
    "Body-pack wireless audio — clean voice capture without tethering talent to the camera.",
  mic_lavalier:
    "Clip-on lapel mic for interview-grade dialogue — the standard upgrade over a camera's built-in audio.",
  mic_phone_adapter:
    "Connects pro mics to your phone so social-first content gets broadcast-grade audio.",
  mic_transmitter:
    "Spare body-pack transmitter — pair a second talent or keep a backup ready mid-shoot.",
  mic_receiver:
    "Camera-mount receiver — the other half of the wireless rig that lands audio onto your camera.",
  mic_windscreen:
    "Furry windscreen kills wind noise on outdoor shoots so the dialogue track stays usable.",
  mic_charging_case:
    "Recharges and stores the mic system between shoots — top up without hunting for USB.",
  mic_kit:
    "Bundled wireless audio set — transmitter, receiver, mics and case in one travel-ready package.",

  /* Mounts */
  mount_helmet:
    "Locks the action cam to a helmet for true POV in moto, ski and cycling self-shoots.",
  mount_handlebar:
    "Clamps to handlebars or posts for third-person tracking shots from the rig you're already on.",
  mount_suction:
    "Vehicle and smooth-surface mount for dash, hood and side-pod shots — the workhorse car-mount option.",
  mount_chest:
    "Body-mount harness for hands-busy POV — captures the gear, controls and terrain in front of you.",
  mount_neck:
    "Magnetic neck-worn mount — a hands-free, eye-level vlog angle without the chest-mount bulk.",
  mount_wrist:
    "Wrist-worn quick-grab mount — keeps the camera tethered between handheld shots so it doesn't drop.",
  mount_tripod:
    "Stable base for static shots, time-lapses and self-talking-head — the most-used tool you'll forget.",
  mount_clamp:
    "Universal clamp for railings, branches and fixtures — turns any structure into a camera support.",
  mount_magnetic:
    "Quick magnetic dock — snap the camera on and off between scenes without re-rigging.",
  mount_extension:
    "Telescoping pole for selfie and overhead angles — buys you reach without an actual aerial.",

  /* Power & charging */
  acc_battery:
    "Doubles your runtime so the shoot doesn't end when the first battery dies.",
  acc_charger:
    "Multi-bay charger tops up several batteries in parallel — kit ready for the next call time.",

  /* Filters */
  acc_filter_nd:
    "Cuts midday brightness so you can hold cinematic 1/50s shutter and natural motion blur.",
  acc_filter_cpl:
    "Cuts surface glare on water, glass and foliage — saturates skies and recovers detail.",
  acc_filter_uv:
    "Optical-glass lens protector — blocks scratches and dust without affecting the image.",

  /* Optics */
  acc_lens_wide:
    "Wider field of view for tight interiors and immersive POV — captures more without backing up.",
  acc_lens_macro:
    "Close-focus optic for product, food and detail shots — opens a new B-roll category.",

  /* Drone-specific spares */
  acc_propeller:
    "Replacement propellers — flight-ending damage is one bad landing away while learning the airframe.",

  /* Carry & protect */
  acc_case:
    "Padded case sized for the kit — keeps drone, batteries and filters cushioned in transit.",
  acc_strap:
    "Camera strap or sling — keeps the camera at hand all day without wrist fatigue.",

  /* Misc */
  acc_remote:
    "Dedicated controller — physical sticks and a built-in screen feel different from phone-controlled flight.",
  acc_landing_gear:
    "Raised landing legs — extra prop clearance for tall grass and uneven launch surfaces.",
};

/* ---------- AccessoryRole rationales (lower priority) ----------
 * Coarser bucket than subtype — used when the product has no
 * matching subtype entry but does carry an accessoryRole tag. */
const ROLE_RATIONALE: Record<string, KitRationale> = {
  power:
    "Extra battery or charging hub — keeps the kit running through a full shoot day.",
  mounting:
    "Rigging that locks the camera onto your gear, helmet or vehicle for true POV shots.",
  stabilization:
    "Smooths out handheld motion — the cheapest upgrade from phone-footage look to intentional cinematography.",
  visual_enhancement:
    "Filters or optics tuned for tougher conditions — better motion blur, less glare, sharper highlights.",
  storage:
    "Travel-ready carry — keeps the kit cushioned, organized and ready to deploy on demand.",
  general:
    "Supports the rest of the kit so the core gear can do its job uninterrupted.",
  fpv_component:
    "Goggles or motion controller — completes the FPV flight loop alongside the airframe.",
};

/* ---------- ProductType rationales (lowest priority) ----------
 * Generic last-resort lines per high-level category. Hit only when
 * a product has no series, subtype or accessoryRole match — rare
 * but defensive so the overlay is never empty. */
const PRODUCT_TYPE_RATIONALE: Record<string, KitRationale> = {
  drone:
    "Captures the wide establishing shots and overhead angles you can't get from the ground.",
  action_camera:
    "Rugged POV cam for body, vehicle or helmet mounts — gets shots your main camera can't.",
  mobile_gimbal:
    "Smooths handheld phone footage and unlocks tracking shots — smallest stabilization upgrade in the kit.",
  camera_gimbal:
    "Three-axis stabilizer for mirrorless and cinema cameras — pro gimbal-led movement for narrative work.",
  accessory:
    "Supports the rest of the kit so the core gear can do its job uninterrupted.",
};

const UNIVERSAL_FALLBACK: KitRationale =
  "Pairs with the rest of the kit to round out your shoot.";

/* ---------- Resolver ---------- */
export function getHeuristicRationale(
  product: CatalogProduct,
  // Context is part of the public signature so future heuristics can
  // tint copy by activity / hero status without a breaking API change;
  // the current implementation doesn't need it. The underscore prefix
  // tells eslint the param is intentionally unused.
  _context: KitRationaleContext,
): KitRationale {
  /* 1. Series — flagship product line beats every other lookup. */
  if (product.series && SERIES_RATIONALE[product.series]) {
    return SERIES_RATIONALE[product.series];
  }

  /* 2. Subtype — first matching subtype wins. v6 tagging usually
   *    only assigns one subtype per row, but we iterate defensively
   *    in case a SKU carries multiple. */
  for (const subtype of product.subtypes) {
    const rationale = SUBTYPE_RATIONALE[subtype];
    if (rationale) return rationale;
  }

  /* 3. AccessoryRole. */
  if (product.accessoryRole && ROLE_RATIONALE[product.accessoryRole]) {
    return ROLE_RATIONALE[product.accessoryRole];
  }

  /* 4. ProductType. */
  if (product.productType && PRODUCT_TYPE_RATIONALE[product.productType]) {
    return PRODUCT_TYPE_RATIONALE[product.productType];
  }

  /* 5. Universal fallback so the overlay is never empty. */
  return UNIVERSAL_FALLBACK;
}
