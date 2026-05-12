use std::net::IpAddr;

use reqwest::header::HeaderValue;
use tauri::http::StatusCode;

use super::{WebClipImageProxyContext, PROXY_SCHEME};

pub(crate) fn original_url_from_proxy_url(value: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(value).ok()?;
    let is_custom_scheme = parsed.scheme() == PROXY_SCHEME;
    let is_windows_alias = parsed.scheme() == "http"
        && parsed
            .host_str()
            .is_some_and(|host| host == "aimd-image-proxy.localhost");
    if !is_custom_scheme && !is_windows_alias {
        return None;
    }
    parsed
        .query_pairs()
        .find_map(|(key, value)| (key == "u").then(|| value.into_owned()))
}

pub(super) fn parse_proxy_request(uri: &str) -> Result<(String, String), (StatusCode, String)> {
    let parsed = reqwest::Url::parse(uri)
        .map_err(|err| (StatusCode::BAD_REQUEST, format!("invalid proxy URL: {err}")))?;
    let path_request_id = parsed
        .path_segments()
        .and_then(|mut segments| segments.next())
        .unwrap_or("")
        .trim()
        .to_string();
    let request_id = parsed
        .query_pairs()
        .find_map(|(key, value)| (key == "requestId").then(|| value.into_owned()))
        .unwrap_or(path_request_id);
    let original_url = parsed
        .query_pairs()
        .find_map(|(key, value)| (key == "u").then(|| value.into_owned()))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing image URL".to_string()))?;
    if request_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "missing requestId".to_string()));
    }
    Ok((request_id, original_url))
}

pub(super) fn validate_proxy_target(url: &reqwest::Url) -> Result<(), String> {
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("only http/https image URLs are allowed".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "image URL missing host".to_string())?;
    let lower = host.trim_end_matches('.').to_ascii_lowercase();
    if lower == "localhost" || lower.ends_with(".localhost") || lower.ends_with(".local") {
        return Err("local host image URLs are blocked".to_string());
    }
    if !lower.contains('.') {
        return Err("single-label image hosts are blocked".to_string());
    }
    if let Ok(ip) = lower.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err("local or private image address is blocked".to_string());
        }
        return Ok(());
    }
    // Do not pre-resolve public hostnames here. Local proxy and VPN setups can return
    // private/fake IPs for public CDN domains, while the actual HTTP client can still
    // fetch them correctly through the configured network path.
    Ok(())
}

pub(super) fn proxy_accept_header() -> HeaderValue {
    HeaderValue::from_static("image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
}

pub(super) fn referer_for_context(context: &WebClipImageProxyContext) -> String {
    if !context.referer.trim().is_empty() {
        return context.referer.clone();
    }
    context.page_url.clone()
}

pub(super) fn header_value(value: &str) -> Option<HeaderValue> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    HeaderValue::from_str(value).ok()
}

pub(super) fn response_content_type(response: &reqwest::Response) -> Option<String> {
    response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(';')
                .next()
                .unwrap_or(value)
                .trim()
                .to_ascii_lowercase()
        })
        .filter(|value| !value.is_empty())
}

pub(super) fn validate_image_response(
    content_type: Option<&str>,
    data: &[u8],
) -> Result<String, String> {
    let sniffed = image_mime_from_bytes(data);
    if let Some(content_type) = content_type {
        if content_type.starts_with("image/") {
            return Ok(content_type.to_string());
        }
        if let Some(mime) = sniffed {
            return Ok(mime.to_string());
        }
        return Err(format!("non-image response: {content_type}"));
    }
    sniffed
        .map(|mime| mime.to_string())
        .ok_or_else(|| "response is not a supported image".to_string())
}

fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_loopback()
                || ip.is_private()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.is_unspecified()
                || ip.is_multicast()
                || ip.octets()[0] == 0
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || ((ip.segments()[0] & 0xfe00) == 0xfc00)
                || ((ip.segments()[0] & 0xffc0) == 0xfe80)
        }
    }
}

fn image_mime_from_bytes(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if data.starts_with(b"\xff\xd8\xff") {
        return Some("image/jpeg");
    }
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    let prefix = String::from_utf8_lossy(&data[..data.len().min(256)]).to_lowercase();
    if prefix.contains("<svg") {
        return Some("image/svg+xml");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_proxy_request_url() {
        let url =
            "aimd-image-proxy://localhost/request-1/image?u=https%3A%2F%2Fcdn.example.com%2Fa.png";
        let (request_id, original) = parse_proxy_request(url).unwrap();
        assert_eq!(request_id, "request-1");
        assert_eq!(original, "https://cdn.example.com/a.png");
        assert_eq!(
            original_url_from_proxy_url(url).as_deref(),
            Some(original.as_str())
        );
    }

    #[test]
    fn blocks_non_http_and_private_targets() {
        assert!(validate_proxy_target(&reqwest::Url::parse("file:///tmp/a.png").unwrap()).is_err());
        assert!(
            validate_proxy_target(&reqwest::Url::parse("http://127.0.0.1/a.png").unwrap()).is_err()
        );
        assert!(
            validate_proxy_target(&reqwest::Url::parse("http://10.0.0.1/a.png").unwrap()).is_err()
        );
        assert!(
            validate_proxy_target(&reqwest::Url::parse("http://localhost/a.png").unwrap()).is_err()
        );
        assert!(
            validate_proxy_target(&reqwest::Url::parse("http://printer/a.png").unwrap()).is_err()
        );
        assert!(
            validate_proxy_target(&reqwest::Url::parse("http://router.local/a.png").unwrap())
                .is_err()
        );
        assert!(validate_proxy_target(
            &reqwest::Url::parse("https://d2908q01vomqb2.cloudfront.net/a.png").unwrap()
        )
        .is_ok());
    }

    #[test]
    fn validates_image_payload_by_content_type_or_magic() {
        assert!(validate_image_response(Some("text/html"), b"<html></html>").is_err());
        assert_eq!(
            validate_image_response(Some("application/octet-stream"), b"\x89PNG\r\n\x1a\nx")
                .unwrap(),
            "image/png"
        );
        assert_eq!(
            validate_image_response(Some("image/jpeg"), b"not really checked").unwrap(),
            "image/jpeg"
        );
    }
}
