//! updater.exe の入口。Ember と同じフォルダに置いて、Ember を終了した状態で実行する。
//!
//! ここには標準入出力とプロセス起動だけを置き、判定・検証・差し替えは lib 側にある
//! (そちらは一時ディレクトリに対するユニットテストで検証している)。
//!
//! ダブルクリックで起動されると終了と同時にコンソールが閉じて結果が読めないので、
//! 成否にかかわらず Enter を待ってから終わる。

use std::cell::Cell;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use ember_updater::{
    apply_update, asset_url, download, ensure_dir_writable, ensure_ember_not_running, extract_zip,
    fetch_metadata, is_newer, parse_metadata, staged_files, verify_download, UpdateError, EMBER_EXE,
    METADATA_URL,
};

/// 同梱されていた Ember のバージョン。release.sh が Cargo.toml と一緒に更新する。
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

enum Outcome {
    UpToDate,
    Updated {
        version: String,
        warnings: Vec<String>,
        backup: PathBuf,
    },
}

fn main() {
    println!("Ember アップデータ (現在のバージョン: v{CURRENT_VERSION})");

    let install_dir = match install_dir() {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!();
            eprintln!("更新できませんでした: {e}");
            wait_for_enter("Enter を押すと終了します。");
            std::process::exit(1);
        }
    };
    println!("対象フォルダ: {}", install_dir.display());
    println!();

    let result = run(&install_dir);
    let mut launch = false;
    match &result {
        Ok(Outcome::UpToDate) => {
            println!("最新版です。更新の必要はありません。");
        }
        Ok(Outcome::Updated {
            version,
            warnings,
            backup,
        }) => {
            println!();
            println!("v{version} へ更新しました。");
            for w in warnings {
                println!("  注意: {w}");
            }
            println!(
                "旧バージョンは {} に残してあります。問題がなければ削除して構いません。",
                backup.display()
            );
            launch = true;
        }
        Err(e) => {
            eprintln!();
            eprintln!("更新できませんでした: {e}");
            eprintln!("ファイルは元のままです。お手数ですが手動での上書きをお願いします。");
        }
    }
    println!();
    if launch {
        wait_for_enter("Enter を押すと Ember を起動します。");
        let exe = install_dir.join(EMBER_EXE);
        if let Err(e) = Command::new(&exe).current_dir(&install_dir).spawn() {
            eprintln!("Ember を起動できませんでした ({e})。手動で起動してください。");
        }
    } else {
        wait_for_enter("Enter を押すと終了します。");
    }
    std::process::exit(if result.is_err() { 1 } else { 0 });
}

fn install_dir() -> Result<PathBuf, UpdateError> {
    let exe = std::env::current_exe()
        .map_err(|e| UpdateError::Io(format!("自身の場所を特定できません: {e}")))?;
    exe.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| UpdateError::Io("自身の置き場所を特定できません".to_string()))
}

fn run(install_dir: &Path) -> Result<Outcome, UpdateError> {
    // 既存のファイルに触る前に、触れる状態かどうかだけ先に確かめる
    ensure_ember_not_running(install_dir)?;
    ensure_dir_writable(install_dir)?;

    println!("更新を確認しています...");
    let meta = parse_metadata(&fetch_metadata(METADATA_URL)?)?;
    if !is_newer(CURRENT_VERSION, &meta.version) {
        return Ok(Outcome::UpToDate);
    }
    let asset = meta.windows_asset()?;
    println!("新しいバージョンがあります: v{}", meta.version);

    // 作業用の一時フォルダ。検証が通るまで既存のファイルには一切触らない
    let work = std::env::temp_dir().join(format!("ember-update-{}", meta.version));
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work).map_err(|e| UpdateError::Io(format!("作業フォルダの作成: {e}")))?;
    let zip = work.join("ember-win-x64.zip");

    let url = asset_url(&meta.version)?;
    println!("ダウンロード中: {url}");
    let last_mb = Cell::new(0u64);
    download(&url, &zip, &|received, total| {
        let mb = received / (1024 * 1024);
        if mb == last_mb.get() {
            return;
        }
        last_mb.set(mb);
        match total {
            Some(t) => print!("\r  {} / {} MB", mb, t / (1024 * 1024)),
            None => print!("\r  {mb} MB"),
        }
        use std::io::Write;
        let _ = std::io::stdout().flush();
    })?;
    println!();

    println!("ファイルを検証しています...");
    verify_download(&zip, &asset.sha256, asset.size)?;

    println!("展開しています...");
    let staged = work.join("extracted");
    let method = extract_zip(&zip, &staged)?;
    println!("  展開方法: {method}");
    let files = staged_files(&staged)?;

    println!("ファイルを置き換えています...");
    let backup = install_dir.join(format!("update-backup-{CURRENT_VERSION}"));
    let warnings = apply_update(install_dir, &staged, &files, &backup)?;

    // 置き換えが終わったら作業フォルダは不要 (失敗しても害は無いので結果は見ない)
    let _ = fs::remove_dir_all(&work);
    Ok(Outcome::Updated {
        version: meta.version,
        warnings,
        backup,
    })
}

fn wait_for_enter(prompt: &str) {
    println!("{prompt}");
    let mut line = String::new();
    let _ = std::io::stdin().read_line(&mut line);
}
