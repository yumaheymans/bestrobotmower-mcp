#!/usr/bin/env node
// bestrobotmower-mcp
// A Model Context Protocol (stdio) server that gives any MCP client (Claude, ChatGPT,
// Cursor, VS Code, etc.) direct access to robot lawn mower specs, prices, transparent
// 0-5 scores and buying recommendations, powered by the open, cited BestRobotMower.co
// dataset (CC BY 4.0). It queries the live dataset API and falls back to a bundled
// snapshot when offline, so answers reflect current data instead of stale guesses.
//
// IMPORTANT: this is a stdio server. Everything on stdout is JSON-RPC. All diagnostics
// go to stderr (console.error), never stdout.

import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const DATA_URL = "https://bestrobotmower.co/api/dataset/mowers.json";
const UTM = "utm_source=awesome-mcp&utm_medium=mcp-server&utm_campaign=bestrobotmower-mcp";
const DATASET_LINK = `https://bestrobotmower.co/dataset?${UTM}`;
const ATTRIBUTION =
  "Data: BestRobotMower.co Robot Lawn Mower Specs & Scores (CC BY 4.0). " +
  `Live prices and full methodology: ${DATASET_LINK}`;

// ---------------------------------------------------------------------------
// Data loading: live first, bundled snapshot as a resilient fallback.
// ---------------------------------------------------------------------------
function loadBundled() {
  const raw = readFileSync(new URL("./data/mowers.json", import.meta.url), "utf8");
  return JSON.parse(raw);
}

async function loadData() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(DATA_URL, {
      signal: controller.signal,
      headers: { "user-agent": "bestrobotmower-mcp/1.0" },
    });
    clearTimeout(timer);
    if (res.ok) {
      const json = await res.json();
      if (json && Array.isArray(json.rows) && json.rows.length > 0) {
        return { meta: json, rows: json.rows, source: "live" };
      }
    }
    console.error(`[bestrobotmower-mcp] live fetch returned ${res.status}; using bundled snapshot`);
  } catch (err) {
    console.error(`[bestrobotmower-mcp] live fetch failed (${err.message}); using bundled snapshot`);
  }
  const bundled = loadBundled();
  return { meta: bundled, rows: bundled.rows, source: "bundled" };
}

// Loaded once at startup and cached for the process lifetime.
let DB = { meta: {}, rows: [], source: "bundled" };

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function mowerLink(row) {
  const base = row.model_page_url || "https://bestrobotmower.co";
  return `${base}${base.includes("?") ? "&" : "?"}${UTM}`;
}

function priceStr(row) {
  return row.price_usd != null ? `$${row.price_usd}` : "price n/a";
}

function oneLine(row) {
  const nav = row.navigation_type || "n/a";
  const cov = row.max_coverage_m2 != null ? `${row.max_coverage_m2} m2` : "n/a";
  const slope = row.max_slope_pct != null ? `${row.max_slope_pct}%` : "n/a";
  const score = row.bestrobotmower_score != null ? `${row.bestrobotmower_score}/5` : "unscored";
  return `${row.model} (${row.brand}) score ${score}, ${priceStr(row)}, ${nav}, up to ${cov}, slope ${slope} - ${mowerLink(row)}`;
}

