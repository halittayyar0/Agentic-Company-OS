use super::*;
use axum::{
    Json,
    body::{Body, to_bytes},
    http::{HeaderValue, Request},
};
use serde_json::{Value, json};
use std::{
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};
use tower::ServiceExt;

const AUTH: &str = "Basic b3BlcmF0b3I6Zml4dHVyZS1wYXNzd29yZA==";
const HOSTNAME: &str = "127.0.0.1:4711";
const ORIGIN: &str = "http://127.0.0.1:4711";
const FORM: &str = "request_id=95431436-a0de-4b1a-a3fa-d83b941ef470&provider=ollama&model=fixture%3A1b&prompt=Test+prompt&max_output=128";

#[tokio::test]
async fn refuses_a_forged_browser_host() {
    let dir = tempfile::tempdir().unwrap();
    let response = router(test_state(dir.path(), 11434))
        .oneshot(
            Request::builder()
                .uri("/")
                .header("Host", "rebind.invalid:4711")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

fn test_state(dir: &std::path::Path, ollama_port: u16) -> AppState {
    AppState::new(
        ORIGIN.to_owned(),
        "fixture-password",
        store::Store::open(dir).unwrap(),
        provider::Providers::new(ollama_port, None, None).unwrap(),
    )
}

async fn get(app: Router, uri: &str) -> Response {
    app.oneshot(
        Request::builder()
            .uri(uri)
            .header(header::HOST, HOSTNAME)
            .header(header::AUTHORIZATION, AUTH)
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap()
}

async fn submit(app: Router, origin: &str, form: &str) -> Response {
    app.oneshot(
        Request::post("/tasks?lang=tr")
            .header(header::HOST, HOSTNAME)
            .header(header::AUTHORIZATION, AUTH)
            .header(header::ORIGIN, origin)
            .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(Body::from(form.to_owned()))
            .unwrap(),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn auth_and_origin_are_required_and_cloud_needs_consent() {
    let dir = tempfile::tempdir().unwrap();
    let app = router(test_state(dir.path(), 11434));
    let unauthenticated = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/")
                .header(header::HOST, HOSTNAME)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);
    assert!(
        unauthenticated
            .headers()
            .contains_key(header::WWW_AUTHENTICATE)
    );
    assert_eq!(
        submit(app.clone(), "https://elsewhere.invalid", FORM)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        submit(app.clone(), "null", FORM).await.status(),
        StatusCode::FORBIDDEN
    );
    let cloud = FORM
        .replace("provider=ollama", "provider=openrouter")
        .replace("fixture%3A1b", "vendor%2Fmodel");
    let rejected = submit(app.clone(), ORIGIN, &cloud).await;
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error_body = to_bytes(rejected.into_body(), 64_000).await.unwrap();
    assert!(
        String::from_utf8_lossy(&error_body).contains("açıkça onaylayın"),
        "cloud consent must be checked before provider configuration"
    );
    let browser = get(app, "/?lang=ar").await;
    assert_eq!(
        browser.headers()[header::CACHE_CONTROL],
        HeaderValue::from_static("no-store")
    );
    assert_eq!(
        browser.headers()[header::REFERRER_POLICY],
        HeaderValue::from_static("same-origin")
    );
    let page = to_bytes(browser.into_body(), 64_000).await.unwrap();
    assert!(String::from_utf8_lossy(&page).contains("lang=\"ar\" dir=\"rtl\""));
}

#[tokio::test]
async fn one_local_inference_saves_escaped_output_and_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = Arc::clone(&calls);
    let fixture = Router::new()
        .route(
            "/api/version",
            get_route(|| async { Json(json!({"version":"0.40.3"})) }),
        )
        .route(
            "/api/show",
            post(|Json(body): Json<Value>| async move {
                assert_eq!(body["model"], "fixture:1b:local");
                Json(json!({"capabilities":["completion"]}))
            }),
        )
        .route(
            "/api/chat",
            post(move |Json(body): Json<Value>| {
                let observed = Arc::clone(&observed);
                async move {
                    observed.fetch_add(1, Ordering::SeqCst);
                    assert_eq!(body["model"], "fixture:1b:local");
                    assert_eq!(body["options"]["num_predict"], 128);
                    assert_eq!(body["messages"][0]["content"], "Test prompt");
                    assert!(body.get("tools").is_none());
                    Json(json!({
                        "done":true,
                        "done_reason":"stop",
                        "message":{"role":"assistant","content":"<script>73</script>"},
                        "prompt_eval_count":5,
                        "eval_count":4
                    }))
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let app = router(test_state(dir.path(), port));
    let created = submit(app.clone(), ORIGIN, FORM).await;
    assert_eq!(created.status(), StatusCode::SEE_OTHER);
    let path = created.headers()[header::LOCATION]
        .to_str()
        .unwrap()
        .to_owned();
    let duplicate = submit(app.clone(), ORIGIN, FORM).await;
    assert_eq!(duplicate.headers()[header::LOCATION], path);
    tokio::time::timeout(Duration::from_secs(4), async {
        loop {
            let body = to_bytes(get(app.clone(), &path).await.into_body(), 64_000)
                .await
                .unwrap();
            let body = String::from_utf8_lossy(&body);
            if body.contains("73") {
                assert!(body.contains("Tamamlandı"));
                assert!(!body.contains("<script>73</script>"));
                assert!(body.contains("73&lt;"));
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    let download = get(
        app.clone(),
        &format!("{}/result.txt", path.split_once('?').unwrap().0),
    )
    .await;
    assert_eq!(
        download.headers()[header::CONTENT_TYPE],
        "text/plain; charset=utf-8"
    );
    assert!(
        download.headers()[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .starts_with("attachment;")
    );
    assert_eq!(
        to_bytes(download.into_body(), 1024).await.unwrap().as_ref(),
        b"<script>73</script>"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    drop(app);
    server.abort();
    let restarted = router(test_state(dir.path(), port));
    let page = to_bytes(get(restarted, &path).await.into_body(), 64_000)
        .await
        .unwrap();
    assert!(String::from_utf8_lossy(&page).contains("73&lt;"));
}

#[tokio::test]
async fn remote_ollama_metadata_blocks_dispatch() {
    let fixture = Router::new()
        .route(
            "/api/version",
            get_route(|| async { Json(json!({"version":"0.40.3"})) }),
        )
        .route(
            "/api/show",
            post(|| async {
                Json(json!({
                    "capabilities":["completion"],
                    "remote_host": "https://ollama.com",
                    "remote_model": "fixture-cloud"
                }))
            }),
        )
        .route(
            "/api/chat",
            post(|| async {
                panic!("the app sent instructions despite remote metadata");
                #[allow(unreachable_code)]
                StatusCode::OK
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let providers = provider::Providers::new(port, None, None).unwrap();
    let result = providers
        .complete(Provider::Ollama, "fixture:1b", "must stay local", 128)
        .await;
    assert!(matches!(result, Err(provider::Failure::LocalPolicy)));
    server.abort();
}

#[tokio::test]
async fn each_locale_renders_and_has_the_full_copy_contract() {
    let dir = tempfile::tempdir().unwrap();
    let app = router(test_state(dir.path(), 11434));
    let baseline = locale::Locale::new(Some("en")).copy().as_object().unwrap();
    for language in locale::LANGUAGES {
        let locale = locale::Locale::new(Some(language.code));
        let copy = locale.copy().as_object().unwrap();
        assert_eq!(
            copy.keys().collect::<Vec<_>>(),
            baseline.keys().collect::<Vec<_>>()
        );
        let response = get(app.clone(), &format!("/?lang={}", language.code)).await;
        let page = to_bytes(response.into_body(), 64_000).await.unwrap();
        let page = String::from_utf8_lossy(&page);
        assert!(page.contains(&format!(
            r#"lang="{}" dir="{}""#,
            language.code,
            if locale.rtl() { "rtl" } else { "ltr" }
        )));
        assert!(page.contains(copy["heading"].as_str().unwrap()));
    }
}

#[test]
fn a_second_process_cannot_recover_running_work_or_replay_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = store::Store::open(dir.path()).unwrap();
    let id = Uuid::new_v4();
    assert!(matches!(
        store
            .begin(id, "ollama", "fixture:1b", "once", 128)
            .unwrap(),
        store::Admission::Created
    ));
    assert!(matches!(
        store
            .begin(Uuid::new_v4(), "ollama", "fixture:1b", "busy", 128)
            .unwrap(),
        store::Admission::Busy
    ));
    assert!(store::Store::open(dir.path()).is_err());
    drop(store);
    let mut recovered = store::Store::open(dir.path()).unwrap();
    assert_eq!(recovered.find(id).unwrap().unwrap().status, "interrupted");
    assert!(matches!(
        recovered
            .begin(id, "ollama", "fixture:1b", "once", 128)
            .unwrap(),
        store::Admission::Existing
    ));
}
