#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};

#[cfg(target_os = "macos")]
use cidre::{core_audio as ca, os};

#[cfg(target_os = "macos")]
mod apps;
#[cfg(target_os = "macos")]
use self::apps::list_system_audio_using_apps;

/// Event types for system audio detection
#[derive(Debug, Clone)]
pub enum SystemAudioEvent {
    SystemAudioStarted(Vec<String>), // List of apps using system audio
    SystemAudioStopped,
}

pub type SystemAudioCallback = std::sync::Arc<dyn Fn(SystemAudioEvent) + Send + Sync + 'static>;

pub fn new_system_audio_callback<F>(f: F) -> SystemAudioCallback
where
    F: Fn(SystemAudioEvent) + Send + Sync + 'static,
{
    std::sync::Arc::new(f)
}

/// Background task manager for system audio detection
#[derive(Default)]
pub struct BackgroundTask {
    handle: Option<tokio::task::JoinHandle<()>>,
    stop_sender: Option<tokio::sync::oneshot::Sender<()>>,
}

impl BackgroundTask {
    pub fn start<F>(&mut self, task: F)
    where
        F: FnOnce(
                std::sync::Arc<std::sync::atomic::AtomicBool>,
                tokio::sync::oneshot::Receiver<()>,
            ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>
            + Send
            + 'static,
    {
        if self.handle.is_some() {
            return; // Already running
        }

        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel();
        let running = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let running_clone = running.clone();

        let handle = tokio::spawn(async move {
            task(running_clone, stop_rx).await;
        });

        self.handle = Some(handle);
        self.stop_sender = Some(stop_tx);
    }

    pub fn stop(&mut self) {
        if let Some(sender) = self.stop_sender.take() {
            let _ = sender.send(());
        }

        if let Some(handle) = self.handle.take() {
            handle.abort();
        }
    }
}

impl Drop for BackgroundTask {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Detects system audio usage on macOS
#[cfg(target_os = "macos")]
#[derive(Default)]
pub struct MacOSSystemAudioDetector {
    background: BackgroundTask,
}

#[cfg(target_os = "macos")]
const DEVICE_IS_RUNNING_SOMEWHERE: ca::PropAddr = ca::PropAddr {
    selector: ca::PropSelector::DEVICE_IS_RUNNING_SOMEWHERE,
    scope: ca::PropScope::GLOBAL,
    element: ca::PropElement::MAIN,
};

#[cfg(target_os = "macos")]
struct DetectorState {
    last_state: bool,
    last_change: Instant,
    debounce_duration: Duration,
}

#[cfg(target_os = "macos")]
impl DetectorState {
    fn new() -> Self {
        Self {
            last_state: false,
            last_change: Instant::now(),
            debounce_duration: Duration::from_millis(500),
        }
    }

    fn should_trigger(&mut self, new_state: bool) -> bool {
        let now = Instant::now();

        if new_state == self.last_state {
            return false;
        }
        if now.duration_since(self.last_change) < self.debounce_duration {
            return false;
        }

        self.last_state = new_state;
        self.last_change = now;
        true
    }
}

#[cfg(target_os = "macos")]
impl MacOSSystemAudioDetector {
    pub fn start(&mut self, callback: SystemAudioCallback) {
        self.background.start(|running, mut stop_rx| {
            Box::pin(async move {
                let (tx, mut notify_rx) = tokio::sync::mpsc::channel(1);

                spawn_core_audio_listener_thread(callback, tx);

                let _ = notify_rx.recv().await;
                wait_for_detector_stop(running, &mut stop_rx).await;
            })
        });
    }

