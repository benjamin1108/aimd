// macOS 文件关联：把当前 .app bundle 注册成 .aimd / .md / .markdown / .mdx 的
// 默认打开器。非 macOS 平台直接是 no-op。
//
// 这里走 LaunchServices C API，是为了支持"开发模式跑 cargo run 出来的二进制"
// 也能临时注册成 default handler；release 包靠 Info.plist 自带的 UTI 就能挂上。

#[cfg(not(target_os = "macos"))]
pub fn register_default_handlers() {}

#[cfg(target_os = "macos")]
pub fn register_default_handlers() {
    if let Err(err) = imp::register_default_handlers() {
        eprintln!("failed to register file association: {err}");
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use core_foundation::base::{Boolean, OSStatus, TCFType};
    use core_foundation::string::{CFString, CFStringRef};
    use core_foundation::url::{CFURLRef, CFURL};
    use std::path::PathBuf;

    const AIMD_BUNDLE_ID: &str = "org.aimd.desktop";
    const AIMD_UTI: &str = "org.aimd.document";
    const AIMD_EXTENSION: &str = "aimd";
    const MD_EXTENSIONS: &[&str] = &["md", "markdown", "mdx"];
    const LS_ROLES_ALL: u32 = u32::MAX;

    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        static kUTTagClassFilenameExtension: CFStringRef;
        fn LSRegisterURL(url: CFURLRef, update: Boolean) -> OSStatus;
        fn LSSetDefaultRoleHandlerForContentType(
            content_type: CFStringRef,
            role: u32,
            handler_bundle_id: CFStringRef,
        ) -> OSStatus;
        fn UTTypeCreatePreferredIdentifierForTag(
            tag_class: CFStringRef,
            tag: CFStringRef,
            conforming_to_uti: CFStringRef,
        ) -> CFStringRef;
    }

    pub fn register_default_handlers() -> Result<(), String> {
        if let Some(bundle) = current_app_bundle() {
            register_bundle(&bundle)?;
        }
        let bundle_id = CFString::new(AIMD_BUNDLE_ID);
        let aimd_uti = CFString::new(AIMD_UTI);
        set_default_handler(&aimd_uti, &bundle_id)?;
        if let Some(extension_uti) = preferred_uti_for_extension(AIMD_EXTENSION) {
            set_default_handler(&extension_uti, &bundle_id)?;
        }
        for ext in MD_EXTENSIONS {
            if let Some(extension_uti) = preferred_uti_for_extension(ext) {
                if let Err(err) = set_default_handler(&extension_uti, &bundle_id) {
                    eprintln!("failed to register .{ext} association: {err}");
                }
            }
        }
        Ok(())
    }

    fn current_app_bundle() -> Option<PathBuf> {
        let mut path = std::env::current_exe().ok()?;
        loop {
            if path.extension().is_some_and(|ext| ext == "app") {
                return Some(path);
            }
            if !path.pop() {
                return None;
            }
        }
    }

    fn register_bundle(bundle: &PathBuf) -> Result<(), String> {
        let url = CFURL::from_path(bundle, true)
            .ok_or_else(|| format!("invalid app bundle path: {}", bundle.display()))?;
        let status = unsafe { LSRegisterURL(url.as_concrete_TypeRef(), true as Boolean) };
        if status == 0 {
            Ok(())
        } else {
            Err(format!(
                "LSRegisterURL({}) returned {status}",
                bundle.display()
            ))
        }
    }

    fn set_default_handler(content_type: &CFString, bundle_id: &CFString) -> Result<(), String> {
        let status = unsafe {
            LSSetDefaultRoleHandlerForContentType(
                content_type.as_concrete_TypeRef(),
                LS_ROLES_ALL,
                bundle_id.as_concrete_TypeRef(),
            )
        };
        if status == 0 {
            Ok(())
        } else {
            Err(format!(
                "LSSetDefaultRoleHandlerForContentType({}) returned {status}",
                content_type
            ))
        }
    }

    fn preferred_uti_for_extension(ext: &str) -> Option<CFString> {
        let ext = CFString::new(ext);
        let uti = unsafe {
            UTTypeCreatePreferredIdentifierForTag(
                kUTTagClassFilenameExtension,
                ext.as_concrete_TypeRef(),
                std::ptr::null(),
            )
        };
        if uti.is_null() {
            None
        } else {
            Some(unsafe { TCFType::wrap_under_create_rule(uti) })
        }
    }
}
