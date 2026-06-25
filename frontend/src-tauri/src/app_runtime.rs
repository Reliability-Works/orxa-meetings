use std::sync::Arc;

use crate::notifications::commands::NotificationManagerState;
use crate::{
    __cmd__get_audio_devices, __cmd__get_transcription_status, __cmd__is_audio_level_monitoring,
    __cmd__is_recording, __cmd__read_audio_file, __cmd__save_transcript,
    __cmd__set_language_preference, __cmd__start_audio_level_monitoring, __cmd__start_recording,
    __cmd__start_recording_with_devices, __cmd__start_recording_with_devices_and_meeting,
    __cmd__stop_audio_level_monitoring, __cmd__stop_recording,
    __cmd__trigger_microphone_permission, __tauri_command_name_get_audio_devices,
    __tauri_command_name_get_transcription_status, __tauri_command_name_is_audio_level_monitoring,
    __tauri_command_name_is_recording, __tauri_command_name_read_audio_file,
    __tauri_command_name_save_transcript, __tauri_command_name_set_language_preference,
    __tauri_command_name_start_audio_level_monitoring, __tauri_command_name_start_recording,
    __tauri_command_name_start_recording_with_devices,
    __tauri_command_name_start_recording_with_devices_and_meeting,
    __tauri_command_name_stop_audio_level_monitoring, __tauri_command_name_stop_recording,
    __tauri_command_name_trigger_microphone_permission, agent_sources, analytics, anthropic, api,
    askorxa, audio, calendar, chat, console_utils, database, get_audio_devices,
    get_transcription_status, groq, is_audio_level_monitoring, is_recording, local_models, mcp,
    notifications, ollama, onboarding, openai, openrouter, parakeet_engine, read_audio_file,
    save_transcript, set_language_preference, start_audio_level_monitoring, start_recording,
    start_recording_with_devices, start_recording_with_devices_and_meeting, state,
    stop_audio_level_monitoring, stop_recording, summary, tray, trigger_microphone_permission,
    utils, whisper_engine,
};
use tauri::{Manager, Runtime};
use tokio::sync::RwLock;

pub fn run() {
    log::set_max_level(log::LevelFilter::Info);

    app_builder()
        .setup(setup_app)
        .on_window_event(handle_window_event)
        .invoke_handler(command_handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(handle_run_event);
}

fn app_builder() -> tauri::Builder<tauri::Wry> {
    let builder = tauri::Builder::default();
    let builder = configure_single_instance(builder);

    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(whisper_engine::parallel_commands::ParallelProcessorState::new())
        .manage(notification_manager_state())
        .manage(audio::init_system_audio_state())
        .manage(summary::summary_engine::ModelManagerState(Arc::new(
            tokio::sync::Mutex::new(None),
        )))
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
fn configure_single_instance(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        log::info!(
            "Second app instance requested with args: {:?}, cwd: {:?}",
            args,
            cwd
        );
        tray::focus_main_window(app);
    }))
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn configure_single_instance(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}

fn notification_manager_state() -> NotificationManagerState<tauri::Wry> {
    Arc::new(RwLock::new(
        None::<notifications::manager::NotificationManager<tauri::Wry>>,
    )) as NotificationManagerState<tauri::Wry>
}

fn setup_app(app: &mut tauri::App<tauri::Wry>) -> Result<(), Box<dyn std::error::Error>> {
    log::info!("Application setup complete");
    initialize_tray(app.handle());
    calendar::start_calendar_auto_start_watcher(app.handle().clone());
    initialize_notifications(app.handle().clone());
    initialize_transcription_engines(app.handle());
    initialize_summary_model_manager(app.handle().clone());
    initialize_database(app.handle());
    initialize_templates(app.handle());
    Ok(())
}

fn initialize_tray(app: &tauri::AppHandle<tauri::Wry>) {
    if let Err(e) = tray::create_tray(app) {
        log::error!("Failed to create system tray: {}", e);
    }
}

fn initialize_notifications(app: tauri::AppHandle<tauri::Wry>) {
    log::info!("Initializing notification system...");
    tauri::async_runtime::spawn(async move {
        let notif_state = app.state::<NotificationManagerState<tauri::Wry>>();
        match notifications::commands::initialize_notification_manager(app.clone()).await {
            Ok(manager) => store_notification_manager(manager, notif_state).await,
            Err(e) => log::error!("Failed to initialize notification manager: {}", e),
        }
    });
}

async fn store_notification_manager(
    manager: notifications::manager::NotificationManager<tauri::Wry>,
    notif_state: tauri::State<'_, NotificationManagerState<tauri::Wry>>,
) {
    if let Err(e) = manager.set_consent(true).await {
        log::error!("Failed to set initial consent: {}", e);
    }
    if let Err(e) = manager.request_permission().await {
        log::error!("Failed to request initial permission: {}", e);
    }

    let mut state_lock = notif_state.write().await;
    *state_lock = Some(manager);
    log::info!("Notification system initialized with default permissions");
}