    pub fn stop(&mut self) {
        self.background.stop();
    }
}

#[cfg(target_os = "macos")]
type SharedCallback = std::sync::Arc<std::sync::Mutex<SystemAudioCallback>>;
#[cfg(target_os = "macos")]
type SharedDevice = std::sync::Arc<std::sync::Mutex<Option<ca::Device>>>;
#[cfg(target_os = "macos")]
type SharedDetectorState = std::sync::Arc<std::sync::Mutex<DetectorState>>;
#[cfg(target_os = "macos")]
type DeviceListenerData = (SharedCallback, SharedDevice, SharedDetectorState);
#[cfg(target_os = "macos")]
type SystemListenerData = (SharedCallback, SharedDevice, SharedDetectorState, *mut ());

#[cfg(target_os = "macos")]
fn spawn_core_audio_listener_thread(
    callback: SystemAudioCallback,
    tx: tokio::sync::mpsc::Sender<()>,
) {
    std::thread::spawn(move || {
        let callback = std::sync::Arc::new(std::sync::Mutex::new(callback));
        let current_device = std::sync::Arc::new(std::sync::Mutex::new(None::<ca::Device>));
        let detector_state = std::sync::Arc::new(std::sync::Mutex::new(DetectorState::new()));

        let device_listener_ptr = create_device_listener_data(
            callback.clone(),
            current_device.clone(),
            detector_state.clone(),
        );
        let system_listener_ptr = create_system_listener_data(
            callback.clone(),
            current_device.clone(),
            detector_state.clone(),
            device_listener_ptr,
        );

        register_system_listener(system_listener_ptr);
        register_initial_device_listener(current_device, detector_state, device_listener_ptr);
        let _ = tx.blocking_send(());

        loop {
            std::thread::park();
        }
    });
}

#[cfg(target_os = "macos")]
async fn wait_for_detector_stop(
    running: std::sync::Arc<std::sync::atomic::AtomicBool>,
    stop_rx: &mut tokio::sync::oneshot::Receiver<()>,
) {
    loop {
        tokio::select! {
            _ = &mut *stop_rx => break,
            _ = tokio::time::sleep(tokio::time::Duration::from_millis(500)) => {
                if !running.load(std::sync::atomic::Ordering::SeqCst) {
                    break;
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
extern "C-unwind" fn device_listener(
    _obj_id: ca::Obj,
    number_addresses: u32,
    addresses: *const ca::PropAddr,
    client_data: *mut (),
) -> os::Status {
    let data = unsafe { &*(client_data as *const DeviceListenerData) };
    let addresses = unsafe { std::slice::from_raw_parts(addresses, number_addresses as usize) };
    handle_device_listener_addresses(&data.0, &data.2, addresses);
    os::Status::NO_ERR
}

#[cfg(target_os = "macos")]
extern "C-unwind" fn system_listener(
    _obj_id: ca::Obj,
    number_addresses: u32,
    addresses: *const ca::PropAddr,
    client_data: *mut (),
) -> os::Status {
    let data = unsafe { &*(client_data as *const SystemListenerData) };
    let addresses = unsafe { std::slice::from_raw_parts(addresses, number_addresses as usize) };
    handle_system_listener_addresses(data, addresses);
    os::Status::NO_ERR
}

#[cfg(target_os = "macos")]
fn handle_device_listener_addresses(
    callback: &SharedCallback,
    state: &SharedDetectorState,
    addresses: &[ca::PropAddr],
) {
    for addr in addresses {
        if addr.selector == ca::PropSelector::DEVICE_IS_RUNNING_SOMEWHERE {
            handle_device_running_change(callback, state);
        }
    }
}

#[cfg(target_os = "macos")]
fn handle_device_running_change(callback: &SharedCallback, state: &SharedDetectorState) {
    let Some(system_audio_active) = default_output_device_active() else {
        return;
    };

    if state
        .lock()
        .map(|mut guard| guard.should_trigger(system_audio_active))
        .unwrap_or(false)
    {
        emit_system_audio_state(
            callback,
            system_audio_active,
            "detect_system_audio_listener",
        );
    }
}

#[cfg(target_os = "macos")]
fn handle_system_listener_addresses(data: &SystemListenerData, addresses: &[ca::PropAddr]) {
    for addr in addresses {
        if addr.selector == ca::PropSelector::HW_DEFAULT_OUTPUT_DEVICE {
            replace_default_output_device_listener(data);
        }
    }
}

#[cfg(target_os = "macos")]
fn replace_default_output_device_listener(data: &SystemListenerData) {
    let current_device = &data.1;
    let state = &data.2;
    let device_listener_data = data.3;

    if let Ok(mut device_guard) = current_device.lock() {
        remove_current_device_listener(&mut device_guard, device_listener_data);
        install_new_default_output_listener(
            &mut device_guard,
            state,
            &data.0,
            device_listener_data,
        );
    }
}

#[cfg(target_os = "macos")]
fn remove_current_device_listener(
    device_guard: &mut Option<ca::Device>,
    device_listener_data: *mut (),
) {
    if let Some(old_device) = device_guard.take() {
        let _ = old_device.remove_prop_listener(
            &DEVICE_IS_RUNNING_SOMEWHERE,
            device_listener,
            device_listener_data,
        );
    }
}

#[cfg(target_os = "macos")]
fn install_new_default_output_listener(
    device_guard: &mut Option<ca::Device>,
    state: &SharedDetectorState,
    callback: &SharedCallback,
    device_listener_data: *mut (),
) {
    if let Ok(new_device) = ca::System::default_output_device() {
        let system_audio_active = device_active(&new_device);
        if add_device_running_listener(&new_device, device_listener_data) {
            *device_guard = Some(new_device);
            maybe_emit_system_listener_started(callback, state, system_audio_active);
        }
    }
}

#[cfg(target_os = "macos")]
fn maybe_emit_system_listener_started(
    callback: &SharedCallback,
    state: &SharedDetectorState,
    system_audio_active: bool,
) {
    if !system_audio_active {
        return;
    }

    if state
        .lock()
        .map(|mut guard| guard.should_trigger(system_audio_active))
        .unwrap_or(false)
    {
        emit_system_audio_state(callback, true, "detect_system_listener");
    }
}

#[cfg(target_os = "macos")]
fn create_device_listener_data(
    callback: SharedCallback,
    current_device: SharedDevice,
    detector_state: SharedDetectorState,
) -> *mut () {
    Box::into_raw(Box::new((callback, current_device, detector_state))) as *mut ()
}

#[cfg(target_os = "macos")]
fn create_system_listener_data(
    callback: SharedCallback,
    current_device: SharedDevice,
    detector_state: SharedDetectorState,
    device_listener_ptr: *mut (),
) -> *mut () {
    Box::into_raw(Box::new((
        callback,
        current_device,
        detector_state,
        device_listener_ptr,
    ))) as *mut ()
}

#[cfg(target_os = "macos")]
fn register_system_listener(system_listener_ptr: *mut ()) {
    if let Err(e) = ca::System::OBJ.add_prop_listener(
        &ca::PropSelector::HW_DEFAULT_OUTPUT_DEVICE.global_addr(),
        system_listener,
        system_listener_ptr,
    ) {
        tracing::error!("adding_system_listener_failed: {:?}", e);
    } else {
        tracing::info!("adding_system_listener_success");
    }
}

#[cfg(target_os = "macos")]
fn register_initial_device_listener(
    current_device: SharedDevice,
    detector_state: SharedDetectorState,
    device_listener_ptr: *mut (),
) {
    if let Ok(device) = ca::System::default_output_device() {
        let system_audio_active = device_active(&device);
        if add_device_running_listener(&device, device_listener_ptr) {
            tracing::info!("adding_device_listener_success");
            if let Ok(mut device_guard) = current_device.lock() {
                *device_guard = Some(device);
            }
            if let Ok(mut state_guard) = detector_state.lock() {
                state_guard.last_state = system_audio_active;
            }
        } else {
            tracing::error!("adding_device_listener_failed");
        }
    } else {
        tracing::warn!("no_default_output_device_found");
    }
}

#[cfg(target_os = "macos")]
fn add_device_running_listener(device: &ca::Device, device_listener_ptr: *mut ()) -> bool {
    device
        .add_prop_listener(
            &DEVICE_IS_RUNNING_SOMEWHERE,
            device_listener,
            device_listener_ptr,
        )
        .is_ok()
}

#[cfg(target_os = "macos")]
fn default_output_device_active() -> Option<bool> {
    ca::System::default_output_device()
        .ok()
        .map(|device| device_active(&device))
}

#[cfg(target_os = "macos")]
fn device_active(device: &ca::Device) -> bool {
    device
        .prop::<u32>(&DEVICE_IS_RUNNING_SOMEWHERE)
        .map(|is_running| is_running != 0)
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn emit_system_audio_state(
    callback: &SharedCallback,
    system_audio_active: bool,
    log_label: &'static str,
) {
    if system_audio_active {
        let callback = callback.clone();
        std::thread::spawn(move || {
            let apps = list_system_audio_using_apps();
            tracing::info!("{}: {:?}", log_label, apps);
            if let Ok(guard) = callback.lock() {
                let event = SystemAudioEvent::SystemAudioStarted(apps);
                tracing::info!(event = ?event, "detected");
                (*guard)(event);
            }
        });
    } else if let Ok(guard) = callback.lock() {
        let event = SystemAudioEvent::SystemAudioStopped;
        tracing::info!(event = ?event, "detected");
        (*guard)(event);
    }
}

// Stub implementation for non-macOS platforms
#[cfg(not(target_os = "macos"))]
pub struct MacOSSystemAudioDetector;

#[cfg(not(target_os = "macos"))]
impl Default for MacOSSystemAudioDetector {
    fn default() -> Self {
        Self
    }
}

#[cfg(not(target_os = "macos"))]
impl MacOSSystemAudioDetector {
    pub fn start(&mut self, _callback: SystemAudioCallback) {
        tracing::warn!("System audio detection is only supported on macOS");
    }

    pub fn stop(&mut self) {}
}

/// Public interface for system audio detection
#[derive(Default)]
pub struct SystemAudioDetector {
    inner: MacOSSystemAudioDetector,
}

impl SystemAudioDetector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start(&mut self, callback: SystemAudioCallback) {
        self.inner.start(callback);
    }

    pub fn stop(&mut self) {
        self.inner.stop();
    }
}

#[cfg(test)]
mod tests;
