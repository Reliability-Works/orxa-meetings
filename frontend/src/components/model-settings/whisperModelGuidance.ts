import { getModelBaseName, isQuantizedModel } from "@/lib/whisper";

export type WhisperModelGuidance = {
  bestLabel: string;
  pros: string[];
  cons: string[];
};

export const BASIC_WHISPER_MODEL_NAMES = [
  "small",
  "medium-q5_0",
  "large-v3-q5_0",
  "large-v3-turbo",
  "large-v3",
];

const WHISPER_MODEL_NAME_MAP: Record<string, string> = {
  small: "Small",
  "medium-q5_0": "Medium",
  "large-v3-q5_0": "Large V3 Compressed",
  "large-v3-turbo": "Large V3 Turbo",
  "large-v3": "Large V3",
};

export function getWhisperDisplayName(modelName: string) {
  if (BASIC_WHISPER_MODEL_NAMES.includes(modelName)) {
    return WHISPER_MODEL_NAME_MAP[modelName] || modelName;
  }

  return `Whisper ${modelName}`;
}

export function getWhisperModelGuidance(modelName: string): WhisperModelGuidance {
  const baseName = getModelBaseName(modelName);
  const isQuantized = isQuantizedModel(modelName);

  if (baseName === "large-v3") {
    return {
      bestLabel: isQuantized ? "Best lower-memory accuracy option" : "Best raw offline accuracy",
      pros: [
        "Strongest choice for important post-meeting retranscription.",
        isQuantized
          ? "Lower memory footprint than full precision Large V3."
          : "Highest quality Whisper option in this list.",
      ],
      cons: [
        "Slowest local Whisper path.",
        isQuantized
          ? "Quantization can lose some detail versus full precision."
          : "Largest download and memory requirement.",
      ],
    };
  }

  if (baseName === "large-v3-turbo") {
    return {
      bestLabel: "Best speed/accuracy compromise",
      pros: [
        "Good choice when Large V3 is too slow.",
        "Keeps high accuracy while improving turnaround time.",
      ],
      cons: [
        "Not the absolute highest-accuracy option.",
        "Still heavier than Small or Medium quantized models.",
      ],
    };
  }

  if (baseName === "medium") {
    return {
      bestLabel: "Best balanced smaller fallback",
      pros: [
        "Solid quality without the Large model footprint.",
        "Reasonable fallback for regular offline cleanup.",
      ],
      cons: [
        "Less accurate than Large V3 on technical terms.",
        "Still not as quick as Small/Base-class models.",
      ],
    };
  }

  if (baseName === "small") {
    return {
      bestLabel: "Best lightweight Whisper option",
      pros: [
        "Faster and smaller than Medium or Large models.",
        "Useful for quick rough retranscription.",
      ],
      cons: [
        "More likely to miss technical names and nuance.",
        "Not ideal for important meeting records.",
      ],
    };
  }

  return {
    bestLabel: "Fastest Whisper fallback",
    pros: [
      "Small footprint and quick turnaround.",
      "Useful when speed matters more than transcript fidelity.",
    ],
    cons: [
      "Lower accuracy than the larger Whisper models.",
      "Use only for rough transcript passes.",
    ],
  };
}
