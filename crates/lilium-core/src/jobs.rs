use std::sync::atomic::{AtomicI64, Ordering};

static COUNTER: AtomicI64 = AtomicI64::new(0);

/// 生成 20 位大写字母数字 ID（Eagle 风格）
pub fn new_id() -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut n = now_nanos() as i64 ^ (COUNTER.fetch_add(1, Ordering::Relaxed) << 20);
    let mut out = String::with_capacity(20);
    for _ in 0..20 {
        out.push(CHARS[(n.rem_euclid(CHARS.len() as i64)) as usize] as char);
        // xorshift
        n ^= n << 13;
        n ^= n >> 7;
        n ^= n << 17;
    }
    out
}

fn now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// 后台缩略图预热队列
#[derive(Clone)]
pub struct JobQueue {
    tx: tokio::sync::mpsc::UnboundedSender<String>,
}

impl JobQueue {
    pub fn new() -> (std::sync::Arc<Self>, tokio::sync::mpsc::UnboundedReceiver<String>) {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        (std::sync::Arc::new(Self { tx }), rx)
    }

    pub fn queue_thumbnail(&self, item_id: String) {
        let _ = self.tx.send(item_id);
    }

    /// 启动 worker：阻塞线程池里逐个生成缩略图
    pub fn spawn_worker(
        queue: std::sync::Arc<Self>,
        mut rx: tokio::sync::mpsc::UnboundedReceiver<String>,
        lib: std::sync::Arc<std::sync::Mutex<crate::Library>>,
    ) {
        tokio::spawn(async move {
            while let Some(id) = rx.recv().await {
                let lib = lib.clone();
                tokio::task::spawn_blocking(move || {
                    let lib = lib.lock().unwrap();
                    if let Err(e) = lib.ensure_thumbnail(&id) {
                        // 标记为失败，避免反复尝试
                        let _ = lib
                            .conn
                            .execute("UPDATE items SET thumb=2 WHERE id=?1", [&id]);
                        tracing::debug!("thumbnail failed for {id}: {e}");
                    }
                })
                .await
                .ok();
            }
        });
        // 保留 queue 引用避免警告
        let _ = queue;
    }
}
