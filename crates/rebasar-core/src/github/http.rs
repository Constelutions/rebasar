use std::time::Duration;

use ureq::tls::{TlsConfig, TlsProvider};

/// The seam between the GitHub client and the network, so tests never reach GitHub.
pub trait HttpClient: Send + Sync {
    fn post_json(&self, request: &HttpRequest) -> Result<HttpResponse, HttpError>;
}

/// Deliberately not `Debug`: it carries the bearer token.
pub struct HttpRequest {
    pub url: String,
    pub bearer_token: String,
    pub body: String,
}

pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpError(pub String);

pub struct UreqHttpClient {
    agent: ureq::Agent,
}

impl UreqHttpClient {
    pub fn new() -> Self {
        // Schannel on Windows, so corporate root certificates in the OS store are trusted and no
        // second TLS stack ships in the app.
        let config = ureq::Agent::config_builder()
            .tls_config(
                TlsConfig::builder()
                    .provider(TlsProvider::NativeTls)
                    .build(),
            )
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(30)))
            .build();
        Self {
            agent: ureq::Agent::new_with_config(config),
        }
    }
}

impl HttpClient for UreqHttpClient {
    fn post_json(&self, request: &HttpRequest) -> Result<HttpResponse, HttpError> {
        let mut response = self
            .agent
            .post(&request.url)
            .header("Authorization", format!("Bearer {}", request.bearer_token))
            .header("User-Agent", "Rebasar")
            .content_type("application/json")
            .send(request.body.as_str())
            .map_err(|error| HttpError(error.to_string()))?;
        let status = response.status().as_u16();
        let body = response
            .body_mut()
            .read_to_string()
            .map_err(|error| HttpError(error.to_string()))?;
        Ok(HttpResponse { status, body })
    }
}

impl Default for UreqHttpClient {
    fn default() -> Self {
        Self::new()
    }
}
