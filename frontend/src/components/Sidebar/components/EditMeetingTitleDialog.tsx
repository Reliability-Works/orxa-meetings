import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../../ui/dialog";
import { VisuallyHidden } from "../../ui/visually-hidden";

interface EditMeetingTitleDialogProps {
  open: boolean;
  title: string;
  onTitleChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function EditMeetingTitleDialog({
  open,
  title,
  onTitleChange,
  onConfirm,
  onCancel,
}: EditMeetingTitleDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-[425px]">
        <VisuallyHidden>
          <DialogTitle>Edit Meeting Title</DialogTitle>
        </VisuallyHidden>
        <div className="py-4">
          <h3 className="mb-4 text-lg font-semibold">Edit Meeting Title</h3>
          <label htmlFor="meeting-title" className="mb-2 block text-sm font-medium text-gray-700">
            Meeting Title
          </label>
          <input
            id="meeting-title"
            type="text"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onConfirm();
              } else if (event.key === "Escape") {
                onCancel();
              }
            }}
            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter meeting title"
            autoFocus
          />
        </div>
        <DialogFooter>
          <button
            onClick={onCancel}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
