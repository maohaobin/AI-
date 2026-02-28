import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";

const searchProjectDataDeclaration: FunctionDeclaration = {
  name: "searchProjectData",
  parameters: {
    type: Type.OBJECT,
    description: "Search for specific data points or information within a project's database.",
    properties: {
      projectId: {
        type: Type.STRING,
        description: "The unique ID of the project to search in.",
      },
      query: {
        type: Type.STRING,
        description: "The search query or keyword to look for in the project data.",
      },
    },
    required: ["projectId", "query"],
  },
};

export async function chatWithProject(projectId: string, projectName: string, message: string, history: any[] = []) {
  const model = "gemini-3.1-pro-preview";
  
  // Initialize AI with current API key
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

  // Fetch external sources for this project to create dynamic tools
  const sourcesRes = await fetch(`/api/projects/${projectId}/sources`);
  const sources = await sourcesRes.json();
  
  const dynamicTools: FunctionDeclaration[] = [];

  // --- MCP Integration ---
  // In a real MCP setup, we would discover tools from the MCP server.
  // Here we manually add the MCP tool we defined in server.ts
  dynamicTools.push({
    name: "get_team_cost_report",
    parameters: {
      type: Type.OBJECT,
      description: "获取团队成本报告数据 (通过 MCP Server 调用)",
      properties: {
        startTime: { type: Type.STRING, description: "开始日期 (YYYY-MM-DD)" },
        endTime: { type: Type.STRING, description: "结束日期 (YYYY-MM-DD)" },
        sale: { type: Type.STRING, description: "销售人员姓名" },
        team: { type: Type.STRING, description: "团队名称" },
      },
      required: ["startTime", "endTime"],
    },
  });
  
  for (const source of sources) {
    // Fetch params for each source
    const paramsRes = await fetch(`/api/sources/${source.id}/params`);
    const params = await paramsRes.json();
    
    const properties: any = {};
    const required: string[] = [];
    
    for (const p of params) {
      properties[p.name] = {
        type: p.type === 'number' ? Type.NUMBER : Type.STRING,
        description: p.description || p.name,
      };
      if (p.format) {
        properties[p.name].description += ` (格式: ${p.format})`;
      }
      if (p.required) {
        required.push(p.name);
      }
    }
    
    dynamicTools.push({
      name: `callExternalSource_${source.id}`,
      parameters: {
        type: Type.OBJECT,
        description: source.description || `从外部数据源 "${source.name}" 获取数据。`,
        properties: properties,
        required: required,
      },
    });
  }

  const chat = ai.chats.create({
    model: model,
    config: {
      systemInstruction: `你是一个关于项目 "${projectName}" (ID: ${projectId}) 的专家助手。
      你的目标是通过从项目的内部数据库或外部 API 中检索数据，准确回答用户的问题。
      
      可用工具：
      1. 'searchProjectData': 搜索项目内部已有的静态数据点。
      ${dynamicTools.map((t, i) => `${i + 2}. '${t.name}': ${t.parameters.description}`).join('\n')}

      在回答之前，请务必使用最合适的工具查找相关信息。
      如果用户询问特定时间段的数据，请优先使用支持时间参数的外部数据源工具。
      汇总检索到的数据，提供简洁且有帮助的回答。`,
      tools: [{ functionDeclarations: [searchProjectDataDeclaration, ...dynamicTools] }],
    },
    history: history,
  });

  try {
    let response = await chat.sendMessage({ message });
    
    // Handle function calls
    const functionCalls = response.functionCalls;
    if (functionCalls) {
      const results = [];
      for (const call of functionCalls) {
        if (call.name === "get_team_cost_report") {
          const mcpRes = await fetch("/api/mcp/call", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: call.name, arguments: call.args }),
          });
          const data = await mcpRes.json();
          results.push({
            name: call.name,
            response: { content: JSON.stringify(data) },
            id: call.id
          });
        } else if (call.name === "searchProjectData") {
          const { projectId: pid, query } = call.args as { projectId: string, query: string };
          const searchRes = await fetch(`/api/ai/search?projectId=${pid}&query=${encodeURIComponent(query)}`);
          const data = await searchRes.json();
          results.push({
            name: call.name,
            response: { content: JSON.stringify(data) },
            id: call.id
          });
        } else if (call.name.startsWith("callExternalSource_")) {
          const sourceId = call.name.split("_")[1];
          const source = sources.find((s: any) => s.id === parseInt(sourceId));
          
          if (source) {
            try {
              // MCP 模式：直接在浏览器端执行请求，利用本地网络环境
              const headers = JSON.parse(source.headers || '{}');
              const staticParams = JSON.parse(source.params || '{}');
              const finalParams = { ...staticParams, ...call.args };
              
              const fetchOptions: any = {
                method: source.method,
                headers: headers,
              };

              let url = source.url;
              if (source.method === 'GET') {
                const queryParams = new URLSearchParams(finalParams).toString();
                if (queryParams) url += (url.includes('?') ? '&' : '?') + queryParams;
              } else {
                fetchOptions.body = JSON.stringify(finalParams);
                fetchOptions.headers['Content-Type'] = 'application/json';
              }

              const response = await fetch(url, fetchOptions);
              const data = await response.json();
              
              results.push({
                name: call.name,
                response: { content: JSON.stringify(data) },
                id: call.id
              });
            } catch (e: any) {
              results.push({
                name: call.name,
                response: { content: `本地执行失败: ${e.message}。请确保已开启 Allow CORS 插件且网络通畅。` },
                id: call.id
              });
            }
          }
        }
      }

      const dataString = results.map(r => `${r.name} 返回的数据: ${r.response.content}`).join("\n\n");
      response = await chat.sendMessage({ message: `系统找到的数据:\n${dataString}\n\n请根据这些数据汇总并回答原始问题。` });
    }

    return response.text;
  } catch (error: any) {
    if (error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED')) {
      return "抱歉，当前 API 配额已耗尽。请点击页面上方的“选择 API Key”按钮，配置您自己的付费 API Key 以继续使用。";
    }
    throw error;
  }
}
