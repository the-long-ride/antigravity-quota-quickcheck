#[cfg(target_os = "windows")]
pub const CREATE_NO_WINDOW_FLAG: u32 = 0x0800_0000;

#[cfg(not(target_os = "windows"))]
pub const CREATE_NO_WINDOW_FLAG: u32 = 0;

pub fn hide_std_command(command: &mut std::process::Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW_FLAG);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
    }
}

pub fn hide_tokio_command(command: &mut tokio::process::Command) {
    hide_std_command(command.as_std_mut());
}
