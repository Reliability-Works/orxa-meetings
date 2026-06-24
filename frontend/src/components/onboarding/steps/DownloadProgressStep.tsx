import { DownloadProgressStepView } from "./DownloadProgressStepView";
import { useDownloadProgressStepState } from "./useDownloadProgressStepState";

export function DownloadProgressStep() {
  return <DownloadProgressStepView {...useDownloadProgressStepState()} />;
}
