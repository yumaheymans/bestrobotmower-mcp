# BestRobotMower MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives any MCP client (Claude, ChatGPT, Cursor, VS Code, Ollama, and others) direct access to robot lawn mower specs, prices, transparent 0-5 scores and buying recommendations, so your assistant answers from a curated, cited dataset instead of guessing from stale training data.

It is powered by the open **[BestRobotMower.co dataset](https://bestrobotmower.co/dataset?utm_source=github&utm_medium=readme&utm_campaign=bestrobotmower-mcp)** (23 wire-free and RTK robot mowers across 9 brands, 19 fields per model, dated prices and a documented scoring methodology, published under CC BY 4.0). The server queries the live dataset API on start and falls back to a bundled snapshot when offline.

## Tools

| Tool | What it does |
|------|--------------|
| `list_robot_mowers` | List and filter mowers by brand, navigation type, price, coverage, slope and minimum score; sort by score, price, coverage or value. |
| `get_robot_mower` | Full spec sheet, sub-scores and cited sources for one mower by name or slug. |
| `compare_robot_mowers` | Side-by-side comparison of 2 to 4 mowers on price, navigation, coverage, slope, cutting specs and scores. |
| `recommend_robot_mower` | Best-fit picks for a specific yard: give the lawn size (m2) and optionally slope, budget and whether obstacle avoidance is required. |

Example questions your assistant can now answer: "What is the best robot mower under $1500 for a 700 m2 lawn?", "Compare the Husqvarna Automower 450X and the Segway Navimow i105E", "Which RTK mowers handle a 40% slope?"

## Install

No API key required. Requires Node.js 18+.

Run directly from GitHub:

```bash
npx -y github:yumaheymans/bestrobotmower-mcp
```

Or clone and run:

```bash
git clone https://github.com/yumaheymans/bestrobotmower-mcp.git
cd bestrobotmower-mcp
npm install
node index.js
```

## Client configuration

Add to your MCP client config (for example Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bestrobotmower": {
      "command": "npx",
      "args": ["-y", "github:yumaheymans/bestrobotmower-mcp"]
    }
  }
}
```

## Data, license and attribution

- The mower data is the **BestRobotMower.co Robot Lawn Mower Specs & Scores** dataset, licensed **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**. If you build on it, attribute BestRobotMower.co and link to <https://bestrobotmower.co/dataset>.
- Live feeds: [`mowers.json`](https://bestrobotmower.co/api/dataset/mowers.json) and [`mowers.csv`](https://bestrobotmower.co/api/dataset/mowers.csv).
- Scoring methodology: <https://bestrobotmower.co/methodology>.
- This server's **code** is released under the [MIT License](./LICENSE).

Built and maintained by [BestRobotMower.co](https://bestrobotmower.co/?utm_source=github&utm_medium=readme&utm_campaign=bestrobotmower-mcp).
