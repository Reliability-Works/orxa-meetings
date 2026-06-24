"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { McpSetupInfo } from "./types";

export function useMcpSetupSettings() {
  const [mcpSetupInfo, setMcpSetupInfo] = useState<McpSetupInfo | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [isMcpConfigCopied, setIsMcpConfigCopied] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadMcpSetupInfo = async () => {
      try {
        const setupInfo = await invoke<McpSetupInfo>("get_mcp_setup_info");
        if (!isMounted) return;

        setMcpSetupInfo(setupInfo);
        setMcpError(null);
      } catch (error) {
        console.error("Failed to load MCP setup info:", error);
        if (!isMounted) return;

        setMcpError("MCP setup details are not available in this build.");
      }
    };

    loadMcpSetupInfo();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleOpenMcpServerFolder = async () => {
    try {
      await invoke("open_mcp_server_folder");
    } catch (error) {
      console.error("Failed to open MCP server folder:", error);
      setMcpError("Could not open the MCP server folder.");
    }
  };

  const handleCopyMcpConfig = async () => {
    if (!mcpSetupInfo) return;

    try {
      await navigator.clipboard.writeText(mcpSetupInfo.client_config_json);
      setIsMcpConfigCopied(true);
      window.setTimeout(() => setIsMcpConfigCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy MCP config:", error);
      setMcpError("Could not copy the MCP config.");
    }
  };

  return {
    mcpSetupInfo,
    mcpError,
    isMcpConfigCopied,
    handleOpenMcpServerFolder,
    handleCopyMcpConfig,
  };
}
