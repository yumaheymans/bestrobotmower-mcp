import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const failures = [];
function check(cond, label) {
  if (cond) console.log(`  PASS ${label}`);
  else { console.log(`  FAIL ${label}`); failures.push(label); }
}

const transport = new StdioClientTransport({
  command: "node",
  args: [new URL("./index.js", import.meta.url).pathname],
});
const client = new Client({ name: "smoke-test", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

console.log("[1] tools/list");
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
check(tools.length === 4, `4 tools registered (got ${tools.length}: ${names.join(", ")})`);
check(
  ["compare_robot_mowers", "get_robot_mower", "list_robot_mowers", "recommend_robot_mower"].every((n) => names.includes(n)),
  "all four tool names present"
);
for (const t of tools) check(!!t.inputSchema && t.inputSchema.type === "object", `${t.name} has an object inputSchema`);

async function callText(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return { r, text };
}

console.log("[2] list_robot_mowers (<= $1500, top by score)");
{
  const { r, text } = await callText("list_robot_mowers", { max_price_usd: 1500, sort_by: "score", limit: 5 });
  check(!r.isError, "no error");
  check(/score/i.test(text) && /bestrobotmower\.co/i.test(text), "output has scores + attribution link");
  check(/utm_source=awesome-mcp/.test(text), "model links carry utm attribution");
}

console.log("[3] get_robot_mower (segway-navimow-i105e)");
{
  const { r, text } = await callText("get_robot_mower", { query: "segway-navimow-i105e" });
  check(!r.isError, "no error");
  check(/Navimow i105E/i.test(text) && /BestRobotMower Score/i.test(text), "full record for the requested model");
}

console.log("[4] compare_robot_mowers");
{
  const { r, text } = await callText("compare_robot_mowers", { models: ["Segway Navimow i105E", "Segway Navimow X330"] });
  check(!r.isError, "no error");
  check(/Comparing:/i.test(text) && /Navigation:/i.test(text), "side-by-side comparison rendered");
}

console.log("[5] recommend_robot_mower (500 m2, <= $1200)");
{
  const { r, text } = await callText("recommend_robot_mower", { lawn_area_m2: 500, budget_usd: 1200 });
  check(!r.isError, "no error");
  check(/pick|option/i.test(text) && /m2/i.test(text), "recommendation returned with reasoning");
}

console.log("[6] get_robot_mower (nonexistent) degrades gracefully");
{
  const { r, text } = await callText("get_robot_mower", { query: "zzz-not-a-real-mower" });
  check(!r.isError, "no crash");
  check(/No mower matched/i.test(text) && /Known models/i.test(text), "helpful not-found message");
}

await client.close();

console.log(failures.length === 0 ? "\nSMOKE TEST: ALL PASS" : `\nSMOKE TEST: ${failures.length} FAILURE(S)`);
process.exit(failures.length === 0 ? 0 : 1);
