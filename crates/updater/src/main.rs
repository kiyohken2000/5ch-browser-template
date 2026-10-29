//! updater の入口。
//!
//! - Windows: Ember と同じフォルダに updater.exe を置いて、Ember を終了した状態で実行する。
//! - macOS: `Ember.app/Contents/MacOS/updater` として同梱してあり、Ember の
//!   「バージョン情報」から Terminal 経由で起動される。
//!
//! ここには標準入出力とプロセス起動だけを置き、判定・検証・差し替えは lib 側にある
//! (そちらは一時ディレクトリに対するユニットテストで検証している)。
//!
//! ダブルクリックや Terminal 経由で起動されると終了と同時にウィンドウが閉じて結果が
//! 読めないので、成否にかかわらず Enter を待ってから終わる。

use std::cell::Cell;
use std::path::{Path, PathBuf};

use ember_updater::{download, UpdateError};

/// 同梱されていた Ember のバージョン。release.sh が Cargo.toml と一緒に更新する。
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

enum Outcome {
    UpToDate,
    /// macOS だけ、更新前に確認を取る (Ember を自動で終了するため)。Windows では使わない
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Cancelled,
    Updated {
        version: String,
        warnings: Vec<String>,
        /// 退避した旧バージョンの置き場所。Windows だけ残す (macOS は差し替え後に消す)
        backup: Option<PathBuf>,
    },
}

