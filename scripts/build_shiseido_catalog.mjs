/*
 * One-time build: join the Shiseido family-tree CSV (prices, variants,
 * product types) with the image manifest (full galleries + rich PDP
 * copy) on product ID, group size/refill variants into a single
 * product, and emit a clean JSON dataset the app consumes at load time.
 *
 * Run:  node scripts/build_shiseido_catalog.mjs
 *
 * Source files live in "Shiseido data new/"; output is written to
 * src/catalog/shiseidoProducts.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Papa from "papaparse";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "Shiseido data new");
const OUT_FILE = join(ROOT, "src", "catalog", "shiseidoProducts.json");

const PUBLIC_IMAGE_PREFIX = "shiseido_product_images";

function readCsv(path) {
  const raw = readFileSync(path, "utf8");
  return Papa.parse(raw, { header: true, skipEmptyLines: "greedy" }).data;
}

const clean = (v) => (v ?? "").replace(/\u00a0/g, " ").trim();

/** Parse the product id token out of a local image path filename:
 *  images/benefiance/wrinkle-smoothing-eye-cream-0768614208570_1.jpg -> 0768614208570 */
function idFromImagePath(path) {
  const file = clean(path).split("/").pop() || "";
  const m = file.match(/-([A-Za-z0-9]+)_\d+\.[A-Za-z0-9]+$/);
  return m ? m[1] : "";
}

