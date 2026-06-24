use super::*;

#[cfg(target_os = "macos")]
pub(super) fn list_system_audio_using_apps() -> Vec<String> {
    match ca::System::processes() {
        Ok(processes) => {
            let mut apps = Vec::new();
            for process in processes {
                if process.is_running_output().unwrap_or(false) {
                    if let Ok(pid) = process.pid() {
                        if let Some(running_app) = cidre::ns::RunningApp::with_pid(pid) {
                            let name = running_app
                                .localized_name()
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| format!("Process {}", pid));
                            apps.push(name);
                        }
                    }
                }
            }
            apps
        }
        Err(_) => Vec::new(),
    }
}