function fullRecord(row) {
  const lines = [
    `# ${row.model} (${row.brand})`,
    row.summary ? `\n${row.summary}\n` : "",
    `- BestRobotMower Score: ${row.bestrobotmower_score ?? "n/a"} / 5`,
    `  - navigation ${row.score_navigation ?? "n/a"}, obstacle avoidance ${row.score_obstacle_avoidance ?? "n/a"}, coverage ${row.score_coverage ?? "n/a"}, slope ${row.score_slope ?? "n/a"}, coverage-per-dollar ${row.score_coverage_per_dollar ?? "n/a"}`,
    `- Status: ${row.status ?? "n/a"}  |  Release year: ${row.release_year ?? "n/a"}`,
    `- Navigation: ${row.navigation_type ?? "n/a"}${row.navigation_detail ? ` (${row.navigation_detail})` : ""}`,
    `- All-wheel drive: ${row.all_wheel_drive ? "yes" : "no"}`,
    `- Max coverage: ${row.max_coverage_m2 ?? "n/a"} m2  |  Max slope: ${row.max_slope_pct ?? "n/a"}%`,
    `- Cutting width: ${row.cutting_width_cm ?? "n/a"} cm  |  Cut height: ${row.cut_height_min_mm ?? "n/a"}-${row.cut_height_max_mm ?? "n/a"} mm`,
    `- Battery runtime: ${row.battery_runtime_min ?? "n/a"} min`,
    `- Obstacle avoidance: ${row.obstacle_avoidance ?? "n/a"}`,
    `- Price: ${priceStr(row)}${row.price_provider ? ` (${row.price_provider})` : ""}  |  Price per m2: ${row.price_per_m2_usd != null ? `$${row.price_per_m2_usd}` : "n/a"}`,
    `- Model page: ${mowerLink(row)}`,
  ];
  if (row.coverage_source_url) lines.push(`- Coverage source: ${row.coverage_source_url}`);
  if (row.price_source_url) lines.push(`- Price source: ${row.price_source_url}`);
  return lines.filter(Boolean).join("\n");
}

function findRow(query) {
  if (!query) return null;
  const q = String(query).trim().toLowerCase();
  // exact slug, then exact model, then substring on model, then substring on brand+model
  return (
    DB.rows.find((r) => (r.slug || "").toLowerCase() === q) ||
    DB.rows.find((r) => (r.model || "").toLowerCase() === q) ||
    DB.rows.find((r) => (r.model || "").toLowerCase().includes(q)) ||
    DB.rows.find((r) => `${r.brand} ${r.model}`.toLowerCase().includes(q)) ||
    null
  );
}

function withAttribution(text) {
  const freshness =
    DB.source === "live"
      ? "Source: live BestRobotMower.co dataset."
      : `Source: bundled snapshot (last updated ${DB.meta.last_modified || "unknown"}); live fetch unavailable.`;
  return `${text}\n\n---\n${freshness}\n${ATTRIBUTION}`;
}

