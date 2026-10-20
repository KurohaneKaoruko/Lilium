fn main() {
    let cfg = lilium_server::cli::parse_args();
    if let Err(e) = tokio::runtime::Runtime::new()
        .expect("无法创建 tokio runtime")
        .block_on(lilium_server::serve(cfg))
    {
        eprintln!("错误: {e:#}");
        std::process::exit(1);
    }
}
