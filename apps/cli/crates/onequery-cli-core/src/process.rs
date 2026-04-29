//! Cross-platform process inspection helpers.

/// Returns whether a process with the given pid appears to be running.
pub fn is_process_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }

    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::Foundation::WAIT_TIMEOUT;
        use windows_sys::Win32::System::Threading::OpenProcess;
        use windows_sys::Win32::System::Threading::PROCESS_SYNCHRONIZE;
        use windows_sys::Win32::System::Threading::WaitForSingleObject;

        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        if handle.is_null() {
            return false;
        }

        let wait_result = unsafe { WaitForSingleObject(handle, 0) };
        let _ = unsafe { CloseHandle(handle) };
        wait_result == WAIT_TIMEOUT
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        false
    }
}
