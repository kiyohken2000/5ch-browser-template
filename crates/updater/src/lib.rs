//! Ember の半自動アップデータ (Windows / macOS)。
//!
//! latest.json のバージョンを見て、新しければ配布物を取得し、検証してから中身を
//! 置き換える。置き換える対象は OS で違う:
//!
//! - Windows: Ember を終了した状態で updater.exe を実行すると、同じフォルダのファイルを
//!   1 つずつ置き換える。
//! - macOS: `Ember.app/Contents/MacOS/updater` として同梱してあり、Ember の
//!   「バージョン情報」から Terminal 経由で起動される。ZIP の中の DMG をマウントして
//!   `.app` を取り出し、バンドルごと差し替える (バンドルの横にファイルを置けないため、
//!   Windows のように「隣に置いてダブルクリック」という形にはできない)。
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
#[cfg(target_os = "macos")]
pub const ASSET_NAME: &str = "ember-mac-arm64.zip";
#[cfg(not(target_os = "macos"))]
pub const ASSET_NAME: &str = "ember-win-x64.zip";
/// latest.json の platforms のキー
#[cfg(target_os = "macos")]
pub const PLATFORM_KEY: &str = "macos-arm64";
#[cfg(not(target_os = "macos"))]
pub const PLATFORM_KEY: &str = "windows-x64";
pub const EMBER_EXE: &str = "ember.exe";
/// 自分自身。実行中はコピーで上書きできないので、失敗しても更新全体は止めない。
pub const UPDATER_EXE: &str = "updater.exe";
/// Mac 版の実行ファイル名 (tauri.conf.json の mainBinaryName)
pub const MAIN_BINARY: &str = "ember";
/// Mac 版のバンドル識別子 (tauri.conf.json の identifier)。終了要求に使う。
pub const BUNDLE_ID: &str = "io.ember.browser";
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
    /// 自分が走っている OS 向けの配布物。無ければ更新情報の形が変わったということなので止める。
    pub fn platform_asset(&self) -> Result<&PlatformAsset, UpdateError> {
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

/// ZIP の展開。使った方法の名前を返す (どれで展開できたかを画面に出すため)。
///
/// Windows 10 1803 以降に同梱されている bsdtar (System32 の tar.exe) は ZIP を読めるが、
/// PATH 上に GNU tar (Git for Windows / MSYS など) があるとそちらが先に当たり、ZIP を
/// 読めずに失敗する。まず System32 を絶対パスで試し、次に PATH 上の tar、最後に
/// PowerShell の Expand-Archive に落とす (zip クレートは入れない)。
///
/// 成否は終了コードではなく「ember.exe が出てきたか」で判定する。失敗した試行が中途半端な
/// ファイルを残していることがあるので、試行ごとに展開先を作り直す。
pub fn extract_zip(zip: &Path, dest: &Path) -> Result<&'static str, UpdateError> {
    let system_tar = std::env::var("SystemRoot")
        .map(|root| PathBuf::from(root).join("System32").join("tar.exe"))
        .unwrap_or_else(|_| PathBuf::from(r"C:\Windows\System32\tar.exe"));

    if system_tar.is_file() {
        reset_dir(dest)?;
        if run_tar(&system_tar, zip, dest) && dest.join(EMBER_EXE).is_file() {
            return Ok(r"System32\tar.exe");
        }
    }
    reset_dir(dest)?;
    if run_tar(Path::new("tar"), zip, dest) && dest.join(EMBER_EXE).is_file() {
        return Ok("tar (PATH)");
    }
    reset_dir(dest)?;
    let ps = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive"])
        .arg("-Path")
        .arg(zip)
        .arg("-DestinationPath")
        .arg(dest)
        .arg("-Force")
        .status()
        .map_err(|e| UpdateError::Extract(e.to_string()))?;
    if ps.success() && dest.join(EMBER_EXE).is_file() {
        return Ok("Expand-Archive");
    }
    Err(UpdateError::Extract(format!(
        "tar と Expand-Archive のどちらでも {EMBER_EXE} を取り出せませんでした (Expand-Archive exit {:?})",
        ps.code()
    )))
}

/// 展開先を空の状態にする。前の試行が残したファイルを持ち越さないため。
fn reset_dir(dir: &Path) -> Result<(), UpdateError> {
    let _ = fs::remove_dir_all(dir);
    fs::create_dir_all(dir).map_err(|e| io_err("展開先の作成", e))
}

