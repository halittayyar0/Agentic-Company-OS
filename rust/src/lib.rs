mod locale;
mod provider;
mod store;

use axum::{
    Form, Router,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get as get_route, post},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use minijinja::{Environment, context};
use provider::{MAX_OUTPUT, MAX_PROMPT_BYTES, MIN_OUTPUT, Provider, Providers};
use serde::{Deserialize, Serialize};
use std::{
    env,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};
use store::{Admission, Store};
use subtle::ConstantTimeEq;
use uuid::Uuid;

type StartupError = Box<dyn std::error::Error>;
type WebResult = Result<Response, StatusCode>;

#[derive(Clone)]
struct AppState {
    origin: String,
    host: String,
    credential: String,
    store: Arc<Mutex<Store>>,
    providers: Arc<Providers>,
}

impl AppState {
    fn new(origin: String, password: &str, store: Store, providers: Providers) -> Self {
        let host = origin
            .strip_prefix("http://")
            .expect("local workbench origin")
            .to_owned();
        Self {
            origin,
            host,
            credential: format!("Basic {}", STANDARD.encode(format!("operator:{password}"))),
            store: Arc::new(Mutex::new(store)),
            providers: Arc::new(providers),
        }
    }

    fn read<T>(&self, op: impl FnOnce(&mut Store) -> rusqlite::Result<T>) -> Result<T, StatusCode> {
        let mut store = self
            .store
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        op(&mut store).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    }
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get_route(desk))
        .route("/tasks", post(start_task))
        .route("/tasks/{id}", get_route(task))
        .route("/tasks/{id}/result.txt", get_route(download_result))
        .route("/assets/workbench.css", get_route(styles))
        .layer(DefaultBodyLimit::max(MAX_PROMPT_BYTES * 3 + 4096))
        .layer(middleware::from_fn_with_state(state.clone(), gate))
        .with_state(state)
}

async fn gate(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let headers = request.headers();
    let mut response = if only_header(headers, header::HOST) != Some(state.host.as_str())
        || request.uri().authority().is_some()
    {
        (StatusCode::FORBIDDEN, "Unrecognized workbench host.").into_response()
    } else if request.method() == Method::POST
        && only_header(headers, header::ORIGIN) != Some(state.origin.as_str())
    {
        (StatusCode::FORBIDDEN, "Unrecognized request origin.").into_response()
    } else if !authorized(headers, &state.credential) {
        let mut response = (
            StatusCode::UNAUTHORIZED,
            "Enter the operator credentials printed in the terminal.",
        )
            .into_response();
        response.headers_mut().insert(
            header::WWW_AUTHENTICATE,
            HeaderValue::from_static(
                "Basic realm=\"Agentic Company OS workbench\", charset=\"UTF-8\"",
            ),
        );
        response
    } else {
        next.run(request).await
    };
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        ),
    );
    headers.insert(
        header::REFERRER_POLICY,
        // Browser form submissions need their same-origin Origin header.
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}

fn only_header(headers: &HeaderMap, name: HeaderName) -> Option<&str> {
    let values = headers.get_all(name);
    let mut iter = values.iter();
    let value = iter.next()?.to_str().ok()?;
    iter.next().is_none().then_some(value)
}

fn authorized(headers: &HeaderMap, expected: &str) -> bool {
    let Some((scheme, presented)) =
        only_header(headers, header::AUTHORIZATION).and_then(|header| header.split_once(' '))
    else {
        return false;
    };
    scheme.eq_ignore_ascii_case("basic")
        && bool::from(presented.as_bytes().ct_eq(&expected.as_bytes()[6..]))
}

async fn styles() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
        include_str!("../templates/workbench.css"),
    )
}

