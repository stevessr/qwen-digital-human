#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// JSON-RPC 2.0 request
#[derive(Deserialize, Debug)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

/// JSON-RPC 2.0 response
#[derive(Serialize, Debug)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Serialize, Debug)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// MCP Tool definition
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Tool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// MCP Tool call result
#[derive(Serialize, Deserialize, Debug)]
pub struct ToolCallContent {
    #[serde(rename = "type")]
    pub content_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ToolCallResult {
    pub content: Vec<ToolCallContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

pub type ToolHandler = Arc<dyn Fn(Value) -> ToolCallResult + Send + Sync>;

pub struct McpServer {
    tools: Arc<Mutex<HashMap<String, (Tool, ToolHandler)>>>,
}

impl McpServer {
    pub fn new() -> Self {
        Self {
            tools: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn register_tool(&self, tool: Tool, handler: ToolHandler) {
        let mut tools = self.tools.lock().await;
        tools.insert(tool.name.clone(), (tool, handler));
    }

    pub async fn list_tools(&self) -> Vec<Tool> {
        let tools = self.tools.lock().await;
        tools.values().map(|(t, _)| t.clone()).collect()
    }

    pub async fn call_tool(&self, name: &str, args: Value) -> Option<ToolCallResult> {
        let tools = self.tools.lock().await;
        tools.get(name).map(|(_, handler)| handler(args))
    }

    pub async fn handle_rpc(&self, request: JsonRpcRequest) -> JsonRpcResponse {
        match request.method.as_str() {
            "tools/list" => {
                let tools = self.list_tools().await;
                JsonRpcResponse {
                    jsonrpc: "2.0".into(),
                    id: request.id,
                    result: Some(
                        serde_json::to_value(serde_json::json!({ "tools": tools })).unwrap(),
                    ),
                    error: None,
                }
            }
            "tools/call" => {
                let params = request.params.unwrap_or_default();
                let name = params["name"].as_str().unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(Value::Null);
                let result = self.call_tool(name, args).await;
                JsonRpcResponse {
                    jsonrpc: "2.0".into(),
                    id: request.id,
                    result: Some(serde_json::to_value(result).unwrap()),
                    error: None,
                }
            }
            _ => JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id: request.id,
                result: None,
                error: Some(JsonRpcError {
                    code: -32601,
                    message: format!("Method not found: {}", request.method),
                    data: None,
                }),
            },
        }
    }
}

impl Default for McpServer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_list_tools() {
        let server = McpServer::new();
        server.register_tool(Tool {
            name: "echo".into(),
            description: "Echoes the input".into(),
            input_schema: serde_json::json!({"type": "object", "properties": {"text": {"type": "string"}}}),
        }, Arc::new(|args| ToolCallResult {
            content: vec![ToolCallContent {
                content_type: "text".into(),
                text: args.get("text").and_then(|v| v.as_str()).map(|s| s.to_string()),
                data: None,
            }],
            is_error: None,
        })).await;

        let tools = server.list_tools().await;
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "echo");
    }

    #[tokio::test]
    async fn test_rpc_list_tools() {
        let server = McpServer::new();
        let req = JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: Some(Value::Number(1.into())),
            method: "tools/list".into(),
            params: None,
        };
        let resp = server.handle_rpc(req).await;
        assert_eq!(resp.jsonrpc, "2.0");
        assert!(resp.result.is_some());
        assert!(resp.error.is_none());
    }

    #[tokio::test]
    async fn test_unknown_method() {
        let server = McpServer::new();
        let req = JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: Some(Value::Number(1.into())),
            method: "nonexistent".into(),
            params: None,
        };
        let resp = server.handle_rpc(req).await;
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, -32601);
    }
}
