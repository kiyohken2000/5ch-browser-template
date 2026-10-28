//! Ember の半自動アップデータ (Windows 専用)。
//!
//! Ember を終了した状態で updater.exe を実行すると、latest.json のバージョンを見て
//! 新しければ ZIP を取得し、検証してから同じフォルダのファイルを置き換える。
//!
//! 設計上の約束 (崩すと危険なので変更時は理由を残すこと):
//!
//! 1. ダウンロード元の URL は**この定数に焼き込む**。latest.json から URL を読むと、
//!    メタデータを差し替えられる立場の人が任意の配布物を掴ませられる。latest.json から
//!    取るのはバージョン番号だけにして、信頼の根は「GitHub Releases に実際に上がって
//!    いるもの」に固定する。sha256 もメタデータと一緒に流れてくるので、改ざん検知には
//!    ならず破損検知にしかならない (それはそれで必要なので検証はする)。
//! 2. 検証が通るまで既存のファイルには触らない。DL → sha256 → 一時ディレクトリへ展開 →
//!    そのあとで初めて置き換える。
//! 3. 置き換えは「退避 (rename) してからコピー」。途中で失敗したら退避したものを全部
//!    戻す。1 ファイルずつ上書きすると、失敗時に起動しない中途半端な状態が残る。
//!    あわせて、**置き換えるのは ZIP に入っているファイルだけ**にする。Windows 版は
//!    持ち運び配置で、設定・既読・NG・スレキャッシュ・ログが exe の隣の `data` に入る
//!    (core-store の resolve_default_data_dir)。フォルダごと入れ替えるとユーザーの
//!    データを消すので、絶対にそうしないこと。
//! 4. Ember が実行中、またはフォルダに書き込めないときは何もせず終了する。昇格は試さない。

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

/// 更新情報の取得先。Ember 本体の既定の metadataUrl と同じもの。
pub const METADATA_URL: &str = "https://ember-5ch.pages.dev/latest.json";
/// 配布物の取得元 (焼き込み。モジュールドキュメントの 1. を参照)
const RELEASE_BASE: &str = "https://github.com/kiyohken2000/5ch-browser-template/releases/download";
/// 取得するファイル名。latest.json の filename は見るだけで、これ以外は受け付けない。
pub const ASSET_NAME: &str = "ember-win-x64.zip";
/// latest.json の platforms のキー
pub const PLATFORM_KEY: &str = "windows-x64";
pub const EMBER_EXE: &str = "ember.exe";
/// 自分自身。実行中はコピーで上書きできないので、失敗しても更新全体は止めない。
pub const UPDATER_EXE: &str = "updater.exe";
const USER_AGENT: &str = "Monazilla/1.00 Ember-Updater";

#[derive(Debug, Error)]
pub enum UpdateError {
    #[error("更新情報を取得できませんでした: {0}")]
    Metadata(String),
    #[error("更新情報のバージョン表記が不正です: {0}")]
    BadVersion(String),
    #[error("ダウンロードに失敗しました: {0}")]
    Download(String),
    #[error("ダウンロードしたファイルが壊れています (sha256 が一致しません)")]
    Sha256Mismatch,
    #[error("ダウンロードしたファイルのサイズが一致しません (期待 {expected} / 実際 {actual})")]
    SizeMismatch { expected: u64, actual: u64 },
    #[error("ZIP を展開できませんでした: {0}")]
    Extract(String),
    #[error("{0}")]
    Blocked(String),
    #[error("ファイル操作に失敗しました: {0}")]
    Io(String),
}

