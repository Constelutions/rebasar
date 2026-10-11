use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;

use super::http::{HttpClient, HttpRequest};
use crate::ApiError;

const ENDPOINT: &str = "https://api.github.com/graphql";

#[derive(Deserialize)]
struct Envelope<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Vec<GraphqlError>,
}

#[derive(Deserialize)]
struct GraphqlError {
    message: String,
}

pub fn query<T: DeserializeOwned>(
    http: &dyn HttpClient,
    token: &str,
    query: &str,
    variables: serde_json::Value,
) -> Result<T, ApiError> {
    let request = HttpRequest {
        url: ENDPOINT.to_owned(),
        bearer_token: token.to_owned(),
        body: json!({ "query": query, "variables": variables }).to_string(),
    };
    let response = http
        .post_json(&request)
        .map_err(|error| request_failed(format!("could not reach GitHub: {}", error.0)))?;

    if response.status == 401 {
        return Err(ApiError::GithubTokenRejected);
    }
    if !(200..300).contains(&response.status) {
        return Err(request_failed(format!(
            "GitHub answered HTTP {}",
            response.status
        )));
    }

    let envelope: Envelope<T> = serde_json::from_str(&response.body)
        .map_err(|error| request_failed(format!("unreadable answer from GitHub: {error}")))?;
    if let Some(error) = envelope.errors.into_iter().next() {
        return Err(request_failed(error.message));
    }
    envelope
        .data
        .ok_or_else(|| request_failed("GitHub answered without data".to_owned()))
}

pub fn check_token(http: &dyn HttpClient, token: &str) -> Result<(), ApiError> {
    query::<serde_json::Value>(http, token, "query { viewer { login } }", json!({})).map(|_| ())
}

fn request_failed(message: String) -> ApiError {
    ApiError::GithubRequestFailed { message }
}
