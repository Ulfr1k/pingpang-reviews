/**
 * ITTF LARC Long Pimple Rubber Scraper
 * 
 * Fetches all "Long" pimple type racket coverings directly from the ITTF
 * equipment API (Azure backend). No browser/Playwright needed.
 * 
 * API discovered: https://ittf-admin-api.azurewebsites.net/api/Equipment_RacketCoverings/all_list
 * 
 * Usage:
 *   node scraper.mjs                    # basic list (fast)
 *   node scraper.mjs --with-detail      # also fetch per-item details (slower)
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_BASE = "https://ittf-admin-api.azurewebsites.net/api";
const LIST_URL = `${API_BASE}/Equipment_RacketCoverings/all_list`;
const DETAIL_URL = (id) => `${API_BASE}/Equipment_RacketCovering/${id}/Details`;

// ITTF image base (may require auth; we store the filename and use fallback)
const IMG_BASE = "https://stittfadmin.blob.core.windows.net/websitefiles/equipment/";

const PAGE_SIZE = 100;
const DATA_FILE = join(__dirname, "..", "data", "larc-long-rubbers.json");

const withDetail = process.argv.includes("--with-detail");

/** Fetch JSON from a URL with retry. */
async function fetchJSON(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error(`  Attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt < retries) await sleep(2000 * attempt);
      else throw err;
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fetch all Long pimple rubbers by paginating the API. */
async function fetchAllLongRubbers() {
  const filter = JSON.stringify([{ name: "PimpleType", value: "Long" }]);
  const all = [];
  let skip = 0;
  let total = Infinity;

  console.log("Fetching Long pimple rubbers from ITTF API...");

  while (skip < total) {
    const url = `${LIST_URL}?limit=${PAGE_SIZE}&skip=${skip}&custom_filter=${encodeURIComponent(filter)}`;
    console.log(`  Page ${Math.floor(skip / PAGE_SIZE) + 1} (skip=${skip})...`);
    const data = await fetchJSON(url);

    if (!Array.isArray(data) || !data[0]) {
      console.error("Unexpected API response shape");
      break;
    }

    const batch = data[0].rows || [];
    total = data[0].Count || 0;
    all.push(...batch);
    console.log(`    Got ${batch.length} items (total known: ${total})`);

    if (batch.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  console.log(`Fetched ${all.length} of ${total} Long pimple rubbers.`);
  return all;
}

/** Fetch detail for a single rubber (includes image & color info). */
async function fetchDetail(id) {
  const data = await fetchJSON(DETAIL_URL(id));
  if (!data) return null;

  const basic = data.basic_information || {};
  const images = (data.image_information || []).filter((i) => i.Image);
  const colors = (data.color_information || []).map((c) => ({
    color: c.Color,
    equipmentColorId: c.EquipmentColorId,
    spongeColor: c.SpongeColor,
    expiresOn: c.ExpiresOn,
    hasOXVersion: c.HasOXVersion,
  }));

  return {
    logoSize: basic.LogoSize,
    logoSizeUnit: basic.LogoSizeUnit,
    logoWeight: basic.LogoWeight,
    logoWeightUnit: basic.LogoWeightUnit,
    logoShape: basic.LogoShape,
    qrCode: basic.QRCode,
    barCode: basic.BarCode,
    images: images.map((i) => ({
      filename: i.Image,
      caption: i.Caption,
    })),
    colors,
  };
}

/** Transform raw API row into our clean data model. */
function transformRow(row) {
  return {
    code: row.EquipmentCode || null,
    brand: row.BrandName || null,
    model: row.EquipmentName || null,
    pimpleType: row.PimpleType || "Long",
    colors: row.ColorsList ? row.ColorsList.split(",").map((c) => c.trim()) : [],
    colorIds: row.EquipmentColorIds ? row.EquipmentColorIds.split(",").map((c) => c.trim()) : [],
    imageFile: row.ImageList || null,
    imageUrl: row.ImageList ? IMG_BASE + row.ImageList : null,
    isActive: row.IsActive ?? false,
    approvalStatus: row.ApprovalStatus ?? false,
    isNew: row.IsNew ?? false,
    hasOXVersion: row.HasOXVersion ?? null,
    expiresOn: row.ExpiresOn || null,
    equipmentId: row.EquipmentRacketCoveringId || null,
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  const rows = await fetchAllLongRubbers();
  let rubbers = rows.map(transformRow);

  if (withDetail) {
    console.log("\nFetching per-item details...");
    for (const r of rubbers) {
      if (!r.equipmentId) continue;
      console.log(`  ${r.brand} ${r.model} (${r.code})...`);
      try {
        const detail = await fetchDetail(r.equipmentId);
        if (detail) {
          r.detail = detail;
          await sleep(300); // be gentle on the API
        }
      } catch (err) {
        console.error(`    Detail fetch failed: ${err.message}`);
      }
    }
  }

  // Load previous data to compare
  let prevData = null;
  if (existsSync(DATA_FILE)) {
    try {
      prevData = JSON.parse(readFileSync(DATA_FILE, "utf-8"));
    } catch {}
  }

  const output = {
    meta: {
      source: "https://equipment.ittf.com/#/equipment/racket_coverings",
      apiEndpoint: LIST_URL,
      filter: "PimpleType=Long",
      total: rubbers.length,
      scrapedAt: new Date().toISOString(),
      withDetail,
    },
    rubbers,
  };

  // Detect changes
  let changed = true;
  if (prevData) {
    const prevCodes = new Set(prevData.rubbers.map((r) => r.code));
    const newCodes = new Set(rubbers.map((r) => r.code));
    changed = !setsEqual(prevCodes, newCodes);
    if (changed) {
      const added = [...newCodes].filter((c) => !prevCodes.has(c));
      const removed = [...prevCodes].filter((c) => !newCodes.has(c));
      if (added.length) console.log(`\nNew rubbers added: ${added.join(", ")}`);
      if (removed.length) console.log(`Rubbers removed: ${removed.join(", ")}`);
    } else {
      // Also check isActive changes (certification status)
      const prevActive = new Map(prevData.rubbers.map((r) => [r.code, r.isActive]));
      changed = rubbers.some((r) => prevActive.get(r.code) !== r.isActive);
      if (!changed) console.log("\nNo changes detected.");
    }
  }

  writeFileSync(DATA_FILE, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\nWrote ${rubbers.length} rubbers to ${DATA_FILE}`);
  console.log(`Changed: ${changed}`);

  // Output change flag for Actions
  if (process.env.GITHUB_ACTIONS) {
    const summary = `Scraped ${rubbers.length} Long pimple rubbers. Changed: ${changed}`;
    if (process.env.GITHUB_STEP_SUMMARY) {
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, "utf-8");
    }
  }
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
