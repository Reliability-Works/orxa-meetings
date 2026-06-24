import { ModelSettingsContent } from "@/components/model-settings/ModelSettingsContent";
import { ModelConfig } from "@/components/model-settings/modelSettingsTypes";
import { useModelSettingsController } from "@/components/model-settings/useModelSettingsController";

export type { ModelConfig } from "@/components/model-settings/modelSettingsTypes";

interface ModelSettingsModalProps {
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSave: (config: ModelConfig) => void;
  skipInitialFetch?: boolean;
  layout?: "inline" | "dialog";
  useGlobalConfig?: boolean;
  heading?: string;
  modelLabel?: string;
  usage?: "summary" | "chat";
}

export function ModelSettingsModal(props: ModelSettingsModalProps) {
  const controller = useModelSettingsController(props);
  return <ModelSettingsContent controller={controller} />;
}
