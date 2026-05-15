use super::*;

#[test]
fn updater_version_comparison_is_semver_triplet_based() {
    assert_eq!(is_newer_version("1.0.2", "1.0.1").unwrap(), true);
    assert_eq!(is_newer_version("1.1.0", "1.0.9").unwrap(), true);
    assert_eq!(is_newer_version("1.0.1", "1.0.1").unwrap(), false);
    assert_eq!(is_newer_version("1.0.0", "1.0.1").unwrap(), false);
    assert!(is_newer_version("1.0.2-beta.1", "1.0.1").is_err());
}

#[test]
fn updater_urls_must_be_https() {
    assert!(validate_https_url("https://github.com/benjamin1108/aimd/releases").is_ok());
    assert!(validate_https_url("http://github.com/benjamin1108/aimd/releases").is_err());
    assert!(validate_https_url("file:///tmp/AIMD.pkg").is_err());
}

#[test]
fn mac_pkg_progress_payload_matches_frontend_contract() {
    let payload = serde_json::to_value(MacPkgDownloadProgress {
        request_id: "upd-test".to_string(),
        version: "1.0.6".to_string(),
        downloaded_bytes: 4096,
        total_bytes: Some(8192),
    })
    .unwrap();

    assert_eq!(payload["requestId"], "upd-test");
    assert_eq!(payload["downloadedBytes"], 4096);
    assert_eq!(payload["totalBytes"], 8192);
    assert!(payload.get("request_id").is_none());
}