/** images/benefiance/foo_1.jpg -> shiseido_product_images/benefiance/foo_1.jpg */
function toPublicImage(path) {
  const p = clean(path).replace(/^images\//, "");
  return p ? `${PUBLIC_IMAGE_PREFIX}/${p}` : "";
}

/** Parse the lowest dollar amount out of a messy price cell, e.g.
 *  "$39.00", "$39–$55", "$56.10 (15% off $66.00)" -> 39, 39, 56.1 */
function parsePrice(cell) {
  const matches = clean(cell).match(/\$\s*([0-9]+(?:\.[0-9]+)?)/g);
  if (!matches) return null;
  const nums = matches.map((m) => Number.parseFloat(m.replace(/[^0-9.]/g, "")));
  const valid = nums.filter((n) => Number.isFinite(n));
  if (valid.length === 0) return null;
  return Math.min(...valid);
}

function splitSkinTypes(cell) {
  const c = clean(cell);
  if (!c || /^all$/i.test(c)) return ["All"];
  return c
    .split(/[/,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Pull structured badges/concerns out of the free-text notes column. */
function parseNotes(cell) {
  const c = clean(cell);
  const concerns = [];
  const badges = [];
  let outOfStock = false;
  for (const part of c.split(";").map((s) => s.trim()).filter(Boolean)) {
    const concernMatch = part.match(/^Concern:\s*(.+)$/i);
    if (concernMatch) {
      concerns.push(concernMatch[1].trim());
      continue;
    }
    if (/out of stock/i.test(part)) {
      outOfStock = true;
      continue;
    }
    if (/best seller/i.test(part)) badges.push("Best Seller");
    else if (/award/i.test(part)) badges.push("Award Winner");
    else if (/new\b/i.test(part)) badges.push("New");
    else if (/refillable/i.test(part)) badges.push("Refillable");
    else if (/limited edition/i.test(part)) badges.push("Limited Edition");
    else if (/retinol/i.test(part)) concerns.push("Retinol");
    else if (/brightening/i.test(part)) concerns.push("Brightening");
  }
  return { concerns: [...new Set(concerns)], badges: [...new Set(badges)], outOfStock };
}

function bullets(cell) {
  return clean(cell)
    .split(/\n/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

function firstSentence(text) {
  const t = clean(text).replace(/\s+/g, " ");
  if (!t) return "";
  const m = t.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim();
}

function categoryFor(productType, collection) {
  const t = clean(productType).toLowerCase();
  const col = clean(collection).toLowerCase();
  if (/\b(set|bundle|duo|kit)\b/.test(t)) return "Sets & Bundles";
  if (/sunscreen/.test(t) && !/moisturizer/.test(t)) return "Sunscreen";
  if (col === "ultimate sun" || col === "urban environment") return "Sunscreen";
  if (/(eye|lip)/.test(t)) return "Eye & Lip Care";
  if (/mask/.test(t)) return "Masks";
  if (/(remover|cleanser|cleansing|foam|brush|tool)/.test(t)) return "Cleansers";
  if (/(softener|essence)/.test(t)) return "Softeners";
  if (/(serum|concentrate|treatment|primer|shot|facial oil|oil\b)/.test(t))
    return "Serums & Treatments";
  if (/(moisturizer|cream|lotion|fluid)/.test(t)) return "Moisturizers";
  return "Skincare";
}

function slugify(s) {
  return clean(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---- Load sources -------------------------------------------------------

const familyRows = readCsv(join(DATA_DIR, "shiseido-skincare-family-tree.csv"));
const manifestRows = readCsv(join(DATA_DIR, "shiseido-product-images-manifest.csv"));

// Manifest grouped by product id: gallery + rich copy (first non-empty wins).
const manifestById = new Map();
for (const row of manifestRows) {
  const localPath = row["Local Image Path"];
  const id = clean(row["Product ID"]) || idFromImagePath(localPath);
  if (!id) continue;
  let entry = manifestById.get(id);
  if (!entry) {
    entry = {
      name: clean(row["Product Name"]),
      collection: clean(row["Collection"]),
      gallery: [],
      overview: clean(row["Overview"]),
      keyBenefits: bullets(row["Key Benefits"]),
      howToUse: bullets(row["How To Use"]),
      ingredients: clean(row["Ingredients"]),
      shortSummary: clean(row["Short Summary"]),
      pdpUrl: clean(row["PDP URL"]),
    };
    manifestById.set(id, entry);
  }
  const img = toPublicImage(localPath);
  if (img && !entry.gallery.includes(img)) entry.gallery.push(img);
  // Backfill rich copy from any row that has it.
  if (!entry.overview) entry.overview = clean(row["Overview"]);
  if (entry.keyBenefits.length === 0) entry.keyBenefits = bullets(row["Key Benefits"]);
  if (entry.howToUse.length === 0) entry.howToUse = bullets(row["How To Use"]);
  if (!entry.ingredients) entry.ingredients = clean(row["Ingredients"]);
  if (!entry.shortSummary) entry.shortSummary = clean(row["Short Summary"]);
}

// Family tree grouped by product id (falls back to collection|name).
const productsById = new Map();
for (const row of familyRows) {
  const primaryImage = row["Primary Image"];
  const id =
    idFromImagePath(primaryImage) ||
    slugify(`${row["Collection"]}-${row["Sub-Product"]}`);
  if (!clean(row["Sub-Product"])) continue;

  let p = productsById.get(id);
  if (!p) {
    p = {
      id,
      collection: clean(row["Collection"]),
      routineCompleteness: clean(row["Routine Completeness"]),
      name: clean(row["Sub-Product"]),
      productType: clean(row["Product Type"]),
      variants: [],
      prices: [],
      skinTypes: splitSkinTypes(row["Skin Type Fit"]),
      keyAttributes: clean(row["Key Attributes"]),
      concerns: [],
      badges: [],
      outOfStock: false,
      primaryImage: toPublicImage(primaryImage),
    };
    productsById.set(id, p);
  }
  const price = parsePrice(row["Price"]);
  p.variants.push({ label: clean(row["Variant"]) || "Standard", price });
  if (price != null) p.prices.push(price);
  const notes = parseNotes(row["Concern/Notes"]);
  p.concerns.push(...notes.concerns);
  p.badges.push(...notes.badges);
  if (notes.outOfStock) p.outOfStock = true;
}

// ---- Merge + finalize ---------------------------------------------------

const products = [];
const usedSlugs = new Set();
for (const p of productsById.values()) {
  const mani = manifestById.get(p.id);
  const name = mani?.name || p.name;
  const collection = p.collection || mani?.collection || "Shiseido";
  const category = categoryFor(p.productType, collection);

  const gallery = mani?.gallery?.length ? mani.gallery : p.primaryImage ? [p.primaryImage] : [];
  const primaryImage = p.primaryImage || gallery[0] || "";

  const priceValues = p.prices.length ? p.prices : [];
  const price = priceValues.length ? Math.min(...priceValues) : null;
  const priceFrom = new Set(priceValues).size > 1;

  const shortDescription =
    p.keyAttributes || mani?.shortSummary || firstSentence(mani?.overview || "");

  const concerns = [...new Set(p.concerns)];
  const skinTypes = [...new Set(p.skinTypes)];
  const badges = [...new Set(p.badges)];

  let slug = slugify(`${collection}-${name}`);
  if (usedSlugs.has(slug)) slug = `${slug}-${p.id}`;
  usedSlugs.add(slug);

  products.push({
    id: p.id,
    slug,
    name,
    brand: "Shiseido",
    collection,
    category,
    productType: p.productType,
    routineCompleteness: p.routineCompleteness,
    price,
    priceFrom,
    variants: p.variants,
    skinTypes,
    concerns,
    badges,
    outOfStock: p.outOfStock,
    shortDescription,
    overview: mani?.overview || "",
    keyBenefits: mani?.keyBenefits || [],
    howToUse: mani?.howToUse || [],
    ingredients: mani?.ingredients || "",
    primaryImage,
    gallery,
    pdpUrl: mani?.pdpUrl || "",
  });
}

products.sort((a, b) => a.collection.localeCompare(b.collection) || a.name.localeCompare(b.name));

writeFileSync(OUT_FILE, JSON.stringify(products, null, 2) + "\n", "utf8");

const withImages = products.filter((p) => p.primaryImage).length;
const withGallery = products.filter((p) => p.gallery.length > 1).length;
console.log(
  `Wrote ${products.length} products to ${OUT_FILE}\n` +
    `  with primary image: ${withImages}\n` +
    `  with multi-image gallery: ${withGallery}\n` +
    `  categories: ${[...new Set(products.map((p) => p.category))].sort().join(", ")}\n` +
    `  collections: ${[...new Set(products.map((p) => p.collection))].sort().join(", ")}`,
);