#[derive(Deserialize)]
struct LanguageQuery {
    lang: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct TaskForm {
    request_id: String,
    provider: Provider,
    model: String,
    prompt: String,
    max_output: u16,
    cloud_consent: Option<String>,
}

impl Default for TaskForm {
    fn default() -> Self {
        Self {
            request_id: Uuid::new_v4().to_string(),
            provider: Provider::Ollama,
            model: String::new(),
            prompt: String::new(),
            max_output: 512,
            cloud_consent: None,
        }
    }
}

async fn desk(State(state): State<AppState>, Query(query): Query<LanguageQuery>) -> WebResult {
    let locale = locale::Locale::new(query.lang.as_deref());
    render_desk(&state, locale, TaskForm::default(), None)
}

fn render_desk(
    state: &AppState,
    locale: locale::Locale,
    form: TaskForm,
    error: Option<(&str, StatusCode)>,
) -> WebResult {
    let tasks = state.read(|store| store.recent())?;
    let busy = tasks.iter().any(|task| task.is_running());
    render(
        "desk.html",
        error.map_or(StatusCode::OK, |(_, status)| status),
        context! {
            locale => locale.code(),
            rtl => locale.rtl(),
            languages => locale::LANGUAGES,
            t => locale.copy(),
            tasks => tasks,
            busy => busy,
            error => error.map(|(key, _)| key),
            form => form,
            openrouter => state.providers.configured(Provider::OpenRouter),
            openai => state.providers.configured(Provider::OpenAI),
        },
    )
}

async fn start_task(
    State(state): State<AppState>,
    Query(query): Query<LanguageQuery>,
    Form(mut form): Form<TaskForm>,
) -> WebResult {
    let locale = locale::Locale::new(query.lang.as_deref());
    let invalid = StatusCode::UNPROCESSABLE_ENTITY;
    let Some(id) = Uuid::try_parse(&form.request_id)
        .ok()
        .filter(|id| id.get_version_num() == 4)
    else {
        form.request_id = Uuid::new_v4().to_string();
        return render_desk(&state, locale, form, Some(("invalid_form", invalid)));
    };
    form.prompt = form.prompt.trim().to_owned();
    form.model = form.model.trim().to_owned();
    if !form.provider.accepts_model(&form.model) {
        return render_desk(&state, locale, form, Some(("invalid_model", invalid)));
    }
    if form.prompt.is_empty()
        || form.prompt.len() > MAX_PROMPT_BYTES
        || !(MIN_OUTPUT..=MAX_OUTPUT).contains(&form.max_output)
    {
        return render_desk(&state, locale, form, Some(("invalid_form", invalid)));
    }
    if form.provider.is_remote() && form.cloud_consent.as_deref() != Some("yes") {
        return render_desk(&state, locale, form, Some(("need_consent", invalid)));
    }
    if !state.providers.configured(form.provider) {
        return render_desk(&state, locale, form, Some(("need_key", invalid)));
    }
    let admission = state.read(|store| {
        store.begin(
            id,
            form.provider.key(),
            &form.model,
            &form.prompt,
            form.max_output,
        )
    })?;
    match admission {
        Admission::Created => {
            tokio::spawn(run_task(state, id, form));
        }
        Admission::Busy => {
            return render_desk(&state, locale, form, Some(("busy", StatusCode::CONFLICT)));
        }
        Admission::Existing => (),
    }
    Ok(Redirect::to(&format!("/tasks/{id}?lang={}", locale.code())).into_response())
}

async fn run_task(state: AppState, id: Uuid, form: TaskForm) {
    let completion = state
        .providers
        .complete(form.provider, &form.model, &form.prompt, form.max_output)
        .await;
    let result = state.read(|store| match &completion {
        Ok(completion) => store.complete(id, completion),
        Err(failure) => store.fail(id, failure.key()),
    });
    if result.is_err() {
        eprintln!("Task {id}: could not save outcome. Restart the workbench to recover.");
    }
}

async fn task(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<LanguageQuery>,
) -> WebResult {
    let id = Uuid::try_parse(&id).map_err(|_| StatusCode::NOT_FOUND)?;
    let locale = locale::Locale::new(query.lang.as_deref());
    let task = state
        .read(|store| store.find(id))?
        .ok_or(StatusCode::NOT_FOUND)?;
    render(
        "task.html",
        StatusCode::OK,
        context! {
            locale => locale.code(),
            rtl => locale.rtl(),
            languages => locale::LANGUAGES,
            t => locale.copy(),
            task => task,
        },
    )
}

async fn download_result(State(state): State<AppState>, Path(id): Path<String>) -> WebResult {
    let id = Uuid::try_parse(&id).map_err(|_| StatusCode::NOT_FOUND)?;
    let result = state
        .read(|store| store.find(id))?
        .filter(|task| task.status == "completed")
        .and_then(|task| task.result)
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok((
        [
            (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"task-result.txt\"",
            ),
        ],
        result,
    )
        .into_response())
}

fn render(name: &str, status: StatusCode, data: minijinja::Value) -> WebResult {
    static TEMPLATES: OnceLock<Environment<'static>> = OnceLock::new();
    let templates = TEMPLATES.get_or_init(|| {
        let mut templates = Environment::new();
        for (name, source) in [
            ("base.html", include_str!("../templates/base.html.jinja")),
            ("desk.html", include_str!("../templates/desk.html.jinja")),
            ("task.html", include_str!("../templates/task.html.jinja")),
        ] {
            templates
                .add_template(name, source)
                .expect("valid built-in template");
        }
        templates
    });
    let html = templates
        .get_template(name)
        .and_then(|template| template.render(data))
        .map_err(|error| {
            eprintln!("Workbench template failed: {}", error.kind());
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok((status, Html(html)).into_response())
}

fn port(name: &str, fallback: u16) -> Result<u16, StartupError> {
    match env::var(name) {
        Ok(value) => value
            .parse::<u16>()
            .ok()
            .filter(|port| *port > 0)
            .ok_or_else(|| format!("{name} must be a port between 1 and 65535").into()),
        Err(env::VarError::NotPresent) => Ok(fallback),
        Err(error) => Err(error.into()),
    }
}

pub async fn run() -> Result<(), StartupError> {
    let port_number = port("ACOS_RUST_PORT", 4711)?;
    let ollama_port = port("ACOS_RUST_OLLAMA_PORT", 11434)?;
    let data = if let Some(path) = env::var_os("ACOS_RUST_DATA_DIR") {
        PathBuf::from(path)
    } else {
        directories::ProjectDirs::from("org", "Agentic Company OS", "Rust Workbench")
            .ok_or("Set ACOS_RUST_DATA_DIR to a private directory")?
            .data_local_dir()
            .to_path_buf()
    };
    if data.as_os_str().is_empty() {
        return Err("ACOS_RUST_DATA_DIR must name a private directory".into());
    }
    let listener =
        tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port_number)).await?;
    let store = Store::open(&data)?;
    let providers = Providers::new(
        ollama_port,
        env::var("ACOS_RUST_OPENROUTER_API_KEY").ok(),
        env::var("ACOS_RUST_OPENAI_API_KEY").ok(),
    )?;
    let origin = format!("http://127.0.0.1:{port_number}");
    let password = Uuid::new_v4().simple().to_string();
    let state = AppState::new(origin.clone(), &password, store, providers);
    println!("Agentic Company OS Rust workbench: {origin}");
    println!("Browser username: operator");
    println!("Browser password for this run: {password}");
    println!("Leave this terminal open. Press Ctrl+C to stop.");
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async {
            if tokio::signal::ctrl_c().await.is_err() {
                eprintln!("Could not install the Ctrl+C handler.");
                std::future::pending::<()>().await;
            }
        })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests;
