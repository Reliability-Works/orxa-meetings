import {
  BuiltInModelInfo,
  ModelSettingsUsage,
  SummaryModelGuidance,
} from "@/components/model-settings/builtinModelTypes";

export function getModelGuidance(
  modelName: string,
  usage: ModelSettingsUsage,
): SummaryModelGuidance {
  if (usage === "chat") {
    return getChatModelGuidance(modelName);
  }

  return getSummaryModelGuidance(modelName);
}

function getChatModelGuidance(modelName: string): SummaryModelGuidance {
  if (modelName === "qwen3.5:2b") {
    return {
      bestLabel: "Best local chat default",
      isBest: true,
      pros: [
        "Fastest good built-in choice for responsive meeting Q&A.",
        "Enough reasoning for transcript-backed follow-ups on most meetings.",
      ],
      cons: [
        "Less exhaustive than Qwen 3.5 4B for tangled technical discussions.",
        "May need more explicit prompts for multi-meeting synthesis.",
      ],
    };
  }

  if (modelName === "qwen3.5:4b") {
    return {
      bestLabel: "Best deep chat reasoning",
      pros: [
        "Strongest built-in option for nuanced meeting questions.",
        "Better at reconciling summary, evidence, and action items.",
      ],
      cons: ["Slower responses than Qwen 3.5 2B.", "Largest local download and memory footprint."],
    };
  }

  if (modelName === "gemma3:4b") {
    return {
      bestLabel: "Best alternate chat style",
      pros: [
        "Useful backup when Qwen answers feel too terse.",
        "Good for concise interpretation and rewriting tasks.",
      ],
      cons: [
        "Less preferred for evidence-heavy meeting agent answers.",
        "May need tighter prompting to cite transcript evidence.",
      ],
    };
  }

  return {
    bestLabel: "Best lightweight chat fallback",
    pros: [
      "Smallest built-in option for quick local chat.",
      "Good for simple lookup questions and short meetings.",
    ],
    cons: [
      "Weakest reasoning on complex meetings.",
      "Most likely to miss context across long transcripts.",
    ],
  };
}

function getSummaryModelGuidance(modelName: string): SummaryModelGuidance {
  if (modelName === "qwen3.5:4b") {
    return {
      bestLabel: "Best local summary quality",
      isBest: true,
      pros: [
        "Best built-in choice for expansive summaries.",
        "Large context window for long meeting notes.",
      ],
      cons: ["Largest built-in Qwen download.", "Needs more memory than the 2B model."],
    };
  }

  if (modelName === "qwen3.5:2b") {
    return {
      bestLabel: "Best lighter Qwen option",
      pros: [
        "Good balance of quality and local resource use.",
        "Safer default on lower-memory Macs.",
      ],
      cons: [
        "Less detail retention than Qwen 3.5 4B.",
        "May compress complex meetings more aggressively.",
      ],
    };
  }

  if (modelName === "gemma3:4b") {
    return {
      bestLabel: "Best legacy alternative",
      pros: ["Useful if you prefer Gemma-style summaries.", "Good quality/speed trade-off."],
      cons: [
        "Lower priority than the Qwen summary models.",
        "Not the best option for exhaustive meeting coverage.",
      ],
    };
  }

  return {
    bestLabel: "Best fastest fallback",
    pros: ["Smallest built-in summary model.", "Useful when speed and low memory matter most."],
    cons: [
      "Most likely to miss details in longer meetings.",
      "Not recommended for the expansive summary mode.",
    ],
  };
}

export function getModelDescription(model: BuiltInModelInfo, usage: ModelSettingsUsage) {
  if (usage === "summary") return model.description;

  if (model.name === "qwen3.5:2b") {
    return "Best default for responsive local meeting chat. Balanced speed, context use, and answer quality.";
  }

  if (model.name === "qwen3.5:4b") {
    return "Highest-quality local chat model for nuanced questions, evidence synthesis, and technical follow-ups.";
  }

  if (model.name === "gemma3:4b") {
    return "Alternative local chat model with a concise answer style and moderate local requirements.";
  }

  return "Fast lightweight chat fallback for simple meeting lookup questions on lower-memory Macs.";
}

export function summaryModelPriority(modelName: string) {
  if (modelName === "qwen3.5:4b") return 40;
  if (modelName === "qwen3.5:2b") return 30;
  if (modelName === "gemma3:4b") return 20;
  if (modelName === "gemma3:1b") return 10;
  return 0;
}