fn run_tar(tar: &Path, zip: &Path, dest: &Path) -> bool {
    Command::new(tar)
        .arg("-xf")
        .arg(zip)
        .arg("-C")
        .arg(dest)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
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

// ---------------------------------------------------------------------------
// macOS 版の差し替え
//
// Windows 版との違いは配布物の形。Mac 版の ZIP には DMG が 1 個入っていて、その中に
// `.app` が 1 個ある。だから「展開してファイルを置き換える」ではなく
// 「ZIP を展開 → DMG をマウント → .app を取り出す → バンドルごと差し替える」になる。
//
// ユーザーのデータを消さないという約束 (モジュールドキュメントの 3.) は Mac でも同じだが、
// Mac の設定・既読は `~/Library/Application Support` 側にあってバンドルの外なので、
// バンドルを丸ごと入れ替えても消えない。
//
// 実機のコマンドを呼ぶ部分 (unzip / hdiutil / ditto / pgrep / osascript / open) と、
// 「どこを対象にするか」「退避と巻き戻しをどの順でやるか」は分けてある。後者はどの OS
// でもユニットテストで検証できるようにしておきたいため。
// ---------------------------------------------------------------------------

/// `Ember.app/Contents/MacOS/updater` から `Ember.app` を割り出す。
///
/// updater はバンドルに同梱して配るので、置き場所を聞かずに対象を特定できる
/// (`/Applications` 以外に置いている人でも正しく当たる)。バンドルの外に置かれた
/// updater は対象を決められないので断る。
pub fn locate_bundle(updater_exe: &Path) -> Result<PathBuf, UpdateError> {
    let bundle = updater_exe
        .parent() // Contents/MacOS
        .and_then(Path::parent) // Contents
        .and_then(Path::parent) // Ember.app
        .ok_or_else(|| UpdateError::Blocked("アプリの場所を特定できません".to_string()))?;
    if bundle.extension().and_then(|s| s.to_str()) != Some("app") {
        return Err(UpdateError::Blocked(format!(
            "{} はアプリケーションバンドルの中にありません。Ember.app に同梱された updater を実行してください",
            updater_exe.display()
        )));
    }
    Ok(bundle.to_path_buf())
}

/// 差し替えられる状態かを先に確かめる。
///
/// 見るのはバンドル自体ではなく**その親**に書けるかどうか。差し替えは親ディレクトリの中での
/// rename + コピーなので、必要な権限は親のものになる (`/Applications` は管理者ユーザーなら
/// 書けるが、標準ユーザーでは書けない)。昇格は試さない。
pub fn ensure_bundle_replaceable(bundle: &Path) -> Result<(), UpdateError> {
    if !bundle
        .join("Contents")
        .join("MacOS")
        .join(MAIN_BINARY)
        .is_file()
    {
        return Err(UpdateError::Blocked(format!(
            "{} が Ember のアプリに見えません",
            bundle.display()
        )));
    }
    let parent = bundle
        .parent()
        .ok_or_else(|| UpdateError::Blocked("アプリの置き場所を特定できません".to_string()))?;
    let probe = parent.join(".ember-update-probe");
    match fs::File::create(&probe) {
        Ok(f) => {
            drop(f);
            let _ = fs::remove_file(&probe);
            Ok(())
        }
        Err(e) => Err(UpdateError::Blocked(format!(
            "{} に書き込めません。管理者のユーザーで実行するか、手動で入れ替えてください ({e})",
            parent.display()
        ))),
    }
}

/// ZIP の中の DMG をマウントして `.app` を取り出す。返すのは取り出した `.app` の場所。
///
/// マウントは読み取り専用かつ `-nobrowse` (Finder に出さない)。取り出しは `ditto` を使う。
/// バンドルには symlink や拡張属性が入っていて、普通の再帰コピーだと署名が壊れて
/// macOS が起動を拒むため。マウントはどの経路を通っても外す。
pub fn extract_app(zip: &Path, work: &Path) -> Result<PathBuf, UpdateError> {
    let unpacked = work.join("unpacked");
    reset_dir(&unpacked)?;
    let status = Command::new("/usr/bin/unzip")
        .arg("-q")
        .arg("-o")
        .arg(zip)
        .arg("-d")
        .arg(&unpacked)
        .status()
        .map_err(|e| UpdateError::Extract(format!("unzip を実行できません: {e}")))?;
    if !status.success() {
        return Err(UpdateError::Extract(format!(
            "ZIP を展開できませんでした (unzip exit {:?})",
            status.code()
        )));
    }
    let dmg = single_entry(&unpacked, "dmg")?;

    let mount = work.join("mnt");
    let _ = fs::remove_dir_all(&mount);
    fs::create_dir_all(&mount).map_err(|e| io_err("マウント先の作成", e))?;
    let status = Command::new("/usr/bin/hdiutil")
        .args(["attach", "-nobrowse", "-readonly", "-mountpoint"])
        .arg(&mount)
        .arg(&dmg)
        .status()
        .map_err(|e| UpdateError::Extract(format!("hdiutil を実行できません: {e}")))?;
    if !status.success() {
        return Err(UpdateError::Extract(format!(
            "DMG をマウントできませんでした (hdiutil exit {:?})",
            status.code()
        )));
    }

    let staged = work.join("staged");
    let picked = (|| -> Result<PathBuf, UpdateError> {
        let app = single_entry(&mount, "app")?;
        let name = app
            .file_name()
            .ok_or_else(|| UpdateError::Extract("DMG の中のアプリ名を読めません".to_string()))?;
        reset_dir(&staged)?;
        let dest = staged.join(name);
        ditto_dir(&app, &dest)?;
        Ok(dest)
    })();
    let _ = Command::new("/usr/bin/hdiutil")
        .arg("detach")
        .arg(&mount)
        .status();

    let dest = picked?;
    if !dest
        .join("Contents")
        .join("MacOS")
        .join(MAIN_BINARY)
        .is_file()
    {
        return Err(UpdateError::Extract(format!(
            "取り出したアプリに {MAIN_BINARY} が含まれていません"
        )));
    }
    Ok(dest)
}

/// dir の直下から拡張子 ext のものを 1 つだけ拾う。0 個でも 2 個以上でもエラーにする
/// (配布物の形が変わったときに、黙って別のものを掴まないようにするため)。
fn single_entry(dir: &Path, ext: &str) -> Result<PathBuf, UpdateError> {
    let mut found = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| io_err("展開結果の確認", e))? {
        let entry = entry.map_err(|e| io_err("展開結果の確認", e))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some(ext) {
            found.push(path);
        }
    }
    if found.len() == 1 {
        return Ok(found.remove(0));
    }
    Err(UpdateError::Extract(format!(
        "{} の中に .{ext} が {} 個あります (1 個であるはずです)",
        dir.display(),
        found.len()
    )))
}