fn initialize_transcription_engines(app: &tauri::AppHandle<tauri::Wry>) {
    whisper_engine::commands::set_models_directory(app);
    parakeet_engine::commands::set_models_directory(app);

    tauri::async_runtime::spawn(async {
        if let Err(e) = whisper_engine::commands::whisper_init().await {
            log::error!("Failed to initialize Whisper engine on startup: {}", e);
        }
    });

    tauri::async_runtime::spawn(async {
        if let Err(e) = parakeet_engine::commands::parakeet_init().await {
            log::error!("Failed to initialize Parakeet engine on startup: {}", e);
        }
    });
}

fn initialize_summary_model_manager(app: tauri::AppHandle<tauri::Wry>) {
    tauri::async_runtime::spawn(async move {
        match summary::summary_engine::commands::init_model_manager_at_startup(&app).await {
            Ok(_) => log::info!("ModelManager initialized successfully at startup"),
            Err(e) => {
                log::warn!("Failed to initialize ModelManager at startup: {}", e);
                log::warn!("ModelManager will be lazy-initialized on first use");
            }
        }
    });
}

fn initialize_database(app: &tauri::AppHandle<tauri::Wry>) {
    tauri::async_runtime::block_on(async {
        database::setup::initialize_database_on_startup(app).await
    })
    .expect("Failed to initialize database");
}

fn initialize_templates(app: &tauri::AppHandle<tauri::Wry>) {
    log::info!("Initializing bundled templates directory...");
    match app.path().resource_dir() {
        Ok(resource_path) => {
            let templates_dir = resource_path.join("templates");
            log::info!(
                "Setting bundled templates directory to: {:?}",
                templates_dir
            );
            summary::templates::set_bundled_templates_dir(templates_dir);
        }
        Err(_) => log::warn!("Failed to resolve resource directory for templates"),
    }
}

fn handle_window_event<R: Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" {
            api.prevent_close();
            hide_main_window(window);
        }
    }
}

fn hide_main_window<R: Runtime>(window: &tauri::Window<R>) {
    match window.hide() {
        Ok(_) => log::info!("Main window hidden to tray on close request"),
        Err(e) => log::error!("Failed to hide main window on close request: {}", e),
    }
}

fn handle_run_event(app: &tauri::AppHandle<tauri::Wry>, event: tauri::RunEvent) {
    match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => tray::focus_main_window(app),
        tauri::RunEvent::Exit => cleanup_on_exit(app),
        _ => {}
    }
}

fn cleanup_on_exit(app: &tauri::AppHandle<tauri::Wry>) {
    log::info!("Application exiting, cleaning up resources...");
    tauri::async_runtime::block_on(async {
        cleanup_database(app).await;
        cleanup_sidecar().await;
    });
    log::info!("Application cleanup complete");
}

async fn cleanup_database(app: &tauri::AppHandle<tauri::Wry>) {
    if let Some(app_state) = app.try_state::<state::AppState>() {
        log::info!("Starting database cleanup...");
        match app_state.db_manager.cleanup().await {
            Ok(_) => log::info!("Database cleanup completed successfully"),
            Err(e) => log::error!("Failed to cleanup database: {}", e),
        }
    } else {
        log::warn!("AppState not available for database cleanup (likely first launch)");
    }
}

async fn cleanup_sidecar() {
    log::info!("Cleaning up sidecar...");
    if let Err(e) = summary::summary_engine::force_shutdown_sidecar().await {
        log::error!("Failed to force shutdown sidecar: {}", e);
    }
}

