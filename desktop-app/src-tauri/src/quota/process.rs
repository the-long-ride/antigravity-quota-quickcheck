pub const CREATE_NO_WINDOW_FLAG: u32 = 0x0800_0000;

pub fn hide_window(command: &mut tokio::process::Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.as_std_mut().creation_flags(CREATE_NO_WINDOW_FLAG);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
    }
}

pub fn hide_std_window(command: &mut std::process::Command) {
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
    hide_window(command);
}

pub fn hide_std_command(command: &mut std::process::Command) {
    hide_std_window(command);
}
