export function parseCutoffSeconds(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parts = trimmed.split(":");
  if (parts.length === 2) {
    return parseMinutesSeconds(parts);
  }

  if (parts.length === 3) {
    return parseHoursMinutesSeconds(parts);
  }

  return null;
}

export function formatRecordingTime(seconds?: number | null) {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) {
    return "--:--";
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function parseMinutesSeconds(parts: string[]) {
  const [rawMinutes, rawSeconds] = parts;
  const minutes = parseIntegerPart(rawMinutes);
  const seconds = parseSecondsPart(rawSeconds);

  if (minutes === null || seconds === null) return null;
  return minutes * 60 + seconds;
}

function parseHoursMinutesSeconds(parts: string[]) {
  const [rawHours, rawMinutes, rawSeconds] = parts;
  const hours = parseIntegerPart(rawHours);
  const minutes = parseIntegerPart(rawMinutes);
  const seconds = parseSecondsPart(rawSeconds);

  if (hours === null || minutes === null || seconds === null) return null;
  if (minutes >= 60) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

function parseIntegerPart(value: string) {
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

function parseSecondsPart(value: string) {
  if (!/^\d+(\.\d+)?$/.test(value)) return null;

  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds >= 60) return null;
  return seconds;
}