fn main() {
    println!("Ember アップデータ (現在のバージョン: v{CURRENT_VERSION})");

    let target = match platform::target() {
        Ok(target) => target,
        Err(e) => {
            eprintln!();
            eprintln!("更新できませんでした: {e}");
            wait_for_enter("Enter を押すと終了します。");
            std::process::exit(1);
        }
    };
    println!("{}: {}", platform::TARGET_LABEL, target.display());
    println!();

    let result = platform::run(&target);
    let mut launch = false;
    match &result {
        Ok(Outcome::UpToDate) => {
            println!("最新版です。更新の必要はありません。");
        }
        Ok(Outcome::Cancelled) => {
            println!("更新を中止しました。ファイルは元のままです。");
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
            if let Some(backup) = backup {
                println!(
                    "旧バージョンは {} に残してあります。問題がなければ削除して構いません。",
                    backup.display()
                );
            }
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
        if let Err(e) = platform::launch(&target) {
            eprintln!("{e}。手動で起動してください。");
        }
    } else {
        wait_for_enter("Enter を押すと終了します。");
    }
    std::process::exit(if result.is_err() { 1 } else { 0 });
}

/// 取得。進捗は 1 MB ごとに同じ行を上書きして出す。
fn download_to(url: &str, dest: &Path) -> Result<(), UpdateError> {
    println!("ダウンロード中: {url}");
    let last_mb = Cell::new(0u64);
    download(url, dest, &|received, total| {
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
    Ok(())
}

fn wait_for_enter(prompt: &str) {
    println!("{prompt}");
    let mut line = String::new();
    let _ = std::io::stdin().read_line(&mut line);
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;

    use std::fs;
    use std::process::Command;

    use ember_updater::{
        apply_update, asset_url, ensure_dir_writable, ensure_ember_not_running, extract_zip,
        fetch_metadata, is_newer, parse_metadata, staged_files, verify_download, EMBER_EXE,
        METADATA_URL,
    };

    pub const TARGET_LABEL: &str = "対象フォルダ";

    /// updater.exe の置き場所。Ember と同じフォルダに置いて使う。
    pub fn target() -> Result<PathBuf, UpdateError> {
        let exe = std::env::current_exe()
            .map_err(|e| UpdateError::Io(format!("自身の場所を特定できません: {e}")))?;
        exe.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| UpdateError::Io("自身の置き場所を特定できません".to_string()))
    }

    pub fn run(install_dir: &Path) -> Result<Outcome, UpdateError> {
        // 既存のファイルに触る前に、触れる状態かどうかだけ先に確かめる
        ensure_ember_not_running(install_dir)?;
        ensure_dir_writable(install_dir)?;

        println!("更新を確認しています...");
        let meta = parse_metadata(&fetch_metadata(METADATA_URL)?)?;
        if !is_newer(CURRENT_VERSION, &meta.version) {
            return Ok(Outcome::UpToDate);
        }
        let asset = meta.platform_asset()?;
        println!("新しいバージョンがあります: v{}", meta.version);

        // 作業用の一時フォルダ。検証が通るまで既存のファイルには一切触らない
        let work = std::env::temp_dir().join(format!("ember-update-{}", meta.version));
        let _ = fs::remove_dir_all(&work);
        fs::create_dir_all(&work)
            .map_err(|e| UpdateError::Io(format!("作業フォルダの作成: {e}")))?;
        let zip = work.join("ember-win-x64.zip");

        download_to(&asset_url(&meta.version)?, &zip)?;

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
            backup: Some(backup),
        })
    }

    pub fn launch(install_dir: &Path) -> Result<(), UpdateError> {
        let exe = install_dir.join(EMBER_EXE);
        Command::new(&exe)
            .current_dir(install_dir)
            .spawn()
            .map(|_| ())
            .map_err(|e| UpdateError::Io(format!("Ember を起動できませんでした ({e})")))
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;

    use std::fs;
    use std::time::Duration;

    use ember_updater::{
        asset_url, ditto_dir, ember_is_running, ensure_bundle_replaceable, extract_app,
        fetch_metadata, is_newer, launch_app, locate_bundle, parse_metadata, replace_bundle,
        request_ember_quit, verify_download, wait_for_ember_exit, ASSET_NAME, METADATA_URL,
    };

    pub const TARGET_LABEL: &str = "対象アプリ";

    /// 同梱されている `Ember.app`。updater はバンドルの中にいるので、そこから割り出す。
    pub fn target() -> Result<PathBuf, UpdateError> {
        let exe = std::env::current_exe()
            .map_err(|e| UpdateError::Io(format!("自身の場所を特定できません: {e}")))?;
        locate_bundle(&exe)
    }

    pub fn run(bundle: &Path) -> Result<Outcome, UpdateError> {
        // 既存のバンドルに触る前に、触れる状態かどうかだけ先に確かめる
        ensure_bundle_replaceable(bundle)?;

        println!("更新を確認しています...");
        let meta = parse_metadata(&fetch_metadata(METADATA_URL)?)?;
        if !is_newer(CURRENT_VERSION, &meta.version) {
            return Ok(Outcome::UpToDate);
        }
        let asset = meta.platform_asset()?;
        println!("新しいバージョンがあります: v{}", meta.version);
        println!();
        // Ember を自動で終了するので、確認だけのつもりで押した人を驚かせないよう一度聞く
        if !confirm(
            "更新しますか? Ember を終了してから入れ替え、終わったら起動します。\n続けるなら Enter、やめるなら n を入れて Enter:",
        ) {
            return Ok(Outcome::Cancelled);
        }
        println!();

        // 作業用の一時フォルダ。検証が通るまで既存のバンドルには一切触らない
        let work = std::env::temp_dir().join(format!("ember-update-{}", meta.version));
        let _ = fs::remove_dir_all(&work);
        fs::create_dir_all(&work)
            .map_err(|e| UpdateError::Io(format!("作業フォルダの作成: {e}")))?;
        let zip = work.join(ASSET_NAME);

        download_to(&asset_url(&meta.version)?, &zip)?;

        println!("ファイルを検証しています...");
        verify_download(&zip, &asset.sha256, asset.size)?;

        println!("展開しています...");
        let staged = extract_app(&zip, &work)?;

        // Ember を止めるのはここまで済んでから。最新版だったときや、取得・検証で
        // 失敗したときに Ember を落としてしまわないようにするため
        if ember_is_running() {
            println!("Ember を終了しています...");
            request_ember_quit();
            if !wait_for_ember_exit(Duration::from_secs(20)) {
                // 終了要求は Apple イベントなので、macOS の許可を断られると届かない。
                // 取得と検証はもう済んでいるので、ここで諦めず手で終了してもらう
                println!();
                wait_for_enter(
                    "Ember を自動で終了できませんでした。Ember を終了してから Enter を押してください。",
                );
                if !wait_for_ember_exit(Duration::from_secs(20)) {
                    return Err(UpdateError::Blocked(
                        "Ember が終了していません。終了してから、もう一度実行してください"
                            .to_string(),
                    ));
                }
            }
        }

        println!("アプリを置き換えています...");
        // 退避先は差し替えに失敗したときの巻き戻し用。rename で済ませるため同じ親に置く
        // 必要があり、差し替えが終わったら replace_bundle が消す
        let name = bundle
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Ember.app");
        let backup = bundle.with_file_name(format!("{name}.update-backup-{CURRENT_VERSION}"));
        let warnings = replace_bundle(bundle, &staged, &backup, &ditto_dir)?;

        // 置き換えが終わったら作業フォルダは不要 (失敗しても害は無いので結果は見ない)
        let _ = fs::remove_dir_all(&work);
        Ok(Outcome::Updated {
            version: meta.version,
            warnings,
            backup: None,
        })
    }

    pub fn launch(bundle: &Path) -> Result<(), UpdateError> {
        launch_app(bundle)
    }

    /// Enter か y で続行、それ以外は中止。読めなかったときは中止側に倒す。
    fn confirm(prompt: &str) -> bool {
        println!("{prompt}");
        let mut line = String::new();
        if std::io::stdin().read_line(&mut line).is_err() {
            return false;
        }
        let answer = line.trim().to_ascii_lowercase();
        answer.is_empty() || answer == "y" || answer == "yes"
    }
}