macro_rules! app_command_handler {
    () => {
        tauri::generate_handler![
            start_recording,
            stop_recording,
            is_recording,
            get_transcription_status,
            read_audio_file,
            save_transcript,
            analytics::commands::init_analytics,
            analytics::commands::disable_analytics,
            analytics::commands::track_event,
            analytics::commands::identify_user,
            analytics::commands::track_meeting_started,
            analytics::commands::track_recording_started,
            analytics::commands::track_recording_stopped,
            analytics::commands::track_meeting_deleted,
            analytics::commands::track_settings_changed,
            analytics::commands::track_feature_used,
            analytics::commands::is_analytics_enabled,
            analytics::commands::start_analytics_session,
            analytics::commands::end_analytics_session,
            analytics::commands::track_daily_active_user,
            analytics::commands::track_user_first_launch,
            analytics::commands::is_analytics_session_active,
            analytics::commands::track_summary_generation_started,
            analytics::commands::track_summary_generation_completed,
            analytics::commands::track_summary_regenerated,
            analytics::commands::track_model_changed,
            analytics::commands::track_custom_prompt_used,
            analytics::commands::track_meeting_ended,
            analytics::commands::track_analytics_enabled,
            analytics::commands::track_analytics_disabled,
            analytics::commands::track_analytics_transparency_viewed,
            whisper_engine::commands::whisper_init,
            whisper_engine::commands::whisper_get_available_models,
            whisper_engine::commands::whisper_load_model,
            whisper_engine::commands::whisper_get_current_model,
            whisper_engine::commands::whisper_is_model_loaded,
            whisper_engine::commands::whisper_has_available_models,
            whisper_engine::commands::whisper_validate_model_ready,
            whisper_engine::commands::whisper_transcribe_audio,
            whisper_engine::commands::whisper_get_models_directory,
            whisper_engine::commands::whisper_download_model,
            whisper_engine::commands::whisper_cancel_download,
            whisper_engine::commands::whisper_delete_corrupted_model,
            parakeet_engine::commands::parakeet_init,
            parakeet_engine::commands::parakeet_get_available_models,
            parakeet_engine::commands::parakeet_load_model,
            parakeet_engine::commands::parakeet_get_current_model,
            parakeet_engine::commands::parakeet_is_model_loaded,
            parakeet_engine::commands::parakeet_has_available_models,
            parakeet_engine::commands::parakeet_validate_model_ready,
            parakeet_engine::commands::parakeet_transcribe_audio,
            parakeet_engine::commands::parakeet_get_models_directory,
            parakeet_engine::commands::parakeet_download_model,
            parakeet_engine::commands::parakeet_retry_download,
            parakeet_engine::commands::parakeet_cancel_download,
            parakeet_engine::commands::parakeet_delete_corrupted_model,
            parakeet_engine::commands::open_parakeet_models_folder,
            whisper_engine::parallel_commands::initialize_parallel_processor,
            whisper_engine::parallel_commands::start_parallel_processing,
            whisper_engine::parallel_commands::pause_parallel_processing,
            whisper_engine::parallel_commands::resume_parallel_processing,
            whisper_engine::parallel_commands::stop_parallel_processing,
            whisper_engine::parallel_commands::get_parallel_processing_status,
            whisper_engine::parallel_commands::get_system_resources,
            whisper_engine::parallel_commands::check_resource_constraints,
            whisper_engine::parallel_commands::calculate_optimal_workers,
            whisper_engine::parallel_commands::prepare_audio_chunks,
            whisper_engine::parallel_commands::test_parallel_processing_setup,
            get_audio_devices,
            trigger_microphone_permission,
            start_recording_with_devices,
            start_recording_with_devices_and_meeting,
            start_audio_level_monitoring,
            stop_audio_level_monitoring,
            is_audio_level_monitoring,
            audio::recording_commands::pause_recording,
            audio::recording_commands::resume_recording,
            audio::recording_commands::is_recording_paused,
            audio::recording_commands::get_recording_state,
            audio::recording_commands::get_meeting_folder_path,
            audio::recording_commands::get_transcript_history,
            audio::recording_commands::get_recording_meeting_name,
            audio::recording_commands::poll_audio_device_events,
            audio::recording_commands::get_reconnection_status,
            audio::recording_commands::attempt_device_reconnect,
            audio::recording_commands::get_active_audio_output,
            audio::incremental_saver::recover_audio_from_checkpoints,
            audio::incremental_saver::cleanup_checkpoints,
            audio::incremental_saver::has_audio_checkpoints,
            console_utils::show_console,
            console_utils::hide_console,
            console_utils::toggle_console,
            ollama::get_ollama_models,
            ollama::pull_ollama_model,
            ollama::delete_ollama_model,
            ollama::get_ollama_model_context,
            openai::get_openai_models,
            anthropic::get_anthropic_models,
            groq::get_groq_models,
            api::api_get_meetings,
            api::api_get_meeting_calendar_items,
            api::api_search_transcripts,
            api::api_get_profile,
            api::api_save_profile,
            api::api_update_profile,
            api::api_get_model_config,
            api::api_save_model_config,
            api::api_get_api_key,
            api::api_get_transcript_config,
            api::api_save_transcript_config,
            api::api_get_transcript_api_key,
            api::api_delete_meeting,
            api::api_get_meeting,
            api::api_get_meeting_metadata,
            api::api_get_meeting_transcripts,
            api::api_preview_trim_meeting_transcript,
            api::api_trim_meeting_transcript,
            api::api_trim_meeting_transcript_from_segment,
            api::api_delete_meeting_transcript_segment,
            api::api_save_meeting_title,
            api::api_save_transcript,
            api::open_meeting_folder,
            api::test_backend_connection,
            api::debug_backend_connection,
            api::open_external_url,
            api::api_save_custom_openai_config,
            api::api_get_custom_openai_config,
            api::api_test_custom_openai_connection,
            summary::commands::api_process_transcript,
            summary::commands::api_get_summary,
            summary::commands::api_save_meeting_summary,
            summary::commands::api_get_meeting_summary_language,
            summary::commands::api_save_meeting_summary_language,
            summary::commands::api_get_meeting_detected_summary_language,
            summary::commands::api_save_meeting_detected_summary_language,
            summary::commands::api_detect_transcript_summary_language,
            summary::commands::api_cancel_summary,
            summary::template_commands::api_list_templates,
            summary::template_commands::api_get_template_details,
            summary::template_commands::api_validate_template,
            summary::summary_engine::commands::builtin_ai_list_models,
            summary::summary_engine::commands::builtin_ai_get_model_info,
            summary::summary_engine::commands::builtin_ai_download_model,
            summary::summary_engine::commands::builtin_ai_cancel_download,
            summary::summary_engine::commands::builtin_ai_delete_model,
            summary::summary_engine::commands::builtin_ai_is_model_ready,
            summary::summary_engine::commands::builtin_ai_get_available_summary_model,
            summary::summary_engine::commands::builtin_ai_get_recommended_model,
            local_models::local_model_get_statuses,
            local_models::local_model_download_model,
            local_models::local_model_open_folder,
            openrouter::get_openrouter_models,
            audio::recording_preferences::get_recording_preferences,
            audio::recording_preferences::set_recording_preferences,
            audio::recording_preferences::get_default_recordings_folder_path,
            audio::recording_preferences::open_recordings_folder,
            audio::recording_preferences::select_recording_folder,
            audio::recording_preferences::get_available_audio_backends,
            audio::recording_preferences::get_current_audio_backend,
            audio::recording_preferences::set_audio_backend,
            audio::recording_preferences::get_audio_backend_info,
            calendar::get_calendar_auto_start_preferences,
            calendar::set_calendar_auto_start_preferences,
            calendar::get_calendar_permission_status,
            calendar::request_calendar_permission,
            calendar::list_calendar_events,
            mcp::get_mcp_setup_info,
            mcp::open_mcp_server_folder,
            agent_sources::agent_sources_get_config,
            agent_sources::agent_sources_save_config,
            agent_sources::agent_sources_reindex,
            agent_sources::agent_sources_search,
            agent_sources::agent_sources_activity_on,
            askorxa::ask_orxa_meeting,
            chat::chat_list_sessions,
            chat::chat_create_session,
            chat::chat_get_session,
            chat::chat_send_message,
            chat::chat_get_agent_config,
            chat::chat_save_agent_config,
            set_language_preference,
            notifications::commands::get_notification_settings,
            notifications::commands::set_notification_settings,
            notifications::commands::request_notification_permission,
            notifications::commands::show_notification,
            notifications::commands::show_test_notification,
            notifications::commands::is_dnd_active,
            notifications::commands::get_system_dnd_status,
            notifications::commands::set_manual_dnd,
            notifications::commands::set_notification_consent,
            notifications::commands::clear_notifications,
            notifications::commands::is_notification_system_ready,
            notifications::commands::initialize_notification_manager_manual,
            notifications::commands::test_notification_with_auto_consent,
            notifications::commands::get_notification_stats,
            audio::system_audio_commands::start_system_audio_capture_command,
            audio::system_audio_commands::list_system_audio_devices_command,
            audio::system_audio_commands::check_system_audio_permissions_command,
            audio::system_audio_commands::start_system_audio_monitoring,
            audio::system_audio_commands::stop_system_audio_monitoring,
            audio::system_audio_commands::get_system_audio_monitoring_status,
            audio::permissions::check_screen_recording_permission_command,
            audio::permissions::request_screen_recording_permission_command,
            audio::permissions::trigger_system_audio_permission_command,
            database::commands::check_first_launch,
            database::commands::select_legacy_database_path,
            database::commands::detect_legacy_database,
            database::commands::check_default_legacy_database,
            database::commands::check_homebrew_database,
            database::commands::import_and_initialize_database,
            database::commands::initialize_fresh_database,
            database::commands::get_database_directory,
            database::commands::open_database_folder,
            whisper_engine::commands::open_models_folder,
            onboarding::get_onboarding_status,
            onboarding::save_onboarding_status_cmd,
            onboarding::reset_onboarding_status_cmd,
            onboarding::complete_onboarding,
            #[cfg(target_os = "macos")]
            utils::open_system_settings,
            audio::retranscription::start_retranscription_command,
            audio::retranscription::cancel_retranscription_command,
            audio::retranscription::is_retranscription_in_progress_command,
            audio::import::select_and_validate_audio_command,
            audio::import::validate_audio_file_command,
            audio::import::start_import_audio_command,
            audio::import::cancel_import_command,
            audio::import::is_import_in_progress_command,
        ]
    };
}

fn command_handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    app_command_handler!()
}
