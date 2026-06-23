import React from "react";
import { Info as InfoIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";

interface InfoProps {
    isCollapsed: boolean;
    compact?: boolean;
}

const Info = React.forwardRef<HTMLButtonElement, InfoProps>(({ isCollapsed, compact = false }, ref) => {
  const iconOnly = isCollapsed || compact;
  return (
    <Dialog aria-describedby={undefined}>
      <DialogTrigger asChild>
        <button 
          ref={ref} 
          className={`flex items-center justify-center mb-2 cursor-pointer border-none transition-colors ${
            iconOnly 
              ? `bg-transparent p-2 hover:bg-gray-100 rounded-lg ${compact ? "mb-0" : "mb-2"}` 
              : "w-full px-3 py-1.5 mt-1 text-sm font-medium text-gray-700 bg-gray-200 hover:bg-gray-200 rounded-lg shadow-sm"
          }`}
          title="About Meetily"
        >
          <InfoIcon className={`text-gray-600 ${iconOnly ? "w-5 h-5" : "w-4 h-4"}`} />
          {!iconOnly && (
            <span className="ml-2 text-sm text-gray-700">About</span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent>
        <VisuallyHidden>
          <DialogTitle>About Meetily</DialogTitle>
        </VisuallyHidden>
        <About />
      </DialogContent>
    </Dialog>
  );
});

Info.displayName = "About";

export default Info; 