/// バンドルのコピー。`ditto` は symlink・拡張属性・リソースフォークを保つので、
/// 署名済みのバンドルを壊さずに複製できる (`cp -R` や自前の再帰コピーでは壊れる)。
pub fn ditto_dir(src: &Path, dest: &Path) -> Result<(), UpdateError> {
    let status = Command::new("/usr/bin/ditto")
        .arg(src)
        .arg(dest)
        .status()
        .map_err(|e| UpdateError::Io(format!("ditto を実行できません: {e}")))?;
    if !status.success() {
        return Err(UpdateError::Io(format!(
            "{} のコピーに失敗しました (ditto exit {:?})",
            src.display(),
            status.code()
        )));
    }
    Ok(())
}

/// Ember が動いているか。バンドル内の実行ファイルのパスで見る
/// (updater 自身は `MacOS/updater` なので自分には当たらない)。
pub fn ember_is_running() -> bool {
    Command::new("/usr/bin/pgrep")
        .arg("-f")
        .arg(format!("/Contents/MacOS/{MAIN_BINARY}"))
        .output()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false)
}

/// Ember に終了を頼む。待たないし、失敗しても何も言わない。
///
/// 強制終了 (SIGTERM) は使わない。書き込み途中のお気に入り・既読を壊さないため、
/// AppleScript で正規の終了要求を出す。
///
/// ただしこれは別アプリへの Apple イベントなので、macOS が「Terminal が Ember を
/// 制御しようとしています」の許可を求める。断られると終了要求は届かない。そのため
/// 成否は見ず、落ちたかどうかは [`wait_for_ember_exit`] で別に確かめる
/// (呼び出し側は、届かなかったときに手で終了してもらう道を用意すること)。
pub fn request_ember_quit() {
    let _ = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(format!("tell application id \"{BUNDLE_ID}\" to quit"))
        .status();
}

/// Ember が落ちるまで待つ。落ちたら true、待ち時間を使い切ったら false。
pub fn wait_for_ember_exit(max_wait: Duration) -> bool {
    let step = Duration::from_millis(500);
    let mut waited = Duration::ZERO;
    loop {
        if !ember_is_running() {
            return true;
        }
        if waited >= max_wait {
            return false;
        }
        std::thread::sleep(step);
        waited += step;
    }
}

