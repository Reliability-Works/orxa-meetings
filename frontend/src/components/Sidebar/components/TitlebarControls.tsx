import { ArrowLeft, ArrowRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  TITLEBAR_BUTTON_CLASS,
  TITLEBAR_CONTROL_LIFT,
  TITLEBAR_CONTROL_OFFSET,
  TITLEBAR_FORWARD_BUTTON_CLASS,
} from "../constants";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../ui/tooltip";

interface TitlebarControlsProps {
  isCollapsed: boolean;
  onToggle: () => void;
  variant: "floating" | "inline";
}

export function TitlebarControls({ isCollapsed, onToggle, variant }: TitlebarControlsProps) {
  const isFloating = variant === "floating";
  const content = (
    <div
      className="flex h-10 items-center gap-1 pr-3"
      style={{
        paddingLeft: TITLEBAR_CONTROL_OFFSET,
        transform: `translateY(${TITLEBAR_CONTROL_LIFT}px)`,
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onToggle}
            className={TITLEBAR_BUTTON_CLASS}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => window.history.back()}
            className={TITLEBAR_BUTTON_CLASS}
            aria-label="Go back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Go back</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => window.history.forward()}
            className={TITLEBAR_FORWARD_BUTTON_CLASS}
            aria-label="Go forward"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Go forward</TooltipContent>
      </Tooltip>
    </div>
  );

  return (
    <TooltipProvider>
      {isFloating ? (
        <div className="fixed left-0 top-0 z-50 h-10 w-[190px] bg-transparent">{content}</div>
      ) : (
        content
      )}
    </TooltipProvider>
  );
}
