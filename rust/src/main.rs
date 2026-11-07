#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    acos_workbench::run().await
}