/// `bundle` を `staged` のバンドルで差し替える。警告があれば返す。
///
/// 退避 (rename) してからコピーする。rename は同じ親ディレクトリの中での付け替えなので
/// 外付けディスクに置かれていても成立し、失敗したら退避したものを戻せる。中身を 1 つずつ
/// 上書きすると、失敗時に起動しない中途半端なバンドルが残るので、絶対にそうしないこと。
///
/// 退避は巻き戻しのためだけに作るので、**差し替えが終わったら消す**。`/Applications` に
/// 使われないバンドルを置いていくと、どちらが本体か分からなくなるため。消せなかった場合は
/// 更新自体は済んでいるので、警告として返して続ける。
///
/// コピーの実体は呼び出し側から渡す。実機では [`ditto_dir`] を使うが、ここで検証したいのは
/// 「退避と巻き戻しの順番」なので、テストでは普通の再帰コピーを渡す。
pub fn replace_bundle(
    bundle: &Path,
    staged: &Path,
    backup: &Path,
    copy: &dyn Fn(&Path, &Path) -> Result<(), UpdateError>,
) -> Result<Vec<String>, UpdateError> {
    if !staged
        .join("Contents")
        .join("MacOS")
        .join(MAIN_BINARY)
        .is_file()
    {
        return Err(UpdateError::Extract(format!(
            "差し替えようとしたアプリに {MAIN_BINARY} が含まれていません"
        )));
    }
    let _ = fs::remove_dir_all(backup);
    let had_old = bundle.exists();
    if had_old {
        fs::rename(bundle, backup).map_err(|e| io_err("旧バージョンの退避", e))?;
    }
    if let Err(e) = copy(staged, bundle) {
        let _ = fs::remove_dir_all(bundle);
        if had_old {
            let _ = fs::rename(backup, bundle);
        }
        return Err(e);
    }
    let mut warnings = Vec::new();
    if had_old {
        if let Err(e) = fs::remove_dir_all(backup) {
            warnings.push(format!(
                "旧バージョン ({}) を削除できませんでした ({e})。手動で削除してください",
                backup.display()
            ));
        }
    }
    Ok(warnings)
}