fn io_err(context: &str, e: std::io::Error) -> UpdateError {
    UpdateError::Io(format!("{context}: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct PlatformAsset {
    pub sha256: String,
    pub size: u64,
    pub filename: String,
}

#[derive(Debug, Deserialize)]
pub struct LatestMetadata {
    pub version: String,
    #[serde(default)]
    pub released_at: String,
    pub platforms: HashMap<String, PlatformAsset>,
}

impl LatestMetadata {
    /// Windows 版の配布物。無ければ更新情報の形が変わったということなので止める。
    pub fn windows_asset(&self) -> Result<&PlatformAsset, UpdateError> {
        let asset = self
            .platforms
            .get(PLATFORM_KEY)
            .ok_or_else(|| UpdateError::Metadata(format!("{PLATFORM_KEY} の情報がありません")))?;
        if asset.filename != ASSET_NAME {
            return Err(UpdateError::Metadata(format!(
                "想定しないファイル名です: {} (期待: {ASSET_NAME})",
                asset.filename
            )));
        }
        Ok(asset)
    }
}

/// バージョン表記は数字とドットだけ。URL へ埋め込む前にこれを通す
/// (`..` や `/` が混ざった表記で別の場所を取得させられないようにする)。
pub fn is_valid_version(v: &str) -> bool {
    version_parts(v).is_some()
}

/// `9.9.10` を `[9, 9, 10]` にする。3 つの数値以外の形は受け付けない。
pub fn version_parts(v: &str) -> Option<[u64; 3]> {
    let mut out = [0u64; 3];
    let mut count = 0;
    for part in v.split('.') {
        if count == 3 || part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        out[count] = part.parse::<u64>().ok()?;
        count += 1;
    }
    if count == 3 {
        Some(out)
    } else {
        None
    }
}

/// 文字列比較ではなく数値で比べる (`9.0.99` < `9.0.100`)。
pub fn is_newer(current: &str, latest: &str) -> bool {
    match (version_parts(current), version_parts(latest)) {
        (Some(c), Some(l)) => l > c,
        _ => false,
    }
}

pub fn parse_metadata(json: &str) -> Result<LatestMetadata, UpdateError> {
    let meta: LatestMetadata =
        serde_json::from_str(json).map_err(|e| UpdateError::Metadata(e.to_string()))?;
    if !is_valid_version(&meta.version) {
        return Err(UpdateError::BadVersion(meta.version));
    }
    Ok(meta)
}

/// 取得先 URL。バージョン以外は定数なので、更新情報を差し替えられても
/// GitHub Releases の実在するタグ以外は掴まされない。
pub fn asset_url(version: &str) -> Result<String, UpdateError> {
    if !is_valid_version(version) {
        return Err(UpdateError::BadVersion(version.to_string()));
    }
    Ok(format!("{RELEASE_BASE}/v{version}/{ASSET_NAME}"))
}

pub fn sha256_file(path: &Path) -> Result<String, UpdateError> {
    let mut file = fs::File::open(path).map_err(|e| io_err("ハッシュ計算", e))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| io_err("ハッシュ計算", e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn verify_download(path: &Path, expected_sha256: &str, expected_size: u64) -> Result<(), UpdateError> {
    let actual_size = fs::metadata(path).map_err(|e| io_err("サイズ確認", e))?.len();
    if actual_size != expected_size {
        return Err(UpdateError::SizeMismatch {
            expected: expected_size,
            actual: actual_size,
        });
    }
    let actual = sha256_file(path)?;
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        return Err(UpdateError::Sha256Mismatch);
    }
    Ok(())
}

/// Ember が動いていないこと。実行中の exe は Windows が書き込みを拒むので、
/// 「書き込み用に開けるか」で判定する (ファイルの中身は変えない)。
/// 読み取り専用・権限不足もここで弾かれるが、どちらも「進んではいけない」ので同じ扱いにする。
pub fn ensure_ember_not_running(install_dir: &Path) -> Result<(), UpdateError> {
    let exe = install_dir.join(EMBER_EXE);
    if !exe.exists() {
        return Err(UpdateError::Blocked(format!(
            "{} が見つかりません。updater.exe は Ember と同じフォルダに置いてください",
            exe.display()
        )));
    }
    match fs::OpenOptions::new().write(true).open(&exe) {
        Ok(f) => {
            drop(f);
            Ok(())
        }
        Err(e) => Err(UpdateError::Blocked(format!(
            "{} を書き換えられません。Ember を終了してから実行してください ({e})",
            exe.display()
        ))),
    }
}

/// フォルダ自体に書けること。ファイル単位の権限とは別に落ちるため個別に見る。
pub fn ensure_dir_writable(install_dir: &Path) -> Result<(), UpdateError> {
    let probe = install_dir.join(".ember-update-probe");
    match fs::File::create(&probe) {
        Ok(f) => {
            drop(f);
            let _ = fs::remove_file(&probe);
            Ok(())
        }
        Err(e) => Err(UpdateError::Blocked(format!(
            "{} に書き込めません。別の場所へ展開し直すか、手動で上書きしてください ({e})",
            install_dir.display()
        ))),
    }
}

/// latest.json を取得する。本文を文字列で返し、解析は parse_metadata に任せる。
pub fn fetch_metadata(url: &str) -> Result<String, UpdateError> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| UpdateError::Metadata(e.to_string()))?;
    let res = client
        .get(url)
        .send()
        .map_err(|e| UpdateError::Metadata(e.to_string()))?;
    if !res.status().is_success() {
        return Err(UpdateError::Metadata(format!("HTTP {}", res.status())));
    }
    res.text().map_err(|e| UpdateError::Metadata(e.to_string()))
}

/// ZIP を取得して dest へ書く。progress(受信済み, 全体) を随時呼ぶ。
pub fn download(url: &str, dest: &Path, progress: &dyn Fn(u64, Option<u64>)) -> Result<(), UpdateError> {
    // 25 MB 前後をまるごと受けるので、API 呼び出し用の 30 秒では足りない。
    // 接続だけ短く切り、全体には上限を置く (無制限のクライアントは作らない)。
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| UpdateError::Download(e.to_string()))?;
    let mut res = client
        .get(url)
        .send()
        .map_err(|e| UpdateError::Download(e.to_string()))?;
    if !res.status().is_success() {
        return Err(UpdateError::Download(format!("HTTP {}", res.status())));
    }
    let total = res.content_length();
    let mut file = fs::File::create(dest).map_err(|e| io_err("保存先の作成", e))?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut received = 0u64;
    loop {
        let n = res
            .read(&mut buf)
            .map_err(|e| UpdateError::Download(e.to_string()))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| io_err("保存", e))?;
        received += n as u64;
        progress(received, total);
    }
    file.flush().map_err(|e| io_err("保存", e))?;
    Ok(())
}

