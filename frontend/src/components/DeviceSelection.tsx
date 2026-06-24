import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RefreshCw, Mic, Speaker } from "lucide-react";
import { AudioLevelMeter, CompactAudioLevelMeter } from "./AudioLevelMeter";
import { AudioBackendSelector } from "./AudioBackendSelector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import Analytics from "@/lib/analytics";

export interface AudioDevice {
  name: string;
  device_type: "Input" | "Output";
}

export interface SelectedDevices {
  micDevice: string | null;
  systemDevice: string | null;
}

export interface AudioLevelData {
  device_name: string;
  device_type: string;
  rms_level: number;
  peak_level: number;
  is_active: boolean;
}

export interface AudioLevelUpdate {
  timestamp: number;
  levels: AudioLevelData[];
}

interface DeviceSelectionProps {
  selectedDevices: SelectedDevices;
  onDeviceChange: (devices: SelectedDevices) => void;
  disabled?: boolean;
}

function DeviceLoadingState() {
  return (
    <div className="p-4 space-y-4">
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
        <div className="h-10 bg-gray-200 rounded mb-3"></div>
        <div className="h-10 bg-gray-200 rounded"></div>
      </div>
    </div>
  );
}

function DeviceSelectionHeader({ refreshing, disabled, onRefresh }: any) {
  return (
    <div className="flex items-center justify-between">
      <h4 className="text-sm font-medium text-gray-900">Audio Devices</h4>
      <div className="flex items-center space-x-2">
        <button
          onClick={onRefresh}
          disabled={refreshing || disabled}
          className="h-8 w-8 p-0 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );
}

function DeviceSelect({
  id,
  label,
  icon,
  value,
  devices,
  defaultLabel,
  disabled,
  onValueChange,
}: any) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <Label htmlFor={id} className="text-sm font-medium text-gray-700">
          {label}
        </Label>
      </div>
      <Select value={value || "default"} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={`Select ${label}`} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">{defaultLabel}</SelectItem>
          {devices.map((device: AudioDevice) => (
            <SelectItem
              key={device.name}
              value={`${device.name} (${device.device_type.toLowerCase()})`}
            >
              {device.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {devices.length === 0 && (
        <p className="text-xs text-gray-500">No {label.toLowerCase()} devices found</p>
      )}
    </div>
  );
}

function InputLevelMeters({ inputDevices, audioLevels, showLevels }: any) {
  if (!showLevels || inputDevices.length === 0) return null;

  return (
    <div className="space-y-2 pt-2 border-t border-gray-100">
      <p className="text-xs text-gray-600 font-medium">Microphone Levels:</p>
      {inputDevices.map((device: AudioDevice) => {
        const levelData = audioLevels.get(device.name);
        return (
          <div key={`level-${device.name}`} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600 truncate max-w-[200px]">{device.name}</span>
              {levelData && (
                <CompactAudioLevelMeter
                  rmsLevel={levelData.rms_level}
                  peakLevel={levelData.peak_level}
                  isActive={levelData.is_active}
                />
              )}
            </div>
            {levelData && (
              <AudioLevelMeter
                rmsLevel={levelData.rms_level}
                peakLevel={levelData.peak_level}
                isActive={levelData.is_active}
                deviceName={device.name}
                size="small"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function DeviceInfoText({ isMonitoring, inputDevices }: any) {
  return (
    <div className="text-xs text-gray-500 space-y-1">
      <p>
        • <strong>Microphone:</strong> Records your voice and ambient sound
      </p>
      <p>
        • <strong>System Audio:</strong> Records computer audio (music, calls, etc.)
      </p>
      {isMonitoring && (
        <p>
          • <strong>Mic Levels:</strong> Green = good, Yellow = loud, Red = too loud
        </p>
      )}
      {!isMonitoring && inputDevices.length > 0 && (
        <p>
          • <strong>Tip:</strong> Click "Test Mic" to check if your microphone is working
        </p>
      )}
    </div>
  );
}

async function stopAudioLevelMonitoring(
  setIsMonitoring: (isMonitoring: boolean) => void,
  setAudioLevels: (levels: Map<string, AudioLevelData>) => void,
) {
  try {
    await invoke("stop_audio_level_monitoring");
    setIsMonitoring(false);
    setAudioLevels(new Map());
    console.log("Stopped audio level monitoring");
  } catch (err) {
    console.error("Failed to stop audio level monitoring:", err);
  }
}

export function DeviceSelection({
  selectedDevices,
  onDeviceChange,
  disabled = false,
}: DeviceSelectionProps) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [audioLevels, setAudioLevels] = useState<Map<string, AudioLevelData>>(new Map());
  const [isMonitoring, setIsMonitoring] = useState(false);
  const showLevels = false;

  // Filter devices by type
  const inputDevices = devices.filter((device) => device.device_type === "Input");
  const outputDevices = devices.filter((device) => device.device_type === "Output");

  // Fetch available audio devices
  const fetchDevices = async () => {
    try {
      setError(null);
      const result = await invoke<AudioDevice[]>("get_audio_devices");
      setDevices(result);
      console.log("Fetched audio devices:", result);
    } catch (err) {
      console.error("Failed to fetch audio devices:", err);
      setError("Failed to load audio devices. Please check your system audio settings.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Load devices on component mount
  useEffect(() => {
    fetchDevices();
  }, []);

  // Set up audio level event listener
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupAudioLevelListener = async () => {
      try {
        unlisten = await listen<AudioLevelUpdate>("audio-levels", (event) => {
          const levelUpdate = event.payload;
          const newLevels = new Map<string, AudioLevelData>();

          levelUpdate.levels.forEach((level) => {
            newLevels.set(level.device_name, level);
          });

          setAudioLevels(newLevels);
        });
      } catch (err) {
        console.error("Failed to setup audio level listener:", err);
      }
    };

    setupAudioLevelListener();

    // Cleanup function
    return () => {
      if (unlisten) {
        unlisten();
      }
      // Stop monitoring when component unmounts
      if (isMonitoring) {
        void stopAudioLevelMonitoring(setIsMonitoring, setAudioLevels);
      }
    };
  }, [isMonitoring]);

  // Handle device refresh
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchDevices();
  };

  // Helper function to detect device category and Bluetooth status
  const getDeviceMetadata = (deviceName: string) => {
    const nameLower = deviceName.toLowerCase();

    // Detect if it's Bluetooth
    const isBluetooth =
      nameLower.includes("airpods") ||
      nameLower.includes("bluetooth") ||
      nameLower.includes("wireless") ||
      nameLower.includes("wh-") || // Sony WH-* series
      nameLower.includes("bt ");

    // Categorize device
    let category = "wired";
    if (deviceName === "default") {
      category = "default";
    } else if (nameLower.includes("airpods")) {
      category = "airpods";
    } else if (isBluetooth) {
      category = "bluetooth";
    }

    return { isBluetooth, category };
  };

  // Handle microphone device selection
  const handleMicDeviceChange = (deviceName: string) => {
    const newDevices = {
      ...selectedDevices,
      micDevice: deviceName === "default" ? null : deviceName,
    };
    onDeviceChange(newDevices);

    // Track device selection analytics with enhanced metadata
    const metadata = getDeviceMetadata(deviceName);
    Analytics.track("microphone_selected", {
      device_category: metadata.category,
      is_bluetooth: metadata.isBluetooth.toString(),
      has_system_audio: (!!selectedDevices.systemDevice).toString(),
    }).catch((err) => console.error("Failed to track microphone selection:", err));
  };

  // Handle system audio device selection
  const handleSystemDeviceChange = (deviceName: string) => {
    const newDevices = {
      ...selectedDevices,
      systemDevice: deviceName === "default" ? null : deviceName,
    };
    onDeviceChange(newDevices);

    // Track device selection analytics with enhanced metadata
    const metadata = getDeviceMetadata(deviceName);
    Analytics.track("system_audio_selected", {
      device_category: metadata.category,
      is_bluetooth: metadata.isBluetooth.toString(),
      has_microphone: (!!selectedDevices.micDevice).toString(),
    }).catch((err) => console.error("Failed to track system audio selection:", err));
  };

  if (loading) {
    return <DeviceLoadingState />;
  }

  return (
    <div className="space-y-4">
      <DeviceSelectionHeader
        refreshing={refreshing}
        disabled={disabled}
        onRefresh={handleRefresh}
      />

      {error && (
        <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <div className="space-y-2">
          <DeviceSelect
            id="mic-selection"
            label="Microphone"
            icon={<Mic className="h-4 w-4 text-gray-600" />}
            value={selectedDevices.micDevice}
            devices={inputDevices}
            defaultLabel="Default Microphone"
            onValueChange={handleMicDeviceChange}
            disabled={disabled}
          />
          <InputLevelMeters
            inputDevices={inputDevices}
            audioLevels={audioLevels}
            showLevels={showLevels}
          />
        </div>

        <div className="space-y-2">
          <DeviceSelect
            id="system-selection"
            label="System Audio"
            icon={<Speaker className="h-4 w-4 text-gray-600" />}
            value={selectedDevices.systemDevice}
            devices={outputDevices}
            defaultLabel="Default System Audio"
            onValueChange={handleSystemDeviceChange}
            disabled={disabled}
          />

          {!disabled && (
            <div className="pt-3 border-t border-gray-100">
              <AudioBackendSelector disabled={disabled} />
            </div>
          )}
        </div>
      </div>

      <DeviceInfoText isMonitoring={isMonitoring} inputDevices={inputDevices} />
    </div>
  );
}