/// 差し替えたバンドルを起動する。
pub fn launch_app(bundle: &Path) -> Result<(), UpdateError> {
    let status = Command::new("/usr/bin/open")
        .arg(bundle)
        .status()
        .map_err(|e| UpdateError::Io(format!("open を実行できません: {e}")))?;
    if !status.success() {
        return Err(UpdateError::Io(format!(
            "Ember を起動できませんでした (open exit {:?})",
            status.code()
        )));
    }
    Ok(())
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
    fn parse_metadata_reads_the_asset_for_this_platform() {
        let meta = parse_metadata(SAMPLE).expect("parse");
        assert_eq!(meta.version, "9.9.10");
        let asset = meta.platform_asset().expect("asset");
        assert_eq!(asset.filename, ASSET_NAME);
        // 見るキーは OS で変わる。Mac 版の updater が Windows 版の ZIP を掴まないこと
        let expected_size = if PLATFORM_KEY == "macos-arm64" { 456 } else { 123 };
        assert_eq!(asset.size, expected_size);
    }

    #[test]
    fn parse_metadata_rejects_a_version_that_is_not_a_number() {
        // URL へ埋め込む値なので、ここで止まらないと別の場所を取得させられる
        let json = SAMPLE.replace("\"9.9.10\"", "\"../../evil\"");
        assert!(matches!(parse_metadata(&json), Err(UpdateError::BadVersion(_))));
    }

    #[test]
    fn platform_asset_rejects_an_unexpected_filename() {
        let json = SAMPLE.replace(ASSET_NAME, "evil.zip");
        let meta = parse_metadata(&json).expect("parse");
        assert!(matches!(meta.platform_asset(), Err(UpdateError::Metadata(_))));
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
            format!("https://github.com/kiyohken2000/5ch-browser-template/releases/download/v9.9.10/{ASSET_NAME}")
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
        let method = extract_zip(&zip, &dest).expect("extract");
        println!("extracted with {method}");
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
    // --- macOS 版 ---------------------------------------------------------
    // 実機のコマンド任せの部分 (unzip / hdiutil / ditto / pgrep) は外に出してあるので、
    // 「どこを対象にするか」と「退避と巻き戻しの順番」はどの OS でも検証できる。

    /// `.app` の最低限の形 (Contents/MacOS/ember があること) を作る
    fn fake_bundle(bundle: &Path, body: &str) {
        write(&bundle.join("Contents").join("MacOS").join(MAIN_BINARY), body);
        write(&bundle.join("Contents").join("Info.plist"), "<plist/>");
    }

    fn read_main(bundle: &Path) -> String {
        fs::read_to_string(bundle.join("Contents").join("MacOS").join(MAIN_BINARY))
            .expect("main binary")
    }

    /// テスト用の素朴な再帰コピー。実機で ditto を使うのは symlink と拡張属性のため
    fn copy_tree(src: &Path, dest: &Path) -> Result<(), UpdateError> {
        fs::create_dir_all(dest).map_err(|e| io_err("テストのコピー", e))?;
        for entry in fs::read_dir(src).map_err(|e| io_err("テストのコピー", e))? {
            let entry = entry.map_err(|e| io_err("テストのコピー", e))?;
            let to = dest.join(entry.file_name());
            if entry.path().is_dir() {
                copy_tree(&entry.path(), &to)?;
            } else {
                fs::copy(entry.path(), &to).map_err(|e| io_err("テストのコピー", e))?;
            }
        }
        Ok(())
    }

    #[test]
    fn locate_bundle_walks_up_from_the_sidecar() {
        let bundle = locate_bundle(Path::new("/Applications/Ember.app/Contents/MacOS/updater"))
            .expect("bundle");
        assert_eq!(bundle, Path::new("/Applications/Ember.app"));
        // バンドルの外に置かれた updater は対象を決められないので断る
        assert!(matches!(
            locate_bundle(Path::new("/Users/me/Downloads/updater")),
            Err(UpdateError::Blocked(_))
        ));
    }

    #[test]
    fn ensure_bundle_replaceable_rejects_something_that_is_not_ember() {
        let root = temp_dir("bundle");
        let bundle = root.join("Ember.app");
        fs::create_dir_all(&bundle).expect("dir");
        let err = ensure_bundle_replaceable(&bundle).expect_err("fail");
        assert!(matches!(err, UpdateError::Blocked(_)), "got {err:?}");

        fake_bundle(&bundle, "old");
        assert!(ensure_bundle_replaceable(&bundle).is_ok());
        // プローブ用のファイルを残さない
        assert!(!root.join(".ember-update-probe").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn replace_bundle_swaps_the_app_and_leaves_no_backup() {
        let root = temp_dir("replace");
        let bundle = root.join("Ember.app");
        let staged = root.join("staged").join("Ember.app");
        let backup = root.join("Ember.app.update-backup-9.9.9");
        fake_bundle(&bundle, "old");
        fake_bundle(&staged, "new");

        let warnings = replace_bundle(&bundle, &staged, &backup, &copy_tree).expect("replace");
        assert!(warnings.is_empty(), "no warnings expected, got {warnings:?}");
        assert_eq!(read_main(&bundle), "new");
        // 退避は巻き戻し用なので、差し替えが終わったら残さない
        assert!(!backup.exists(), "the backup should be removed");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn replace_bundle_rolls_back_when_the_copy_fails() {
        let root = temp_dir("replace-rollback");
        let bundle = root.join("Ember.app");
        let staged = root.join("staged").join("Ember.app");
        let backup = root.join("Ember.app.update-backup-9.9.9");
        fake_bundle(&bundle, "old");
        fake_bundle(&staged, "new");

        let fail: fn(&Path, &Path) -> Result<(), UpdateError> =
            |_, _| Err(UpdateError::Io("コピー失敗".to_string()));
        let err = replace_bundle(&bundle, &staged, &backup, &fail).expect_err("should fail");
        assert!(matches!(err, UpdateError::Io(_)), "got {err:?}");

        // 元のまま。中途半端なバンドルも退避も残らない
        assert_eq!(read_main(&bundle), "old");
        assert!(!backup.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn replace_bundle_refuses_an_app_without_the_binary() {
        let root = temp_dir("replace-nobin");
        let bundle = root.join("Ember.app");
        let staged = root.join("staged").join("Ember.app");
        fake_bundle(&bundle, "old");
        write(&staged.join("Contents").join("Info.plist"), "<plist/>");

        let err = replace_bundle(&bundle, &staged, &root.join("backup"), &copy_tree)
            .expect_err("should fail");
        assert!(matches!(err, UpdateError::Extract(_)), "got {err:?}");
        assert_eq!(read_main(&bundle), "old");
        let _ = fs::remove_dir_all(&root);
    }
}