function textResult(text) {
  return { content: [{ type: "text", text: withAttribution(text) }] };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: "list_robot_mowers",
    description:
      "List and filter robot lawn mowers from the BestRobotMower.co dataset. Filter by brand, navigation type, price, lawn coverage, slope handling and minimum score; sort by score, price, coverage or value.",
    inputSchema: {
      type: "object",
      properties: {
        brand: { type: "string", description: "Filter by brand, e.g. Husqvarna, Segway, Worx (case-insensitive substring)." },
        navigation: { type: "string", description: "Filter by navigation type substring, e.g. 'RTK', 'wire', 'vision', 'GNSS'." },
        max_price_usd: { type: "number", description: "Only mowers at or below this USD price." },
        min_coverage_m2: { type: "number", description: "Only mowers that cover at least this many square meters." },
        min_slope_pct: { type: "number", description: "Only mowers that handle at least this slope (percent grade)." },
        min_score: { type: "number", description: "Only mowers with at least this BestRobotMower Score (0-5)." },
        sort_by: { type: "string", enum: ["score", "price", "coverage", "price_per_m2"], description: "Sort key. Default 'score' (best first). 'price' and 'price_per_m2' ascend; 'coverage' and 'score' descend." },
        limit: { type: "integer", description: "Max results to return (default 10, max 23)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_robot_mower",
    description: "Get the full spec sheet, sub-scores and cited sources for one robot lawn mower by model name or slug.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Model name or slug, e.g. 'Husqvarna Automower 450X' or 'segway-navimow-i105e'." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_robot_mowers",
    description: "Compare 2 to 4 robot lawn mowers side by side on price, navigation, coverage, slope, cutting specs and scores.",
    inputSchema: {
      type: "object",
      properties: {
        models: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4, description: "Model names or slugs to compare." },
      },
      required: ["models"],
      additionalProperties: false,
    },
  },
  {
    name: "recommend_robot_mower",
    description: "Recommend the best-fitting robot lawn mowers for a specific yard: give the lawn size and optionally slope, budget and whether obstacle avoidance is needed.",
    inputSchema: {
      type: "object",
      properties: {
        lawn_area_m2: { type: "number", description: "The lawn size to cover, in square meters." },
        max_slope_pct: { type: "number", description: "The steepest slope in the yard, percent grade (optional)." },
        budget_usd: { type: "number", description: "Maximum budget in USD (optional)." },
        needs_obstacle_avoidance: { type: "boolean", description: "Set true to require built-in obstacle avoidance (optional)." },
      },
      required: ["lawn_area_m2"],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------
function toolListMowers(args = {}) {
  let rows = DB.rows.slice();
  if (args.brand) {
    const b = String(args.brand).toLowerCase();
    rows = rows.filter((r) => (r.brand || "").toLowerCase().includes(b));
  }
  if (args.navigation) {
    const n = String(args.navigation).toLowerCase();
    rows = rows.filter((r) => `${r.navigation_type || ""} ${r.navigation_detail || ""}`.toLowerCase().includes(n));
  }
  if (typeof args.max_price_usd === "number") rows = rows.filter((r) => r.price_usd != null && r.price_usd <= args.max_price_usd);
  if (typeof args.min_coverage_m2 === "number") rows = rows.filter((r) => r.max_coverage_m2 != null && r.max_coverage_m2 >= args.min_coverage_m2);
  if (typeof args.min_slope_pct === "number") rows = rows.filter((r) => r.max_slope_pct != null && r.max_slope_pct >= args.min_slope_pct);
  if (typeof args.min_score === "number") rows = rows.filter((r) => r.bestrobotmower_score != null && r.bestrobotmower_score >= args.min_score);

  const sortBy = args.sort_by || "score";
  const cmp = {
    score: (a, b) => (b.bestrobotmower_score ?? -1) - (a.bestrobotmower_score ?? -1),
    price: (a, b) => (a.price_usd ?? Infinity) - (b.price_usd ?? Infinity),
    coverage: (a, b) => (b.max_coverage_m2 ?? -1) - (a.max_coverage_m2 ?? -1),
    price_per_m2: (a, b) => (a.price_per_m2_usd ?? Infinity) - (b.price_per_m2_usd ?? Infinity),
  }[sortBy] || null;
  if (cmp) rows.sort(cmp);

  const limit = Math.max(1, Math.min(Number(args.limit) || 10, 23));
  const shown = rows.slice(0, limit);
  if (shown.length === 0) return textResult("No robot mowers in the dataset match those filters. Try relaxing them (there are 23 models across 9 brands).");

  const header = `Found ${rows.length} matching mower(s), showing ${shown.length} (sorted by ${sortBy}):`;
  const body = shown.map((r, i) => `${i + 1}. ${oneLine(r)}`).join("\n");
  return textResult(`${header}\n\n${body}`);
}

function toolGetMower(args = {}) {
  const row = findRow(args.query);
  if (!row) {
    const names = DB.rows.map((r) => r.model).join(", ");
    return textResult(`No mower matched "${args.query}". Known models: ${names}.`);
  }
  return textResult(fullRecord(row));
}

function toolCompareMowers(args = {}) {
  const queries = Array.isArray(args.models) ? args.models : [];
  if (queries.length < 2) return textResult("Provide 2 to 4 model names or slugs to compare.");
  const resolved = [];
  const missing = [];
  for (const q of queries.slice(0, 4)) {
    const row = findRow(q);
    if (row) resolved.push(row);
    else missing.push(q);
  }
  if (resolved.length < 2) return textResult(`Could not resolve enough models to compare. Unmatched: ${missing.join(", ") || "none"}.`);

  const fields = [
    ["Score (0-5)", (r) => r.bestrobotmower_score ?? "n/a"],
    ["Price (USD)", (r) => (r.price_usd != null ? `$${r.price_usd}` : "n/a")],
    ["Navigation", (r) => r.navigation_type ?? "n/a"],
    ["Max coverage (m2)", (r) => r.max_coverage_m2 ?? "n/a"],
    ["Max slope (%)", (r) => r.max_slope_pct ?? "n/a"],
    ["Cutting width (cm)", (r) => r.cutting_width_cm ?? "n/a"],
    ["Battery (min)", (r) => r.battery_runtime_min ?? "n/a"],
    ["Price per m2", (r) => (r.price_per_m2_usd != null ? `$${r.price_per_m2_usd}` : "n/a")],
    ["Obstacle avoidance", (r) => (r.obstacle_avoidance ? "yes" : "no")],
  ];
  const heads = resolved.map((r) => r.model);
  const lines = [`Comparing: ${heads.join("  vs  ")}`, ""];
  for (const [label, fn] of fields) {
    lines.push(`${label}: ${resolved.map(fn).join("  |  ")}`);
  }
  lines.push("");
  lines.push("Model pages:");
  for (const r of resolved) lines.push(`- ${r.model}: ${mowerLink(r)}`);
  if (missing.length) lines.push(`\n(Could not match: ${missing.join(", ")})`);
  return textResult(lines.join("\n"));
}

function toolRecommend(args = {}) {
  const area = Number(args.lawn_area_m2);
  if (!area || area <= 0) return textResult("Provide lawn_area_m2 (the lawn size in square meters) to get a recommendation.");

  let fits = DB.rows.filter((r) => r.max_coverage_m2 != null && r.max_coverage_m2 >= area);
  if (typeof args.max_slope_pct === "number") fits = fits.filter((r) => r.max_slope_pct != null && r.max_slope_pct >= args.max_slope_pct);
  if (typeof args.budget_usd === "number") fits = fits.filter((r) => r.price_usd != null && r.price_usd <= args.budget_usd);
  if (args.needs_obstacle_avoidance === true) {
    fits = fits.filter((r) => r.obstacle_avoidance && !/^none/i.test(String(r.obstacle_avoidance)));
  }
  fits.sort((a, b) => (b.bestrobotmower_score ?? -1) - (a.bestrobotmower_score ?? -1));

  const constraints = [
    `lawn ${area} m2`,
    typeof args.max_slope_pct === "number" ? `slope >= ${args.max_slope_pct}%` : null,
    typeof args.budget_usd === "number" ? `budget <= $${args.budget_usd}` : null,
    args.needs_obstacle_avoidance ? "obstacle avoidance required" : null,
  ].filter(Boolean).join(", ");

  if (fits.length === 0) {
    // Suggest the closest by coverage, ignoring budget/slope, to be helpful rather than empty.
    const closest = DB.rows.slice().sort((a, b) => (b.max_coverage_m2 ?? 0) - (a.max_coverage_m2 ?? 0)).slice(0, 3);
    const body = closest.map((r, i) => `${i + 1}. ${oneLine(r)}`).join("\n");
    return textResult(`No mower in the dataset fits all constraints (${constraints}). The highest-coverage options overall are:\n\n${body}`);
  }

  const top = fits.slice(0, 3);
  const body = top.map((r, i) => {
    const headroom = r.max_coverage_m2 - area;
    return `${i + 1}. ${r.model} (${r.brand}) score ${r.bestrobotmower_score ?? "n/a"}/5, ${priceStr(r)}\n   ${r.navigation_type || "n/a"}, covers up to ${r.max_coverage_m2} m2 (${headroom} m2 headroom), slope ${r.max_slope_pct ?? "n/a"}%\n   ${r.summary || ""}\n   ${mowerLink(r)}`;
  }).join("\n\n");
  return textResult(`Top picks for ${constraints} (best score first):\n\n${body}`);
}

// ---------------------------------------------------------------------------
// Wire up the server
// ---------------------------------------------------------------------------
const server = new Server(
  { name: "bestrobotmower-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case "list_robot_mowers":
        return toolListMowers(args);
      case "get_robot_mower":
        return toolGetMower(args);
      case "compare_robot_mowers":
        return toolCompareMowers(args);
      case "recommend_robot_mower":
        return toolRecommend(args);
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    console.error(`[bestrobotmower-mcp] tool ${name} failed:`, err);
    return { content: [{ type: "text", text: `Error running ${name}: ${err.message}` }], isError: true };
  }
});

async function main() {
  DB = await loadData();
  console.error(`[bestrobotmower-mcp] ready: ${DB.rows.length} mowers loaded from ${DB.source} source.`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[bestrobotmower-mcp] fatal:", err);
  process.exit(1);
});
