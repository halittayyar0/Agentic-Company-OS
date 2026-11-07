use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{fmt, time::Duration};

const OPENAI_URL: &str = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const MAX_REPLY_BYTES: usize = 256 * 1024;
pub(crate) const MIN_OUTPUT: u16 = 32;
pub(crate) const MAX_OUTPUT: u16 = 2048;
pub(crate) const MAX_PROMPT_BYTES: usize = 12 * 1024;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Provider {
    Ollama,
    OpenRouter,
    OpenAI,
}

impl Provider {
    pub const fn key(self) -> &'static str {
        match self {
            Self::Ollama => "ollama",
            Self::OpenRouter => "openrouter",
            Self::OpenAI => "openai",
        }
    }

    pub const fn is_remote(self) -> bool {
        !matches!(self, Self::Ollama)
    }

    pub fn accepts_model(self, model: &str) -> bool {
        if model.len() > 180 || !model.starts_with(|ch: char| ch.is_ascii_alphanumeric()) {
            return false;
        }
        let valid_part = |part: &str| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        };
        match self {
            Self::OpenAI => valid_part(model),
            Self::Ollama => local_model(model).is_some(),
            Self::OpenRouter => {
                if model.eq_ignore_ascii_case("openrouter/auto") {
                    return false;
                }
                let Some((vendor, rest)) = model.split_once('/') else {
                    return false;
                };
                valid_part(vendor) && rest.split(':').all(valid_part)
            }
        }
    }
}

fn local_model(model: &str) -> Option<String> {
    let (name, tag) = model.split_once(':').unwrap_or((model, "latest"));
    let tag = tag.strip_suffix(":local").unwrap_or(tag);
    let part = |piece: &str| {
        !piece.is_empty()
            && piece != "."
            && piece != ".."
            && piece
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    };
    let lower = tag.to_ascii_lowercase();
    if !name.split('/').all(part)
        || !part(tag)
        || matches!(lower.as_str(), "cloud" | "local")
        || lower.ends_with("-cloud")
    {
        return None;
    }
    Some(format!("{name}:{tag}:local"))
}

pub(crate) struct Completion {
    pub content: String,
    pub tokens: Option<i64>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum Failure {
    Unavailable,
    InvalidReply,
    OutputLimit,
    LocalPolicy,
    Timeout,
}

impl Failure {
    pub const fn key(self) -> &'static str {
        match self {
            Self::Unavailable => "provider_unavailable",
            Self::InvalidReply => "invalid_reply",
            Self::OutputLimit => "output_limit_reached",
            Self::LocalPolicy => "local_policy",
            Self::Timeout => "timeout",
        }
    }
}

impl fmt::Display for Failure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.key())
    }
}

pub(crate) struct Providers {
    http: Client,
    ollama_origin: String,
    openrouter_key: Option<String>,
    openai_key: Option<String>,
}

impl Providers {
    pub fn new(
        ollama_port: u16,
        openrouter_key: Option<String>,
        openai_key: Option<String>,
    ) -> Result<Self, reqwest::Error> {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(120))
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()?;
        Ok(Self {
            http,
            ollama_origin: format!("http://127.0.0.1:{ollama_port}"),
            openrouter_key: configured_key(openrouter_key),
            openai_key: configured_key(openai_key),
        })
    }

    pub fn configured(&self, provider: Provider) -> bool {
        match provider {
            Provider::Ollama => true,
            Provider::OpenRouter => self.openrouter_key.is_some(),
            Provider::OpenAI => self.openai_key.is_some(),
        }
    }

    pub async fn complete(
        &self,
        provider: Provider,
        model: &str,
        prompt: &str,
        max_output: u16,
    ) -> Result<Completion, Failure> {
        tokio::time::timeout(
            Duration::from_secs(120),
            self.send(provider, model, prompt, max_output),
        )
        .await
        .map_err(|_| Failure::Timeout)?
    }

    async fn send(
        &self,
        provider: Provider,
        model: &str,
        prompt: &str,
        max_output: u16,
    ) -> Result<Completion, Failure> {
        let messages = json!([{ "role": "user", "content": prompt }]);
        if matches!(provider, Provider::Ollama) {
            let model = local_model(model).ok_or(Failure::LocalPolicy)?;
            self.verify_local(&model).await?;
            let body = request_json(
                self.http
                    .post(format!("{}/api/chat", self.ollama_origin))
                    .json(&json!({
                        "model": model,
                        "messages": messages,
                        "stream": false,
                        "options": { "num_predict": max_output }
                    })),
            )
            .await?;
            if body["done_reason"] == "length" {
                return Err(Failure::OutputLimit);
            }
            if body["done"] != true || body["done_reason"] != "stop" {
                return Err(Failure::InvalidReply);
            }
            let tokens = count(&body["prompt_eval_count"])
                .zip(count(&body["eval_count"]))
                .and_then(|(input, output)| input.checked_add(output));
            return read_message(&body["message"], tokens);
        }

        let request = self.cloud_request(provider, model, messages, max_output)?;
        let body = request_json(request).await?;
        let first = &body["choices"][0];
        if first["finish_reason"] == "length" {
            return Err(Failure::OutputLimit);
        }
        if first["finish_reason"] != "stop" {
            return Err(Failure::InvalidReply);
        }
        read_message(&first["message"], count(&body["usage"]["total_tokens"]))
    }

    fn cloud_request(
        &self,
        provider: Provider,
        model: &str,
        messages: Value,
        max_output: u16,
    ) -> Result<RequestBuilder, Failure> {
        let request = match provider {
            Provider::OpenAI => self
                .http
                .post(OPENAI_URL)
                .bearer_auth(self.openai_key.as_ref().ok_or(Failure::Unavailable)?)
                .json(&json!({
                    "model": model,
                    "messages": messages,
                    "stream": false,
                    "max_completion_tokens": max_output
                })),
            Provider::OpenRouter => self
                .http
                .post(OPENROUTER_URL)
                .bearer_auth(self.openrouter_key.as_ref().ok_or(Failure::Unavailable)?)
                .json(&json!({
                    "model": model,
                    "messages": messages,
                    "stream": false,
                    "max_tokens": max_output,
                    "provider": { "allow_fallbacks": false, "require_parameters": true }
                })),
            Provider::Ollama => return Err(Failure::LocalPolicy),
        };
        Ok(request)
    }

    async fn verify_local(&self, model: &str) -> Result<(), Failure> {
        let version =
            request_json(self.http.get(format!("{}/api/version", self.ollama_origin))).await?;
        let version = version["version"]
            .as_str()
            .and_then(stable_version)
            .filter(|version| *version >= [0, 40, 3])
            .ok_or(Failure::LocalPolicy)?;
        let show = request_json(
            self.http
                .post(format!("{}/api/show", self.ollama_origin))
                .json(&json!({ "model": model, "verbose": false })),
        )
        .await?;
        let Some(show) = show.as_object() else {
            return Err(Failure::LocalPolicy);
        };
        for field in ["remote_host", "remote_model"] {
            if show
                .get(field)
                .is_some_and(|value| value.as_str() != Some(""))
            {
                return Err(Failure::LocalPolicy);
            }
        }
        if !show
            .get("capabilities")
            .and_then(Value::as_array)
            .is_some_and(|capabilities| capabilities.iter().any(|entry| entry == "completion"))
        {
            return Err(Failure::LocalPolicy);
        }
        if let Some(required) = show
            .get("requires")
            .filter(|value| value.as_str() != Some(""))
            && !required
                .as_str()
                .and_then(stable_version)
                .is_some_and(|required| version >= required)
        {
            return Err(Failure::LocalPolicy);
        }
        Ok(())
    }
}

