"use client";

import { useCallback, useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  COLLAPSED_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from "../constants";
import { clampSidebarWidth } from "../utils";

function getStoredSidebarWidth() {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH;

  const stored = Number(window.localStorage.getItem("orxa-sidebar-width"));
  if (!Number.isFinite(stored)) return DEFAULT_SIDEBAR_WIDTH;

  return clampSidebarWidth(stored, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
}

export function useSidebarLayout(isCollapsed: boolean) {
  const [sidebarWidth, setSidebarWidth] = useState(getStoredSidebarWidth);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const width = isCollapsed ? COLLAPSED_WIDTH : sidebarWidth;
    document.documentElement.style.setProperty("--orxa-sidebar-width", `${width}px`);
  }, [isCollapsed, sidebarWidth]);

  useEffect(() => {
    if (!isResizing || isCollapsed) return;

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = clampSidebarWidth(event.clientX, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
      setSidebarWidth(nextWidth);
      window.localStorage.setItem("orxa-sidebar-width", String(nextWidth));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isCollapsed, isResizing]);

  const startResizing = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsResizing(true);
  }, []);

  return {
    sidebarWidth,
    isResizing,
    startResizing,
  };
}
