use super::*;

#[test]
fn test_airpods_detection() {
    let kind = InputDeviceKind::detect("AirPods Pro", 0, 0);
    assert_eq!(kind, InputDeviceKind::Bluetooth);
}

#[test]
fn test_builtin_mic_detection() {
    let kind = InputDeviceKind::detect("MacBook Pro Microphone", 0, 0);
    #[cfg(target_os = "macos")]
    assert_eq!(kind, InputDeviceKind::Wired);
    #[cfg(not(target_os = "macos"))]
    assert_eq!(kind, InputDeviceKind::Unknown);
}

#[test]
fn test_bluetooth_by_buffer_size() {
    // 3840 frames at 48kHz = 80ms (Bluetooth-like)
    let kind = InputDeviceKind::detect("Unknown Device", 3840, 48000);
    assert_eq!(kind, InputDeviceKind::Bluetooth);
}

#[test]
fn test_wired_by_buffer_size() {
    // 512 frames at 48kHz = 10.67ms (Wired-like)
    let kind = InputDeviceKind::detect("Unknown Device", 512, 48000);
    assert_eq!(kind, InputDeviceKind::Wired);
}

#[test]
fn test_buffer_timeout_wired() {
    let (min, max) = InputDeviceKind::Wired.buffer_timeout();
    assert_eq!(min, Duration::from_millis(20));
    assert_eq!(max, Duration::from_millis(50));
}

#[test]
fn test_buffer_timeout_bluetooth() {
    let (min, max) = InputDeviceKind::Bluetooth.buffer_timeout();
    assert_eq!(min, Duration::from_millis(80));
    assert_eq!(max, Duration::from_millis(200));
}

#[test]
fn test_calculate_buffer_timeout_bluetooth() {
    // AirPods: 3840 frames at 48kHz = 80ms base
    // With 2x headroom = 160ms
    // Should clamp to 80-200ms range
    let timeout = calculate_buffer_timeout(InputDeviceKind::Bluetooth, 3840, 48000);
    assert!(timeout.abs_diff(Duration::from_millis(160)) <= Duration::from_micros(10));
}

#[test]
fn test_calculate_buffer_timeout_wired() {
    // Built-in: 512 frames at 48kHz = 10.67ms base
    // With 2x headroom = 21.3ms
    // Should clamp to 20-50ms range
    let timeout = calculate_buffer_timeout(InputDeviceKind::Wired, 512, 48000);
    // 21.33ms rounds to 21ms
    assert!(timeout >= Duration::from_millis(20));
    assert!(timeout <= Duration::from_millis(50));
}

#[test]
fn test_virtual_device_detection() {
    let kind = InputDeviceKind::detect("BlackHole 2ch", 0, 0);
    assert_eq!(kind, InputDeviceKind::Wired);
}
