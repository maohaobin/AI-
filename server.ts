import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("data.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS data_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    source_type TEXT DEFAULT 'manual',
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS external_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    method TEXT DEFAULT 'GET',
    headers TEXT,
    params TEXT,
    category TEXT,
    description TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS external_source_params (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT DEFAULT 'string',
    required INTEGER DEFAULT 0,
    format TEXT,
    FOREIGN KEY (source_id) REFERENCES external_sources(id)
  );
`);

try {
  db.prepare("ALTER TABLE external_sources ADD COLUMN description TEXT").run();
} catch (e) {
  // Column might already exist
}

// --- MCP Tool Logic ---
const getTeamCostReport = async ({ startTime, endTime, sale, team }: any) => {
  const url = new URL("https://concussant-hollie-unwestern.ngrok-free.dev/api/v1/report/cost/teams");
  url.searchParams.append("startTime", startTime);
  url.searchParams.append("endTime", endTime);
  if (sale) url.searchParams.append("sale", sale);
  if (team) url.searchParams.append("team", team);

  try {
    const response = await fetch(url.toString());
    const data = await response.json();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  } catch (error: any) {
    return {
      content: [{ type: "text" as const, text: `Error fetching data: ${error.message}. Note: This server is running in the cloud and may not be able to reach 192.168.x.x directly.` }],
      isError: true,
    };
  }
};

// --- MCP Server Setup ---
const mcpServer = new McpServer({
  name: "Internal Report Server",
  version: "1.0.0",
});

// Register a tool in MCP for the cost report
mcpServer.tool(
  "get_team_cost_report",
  "获取团队成本报告数据",
  {
    startTime: z.string().describe("开始日期 (YYYY-MM-DD)"),
    endTime: z.string().describe("结束日期 (YYYY-MM-DD)"),
    sale: z.string().optional().describe("销售人员姓名"),
    team: z.string().optional().describe("团队名称"),
  },
  getTeamCostReport
);

let transport: SSEServerTransport | null = null;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/projects", (req, res) => {
    const projects = db.prepare("SELECT * FROM projects").all();
    res.json(projects);
  });

  // MCP SSE Endpoints
  app.get("/sse", async (req, res) => {
    transport = new SSEServerTransport("/messages", res);
    await mcpServer.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(400).send("No active SSE transport");
    }
  });

  // Helper endpoint for frontend to call MCP tools without full SSE client
  app.post("/api/mcp/call", async (req, res) => {
    const { name, arguments: args } = req.body;
    try {
      if (name === "get_team_cost_report") {
        const result = await getTeamCostReport(args);
        res.json(result);
      } else {
        res.status(404).json({ error: "Tool not found" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/projects", (req, res) => {
    const { id, name, description } = req.body;
    db.prepare("INSERT INTO projects (id, name, description) VALUES (?, ?, ?)").run(id, name, description);
    res.json({ success: true });
  });

  app.delete("/api/projects/:id", (req, res) => {
    const projectId = req.params.id;
    // 1. Get all sources for this project
    const sources = db.prepare("SELECT id FROM external_sources WHERE project_id = ?").all(projectId) as { id: number }[];
    
    // 2. Delete params for each source
    for (const source of sources) {
      db.prepare("DELETE FROM external_source_params WHERE source_id = ?").run(source.id);
    }
    
    // 3. Delete sources
    db.prepare("DELETE FROM external_sources WHERE project_id = ?").run(projectId);
    
    // 4. Delete data entries
    db.prepare("DELETE FROM data_entries WHERE project_id = ?").run(projectId);
    
    // 5. Finally delete the project
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    
    res.json({ success: true });
  });

  app.get("/api/projects/:id/data", (req, res) => {
    const data = db.prepare("SELECT * FROM data_entries WHERE project_id = ?").all(req.params.id);
    res.json(data);
  });

  app.post("/api/projects/:id/data", (req, res) => {
    const { content, category } = req.body;
    db.prepare("INSERT INTO data_entries (project_id, content, category) VALUES (?, ?, ?)").run(req.params.id, content, category);
    res.json({ success: true });
  });

  app.delete("/api/data/:id", (req, res) => {
    db.prepare("DELETE FROM data_entries WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // External Sources API
  app.get("/api/projects/:id/sources", (req, res) => {
    const sources = db.prepare("SELECT * FROM external_sources WHERE project_id = ?").all(req.params.id);
    res.json(sources);
  });

  app.post("/api/projects/:id/sources", (req, res) => {
    const { name, url, method, headers, params, category, description } = req.body;
    db.prepare(`
      INSERT INTO external_sources (project_id, name, url, method, headers, params, category, description) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, name, url, method || 'GET', headers || '{}', params || '{}', category || '常规', description || '');
    res.json({ success: true });
  });

  app.get("/api/sources/:id/params", (req, res) => {
    const params = db.prepare("SELECT * FROM external_source_params WHERE source_id = ?").all(req.params.id);
    res.json(params);
  });

  app.post("/api/sources/:id/params", (req, res) => {
    const { name, description, type, required, format } = req.body;
    db.prepare(`
      INSERT INTO external_source_params (source_id, name, description, type, required, format) 
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.id, name, description, type || 'string', required ? 1 : 0, format || '');
    res.json({ success: true });
  });

  app.delete("/api/params/:id", (req, res) => {
    db.prepare("DELETE FROM external_source_params WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/sources/:id", (req, res) => {
    // Delete related params first to avoid foreign key constraint error
    db.prepare("DELETE FROM external_source_params WHERE source_id = ?").run(req.params.id);
    db.prepare("DELETE FROM external_sources WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.put("/api/sources/:id", (req, res) => {
    const { name, url, method, headers, params, category, description } = req.body;
    db.prepare(`
      UPDATE external_sources 
      SET name = ?, url = ?, method = ?, headers = ?, params = ?, category = ?, description = ?
      WHERE id = ?
    `).run(name, url, method, headers, params, category, description, req.params.id);
    res.json({ success: true });
  });

  app.post("/api/sources/:id/fetch", async (req, res) => {
    const source = db.prepare("SELECT * FROM external_sources WHERE id = ?").get(req.params.id);
    if (!source) return res.status(404).json({ error: "Source not found" });

    try {
      const fetchOptions: any = {
        method: source.method,
        headers: JSON.parse(source.headers || '{}'),
      };

      let url = source.url;
      const params = JSON.parse(source.params || '{}');

      if (source.method === 'GET') {
        const queryParams = new URLSearchParams(params).toString();
        if (queryParams) url += (url.includes('?') ? '&' : '?') + queryParams;
      } else {
        fetchOptions.body = JSON.stringify(params);
        fetchOptions.headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, fetchOptions);
      const data = await response.json();
      
      // Convert data to a string representation for the AI
      const content = typeof data === 'object' ? JSON.stringify(data) : String(data);

      db.prepare("INSERT INTO data_entries (project_id, content, category, source_type) VALUES (?, ?, ?, ?)")
        .run(source.project_id, content, source.category, 'external');

      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Fetch error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/sources/test", async (req, res) => {
    const { url: baseUrl, method, headers: headersStr, params: paramsStr } = req.body;
    let url = baseUrl;
    
    try {
      const headers = JSON.parse(headersStr || '{}');
      const params = JSON.parse(paramsStr || '{}');
      
      const fetchOptions: any = {
        method: method || 'GET',
        headers: headers,
      };

      if (method === 'GET') {
        const queryParams = new URLSearchParams(params).toString();
        if (queryParams) url += (url.includes('?') ? '&' : '?') + queryParams;
      } else {
        fetchOptions.body = JSON.stringify(params);
        fetchOptions.headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, fetchOptions);
      const data = await response.json();
      res.json({ success: true, data });
    } catch (error: any) {
      let message = error.message;
      if (message.includes("ENOTFOUND") || message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
        message = `云端服务器无法访问该地址 (${url})。如果是局域网 IP (如 192.168.x.x)，请尝试使用“本地浏览器测试”模式。`;
      }
      res.status(500).json({ success: false, error: message });
    }
  });

  app.post("/api/sources/execute/:id", async (req, res) => {
    const source = db.prepare("SELECT * FROM external_sources WHERE id = ?").get(req.params.id);
    if (!source) return res.status(404).json({ error: "Source not found" });

    const dynamicArgs = req.body;
    let url = source.url;

    try {
      const headers = JSON.parse(source.headers || '{}');
      const staticParams = JSON.parse(source.params || '{}');
      
      // Merge static params with dynamic args from AI
      const finalParams = { ...staticParams, ...dynamicArgs };
      
      const fetchOptions: any = {
        method: source.method,
        headers: headers,
      };

      if (source.method === 'GET') {
        const queryParams = new URLSearchParams(finalParams).toString();
        if (queryParams) url += (url.includes('?') ? '&' : '?') + queryParams;
      } else {
        fetchOptions.body = JSON.stringify(finalParams);
        fetchOptions.headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, fetchOptions);
      const data = await response.json();
      res.json({ success: true, data });
    } catch (error: any) {
      let message = error.message;
      if (message.includes("ENOTFOUND") || message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
        message = `云端服务器无法访问该地址 (${url})。如果是局域网 IP (如 192.168.x.x)，请确保该地址在公网可访问，AI 才能读取数据。`;
      }
      res.status(500).json({ success: false, error: message });
    }
  });

  // AI Search Tool Endpoint
  app.get("/api/ai/search", (req, res) => {
    const { projectId, query } = req.query;
    if (!projectId) return res.status(400).json({ error: "projectId is required" });

    // Simple keyword search for now
    const searchPattern = `%${query}%`;
    const results = db.prepare("SELECT content, category FROM data_entries WHERE project_id = ? AND content LIKE ?").all(projectId, searchPattern);
    
    // If no specific keyword matches, return all data for that project to let AI filter
    if (results.length === 0) {
        const allData = db.prepare("SELECT content, category FROM data_entries WHERE project_id = ?").all(projectId);
        return res.json(allData);
    }

    res.json(results);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