/// ZIP の展開。Windows 10 1803 以降に同梱されている tar.exe を使い、
/// 無い環境では PowerShell の Expand-Archive に落とす (zip クレートは入れない)。
pub fn extract_zip(zip: &Path, dest: &Path) -> Result<(), UpdateError> {
    fs::create_dir_all(dest).map_err(|e| io_err("展開先の作成", e))?;
    let tar = Command::new("tar")
        .arg("-xf")
        .arg(zip)
        .arg("-C")
        .arg(dest)
        .status();
    if let Ok(status) = tar {
        if status.success() {
            return Ok(());
        }
    }
    let ps = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive"])
        .arg("-Path")
        .arg(zip)
        .arg("-DestinationPath")
        .arg(dest)
        .arg("-Force")
        .status()
        .map_err(|e| UpdateError::Extract(e.to_string()))?;
    if !ps.success() {
        return Err(UpdateError::Extract(format!(
            "tar と Expand-Archive の両方が失敗しました (exit {:?})",
            ps.code()
        )));
    }
    Ok(())
}

/// 展開したフォルダ直下のファイル名一覧。サブディレクトリは対象にしない
/// (Windows 版の ZIP はフラットな構成なので、増えていたら想定外として無視する)。
pub fn staged_files(dir: &Path) -> Result<Vec<String>, UpdateError> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| io_err("展開結果の確認", e))? {
        let entry = entry.map_err(|e| io_err("展開結果の確認", e))?;
        let meta = entry.metadata().map_err(|e| io_err("展開結果の確認", e))?;
        if !meta.is_file() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            out.push(name.to_string());
        }
    }
    out.sort();
    Ok(out)
}