fn configured_key(value: Option<String>) -> Option<String> {
    value
        .map(|key| key.trim().to_owned())
        .filter(|key| !key.is_empty() && key.bytes().all(|byte| byte.is_ascii_graphic()))
}

fn stable_version(value: &str) -> Option<[u32; 3]> {
    let mut parts = value.split('.');
    let mut result = [0; 3];
    for component in &mut result {
        let part = parts.next()?;
        if part.is_empty()
            || (part.len() > 1 && part.starts_with('0'))
            || !part.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        *component = part.parse().ok()?;
    }
    parts.next().is_none().then_some(result)
}

fn count(value: &Value) -> Option<i64> {
    value.as_i64().filter(|count| *count >= 0)
}

fn read_message(message: &Value, tokens: Option<i64>) -> Result<Completion, Failure> {
    let content = message["content"]
        .as_str()
        .map(str::trim)
        .filter(|content| !content.is_empty())
        .ok_or(Failure::InvalidReply)?;
    if message["role"] != "assistant"
        || message
            .get("tool_calls")
            .is_some_and(|value| !value.is_null() && !value.as_array().is_some_and(Vec::is_empty))
    {
        return Err(Failure::InvalidReply);
    }
    Ok(Completion {
        content: content.to_owned(),
        tokens,
    })
}

async fn request_json(request: RequestBuilder) -> Result<Value, Failure> {
    let mut response = request.send().await.map_err(network_failure)?;
    if !response.status().is_success() {
        return Err(Failure::Unavailable);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_failure)? {
        if chunk.len() > MAX_REPLY_BYTES - bytes.len() {
            return Err(Failure::OutputLimit);
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| Failure::InvalidReply)
}

fn network_failure(error: reqwest::Error) -> Failure {
    if error.is_timeout() {
        Failure::Timeout
    } else {
        Failure::Unavailable
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_cloud_adapters_pin_endpoint_key_model_and_token_cap() {
        let providers = Providers::new(
            11434,
            Some("fixture-router".to_owned()),
            Some("fixture-openai".to_owned()),
        )
        .unwrap();
        for (provider, model, endpoint, token_field, auth) in [
            (
                Provider::OpenAI,
                "fixture-model",
                OPENAI_URL,
                "max_completion_tokens",
                "Bearer fixture-openai",
            ),
            (
                Provider::OpenRouter,
                "fixture/model:free",
                OPENROUTER_URL,
                "max_tokens",
                "Bearer fixture-router",
            ),
        ] {
            let request = providers
                .cloud_request(
                    provider,
                    model,
                    json!([{"role":"user","content":"fixture"}]),
                    256,
                )
                .unwrap()
                .build()
                .unwrap();
            assert_eq!(request.url().as_str(), endpoint);
            assert_eq!(request.headers()[reqwest::header::AUTHORIZATION], auth);
            let payload: Value =
                serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
            assert_eq!(payload["model"], model);
            assert_eq!(payload[token_field], 256);
            assert_eq!(payload["stream"], false);
            assert!(payload.get("models").is_none());
            assert!(payload.get("tools").is_none());
            if matches!(provider, Provider::OpenRouter) {
                assert_eq!(payload["provider"]["allow_fallbacks"], false);
                assert_eq!(payload["provider"]["require_parameters"], true);
            }
        }
        assert!(!Provider::OpenRouter.accepts_model("openrouter/auto"));
        assert!(!Provider::Ollama.accepts_model("fixture:1b-cloud"));
    }
}