/// install_dir のファイルを staged_dir のもので置き換える。
///
/// 既存ファイルは backup_dir へ rename してから新しいものをコピーする。実行中の exe でも
/// rename は通る (同一ボリュームならディレクトリエントリの付け替えなので) ため、
/// 自分自身である updater.exe も置き換えられる。それでも失敗した場合だけは更新全体を
/// 巻き戻さず、警告として返して続ける (本体は新しくなり、updater だけ古いまま残る)。
///
/// 途中で失敗したら、それまでに動かしたものを全部元へ戻してからエラーを返す。
pub fn apply_update(
    install_dir: &Path,
    staged_dir: &Path,
    files: &[String],
    backup_dir: &Path,
) -> Result<Vec<String>, UpdateError> {
    if !files.iter().any(|f| f.eq_ignore_ascii_case(EMBER_EXE)) {
        return Err(UpdateError::Extract(format!(
            "展開結果に {EMBER_EXE} が含まれていません"
        )));
    }
    fs::create_dir_all(backup_dir).map_err(|e| io_err("退避先の作成", e))?;

    // (元の場所, 退避先) と、新規に置いたファイル。失敗時はこれを使って戻す。
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut added: Vec<PathBuf> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    let rollback = |moved: &[(PathBuf, PathBuf)], added: &[PathBuf]| {
        for path in added {
            let _ = fs::remove_file(path);
        }
        for (dst, bak) in moved.iter().rev() {
            let _ = fs::remove_file(dst);
            let _ = fs::rename(bak, dst);
        }
    };

    for name in files {
        let src = staged_dir.join(name);
        let dst = install_dir.join(name);
        let bak = backup_dir.join(name);
        let soft = name.eq_ignore_ascii_case(UPDATER_EXE);

        if dst.exists() {
            if let Err(e) = fs::rename(&dst, &bak) {
                if soft {
                    warnings.push(format!("{name} は置き換えられませんでした ({e})"));
                    continue;
                }
                rollback(&moved, &added);
                return Err(io_err(&format!("{name} の退避"), e));
            }
            moved.push((dst.clone(), bak.clone()));
        }
        if let Err(e) = fs::copy(&src, &dst) {
            if soft {
                // 退避だけ済んで新しいものを置けていないので、退避を戻してから続ける
                if let Some(pos) = moved.iter().position(|(d, _)| d == &dst) {
                    let (d, b) = moved.remove(pos);
                    let _ = fs::rename(&b, &d);
                }
                warnings.push(format!("{name} は置き換えられませんでした ({e})"));
                continue;
            }
            rollback(&moved, &added);
            return Err(io_err(&format!("{name} の書き込み"), e));
        }
        if !moved.iter().any(|(d, _)| d == &dst) {
            added.push(dst.clone());
        }
    }
    Ok(warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 版数は実在しない 9.x 系にしてある。実在する版数を書くと、次のリリースで
    // check_version_leaks.sh の旧バージョン残留 grep に引っかかって release.sh が止まる。
    const SAMPLE: &str = r#"{
      "version": "9.9.10",
      "released_at": "2026-10-28T10:00:00+09:00",
      "download_page_url": "https://github.com/kiyohken2000/5ch-browser-template/releases/tag/v9.9.10",
      "platforms": {
        "windows-x64": { "sha256": "abc", "size": 123, "filename": "ember-win-x64.zip" },
        "macos-arm64": { "sha256": "def", "size": 456, "filename": "ember-mac-arm64.zip" }
      }
    }"#;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ember-updater-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn write(path: &Path, body: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent");
        }
        fs::write(path, body).expect("write");
    }

    #[test]
    fn parse_metadata_reads_the_windows_asset() {
        let meta = parse_metadata(SAMPLE).expect("parse");
        assert_eq!(meta.version, "9.9.10");
        let asset = meta.windows_asset().expect("asset");
        assert_eq!(asset.filename, ASSET_NAME);
        assert_eq!(asset.size, 123);
    }

    #[test]
    fn parse_metadata_rejects_a_version_that_is_not_a_number() {
        // URL へ埋め込む値なので、ここで止まらないと別の場所を取得させられる
        let json = SAMPLE.replace("\"9.9.10\"", "\"../../evil\"");
        assert!(matches!(parse_metadata(&json), Err(UpdateError::BadVersion(_))));
    }

    #[test]
    fn windows_asset_rejects_an_unexpected_filename() {
        let json = SAMPLE.replace("ember-win-x64.zip", "evil.zip");
        let meta = parse_metadata(&json).expect("parse");
        assert!(matches!(meta.windows_asset(), Err(UpdateError::Metadata(_))));
    }

    #[test]
    fn version_compare_is_numeric_not_lexical() {
        assert!(is_newer("9.9.9", "9.9.10"));
        assert!(is_newer("9.0.99", "9.0.100"));
        assert!(!is_newer("9.9.10", "9.9.9"));
        assert!(!is_newer("9.9.9", "9.9.9"));
        // 壊れた表記では更新しない
        assert!(!is_newer("9.9.9", "latest"));
        assert_eq!(version_parts("9.1"), None);
        assert_eq!(version_parts("9.0.1.2"), None);
    }

    #[test]
    fn asset_url_is_pinned_to_github_releases() {
        assert_eq!(
            asset_url("9.9.10").expect("url"),
            "https://github.com/kiyohken2000/5ch-browser-template/releases/download/v9.9.10/ember-win-x64.zip"
        );
        assert!(asset_url("9.9.10/../evil").is_err());
    }

    #[test]
    fn verify_download_catches_a_broken_file() {
        let dir = temp_dir("verify");
        let file = dir.join("a.zip");
        write(&file, "hello");
        let good = sha256_file(&file).expect("sha");
        assert!(verify_download(&file, &good, 5).is_ok());
        assert!(matches!(
            verify_download(&file, &good, 6),
            Err(UpdateError::SizeMismatch { .. })
        ));
        assert!(matches!(
            verify_download(&file, &"0".repeat(64), 5),
            Err(UpdateError::Sha256Mismatch)
        ));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_update_replaces_files_and_keeps_a_backup() {
        let root = temp_dir("apply");
        let install = root.join("install");
        let staged = root.join("staged");
        let backup = root.join("backup");
        write(&install.join(EMBER_EXE), "old-exe");
        write(&install.join("vulkan-1.dll"), "old-dll");
        // ZIP に入っていないユーザーのファイルは触らない
        write(&install.join("logs.txt"), "user-data");
        write(&staged.join(EMBER_EXE), "new-exe");
        write(&staged.join("vulkan-1.dll"), "new-dll");
        write(&staged.join("added.txt"), "new-file");

        let files = staged_files(&staged).expect("list");
        let warnings = apply_update(&install, &staged, &files, &backup).expect("apply");

        assert!(warnings.is_empty(), "no warnings expected, got {warnings:?}");
        assert_eq!(fs::read_to_string(install.join(EMBER_EXE)).expect("exe"), "new-exe");
        assert_eq!(fs::read_to_string(install.join("vulkan-1.dll")).expect("dll"), "new-dll");
        assert_eq!(fs::read_to_string(install.join("added.txt")).expect("added"), "new-file");
        assert_eq!(fs::read_to_string(install.join("logs.txt")).expect("user"), "user-data");
        assert_eq!(fs::read_to_string(backup.join(EMBER_EXE)).expect("backup"), "old-exe");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn apply_update_rolls_back_when_a_file_cannot_be_written() {
        let root = temp_dir("rollback");
        let install = root.join("install");
        let staged = root.join("staged");
        let backup = root.join("backup");
        write(&install.join(EMBER_EXE), "old-exe");
        write(&install.join("vulkan-1.dll"), "old-dll");
        write(&staged.join(EMBER_EXE), "new-exe");
        write(&staged.join("vulkan-1.dll"), "new-dll");

        // 展開結果に無いファイルを混ぜてコピーを失敗させる (展開が途中で切れた状態)
        let files = vec![
            EMBER_EXE.to_string(),
            "vulkan-1.dll".to_string(),
            "missing.dll".to_string(),
        ];
        let err = apply_update(&install, &staged, &files, &backup).expect_err("should fail");
        assert!(matches!(err, UpdateError::Io(_)), "got {err:?}");

        // 全部元のまま。新しいものは残らない
        assert_eq!(fs::read_to_string(install.join(EMBER_EXE)).expect("exe"), "old-exe");
        assert_eq!(fs::read_to_string(install.join("vulkan-1.dll")).expect("dll"), "old-dll");
        assert!(!install.join("missing.dll").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn apply_update_refuses_an_archive_without_the_app() {
        let root = temp_dir("noexe");
        let install = root.join("install");
        let staged = root.join("staged");
        write(&install.join(EMBER_EXE), "old-exe");
        write(&staged.join("readme.txt"), "nope");
        let files = staged_files(&staged).expect("list");
        let err = apply_update(&install, &staged, &files, &root.join("backup")).expect_err("fail");
        assert!(matches!(err, UpdateError::Extract(_)), "got {err:?}");
        assert_eq!(fs::read_to_string(install.join(EMBER_EXE)).expect("exe"), "old-exe");
        let _ = fs::remove_dir_all(&root);
    }

    // 展開は OS 同梱のコマンド任せなので、実物の ZIP で 1 回通しておく。
    // ZIP の作成に PowerShell を使うため Windows 限定 (Linux の CI では飛ばす)。
    #[cfg(windows)]
    #[test]
    fn extract_zip_unpacks_a_real_archive() {
        let root = temp_dir("extract");
        let src = root.join("src");
        write(&src.join(EMBER_EXE), "exe-body");
        write(&src.join("vulkan-1.dll"), "dll-body");
        let zip = root.join("ember-win-x64.zip");
        let status = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", "Compress-Archive"])
            .arg("-Path")
            .arg(src.join("*"))
            .arg("-DestinationPath")
            .arg(&zip)
            .arg("-Force")
            .status()
            .expect("compress");
        assert!(status.success(), "failed to build the test archive");

        let dest = root.join("extracted");
        extract_zip(&zip, &dest).expect("extract");
        let files = staged_files(&dest).expect("list");
        assert_eq!(files, vec!["ember.exe".to_string(), "vulkan-1.dll".to_string()]);
        assert_eq!(fs::read_to_string(dest.join(EMBER_EXE)).expect("exe"), "exe-body");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn ensure_ember_not_running_reports_a_missing_install() {
        let dir = temp_dir("missing");
        let err = ensure_ember_not_running(&dir).expect_err("fail");
        assert!(matches!(err, UpdateError::Blocked(_)), "got {err:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_dir_writable_accepts_a_normal_directory() {
        let dir = temp_dir("writable");
        assert!(ensure_dir_writable(&dir).is_ok());
        // プローブ用のファイルを残さない
        assert!(!dir.join(".ember-update-probe").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
