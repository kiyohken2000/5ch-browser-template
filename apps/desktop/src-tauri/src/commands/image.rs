use crate::types::{DownloadResult, ImageUploadResult, UploadHistory};

#[tauri::command]
pub async fn upload_image(file_data: String, file_name: String) -> Result<ImageUploadResult, String> {
    use reqwest::multipart;
    use base64::Engine;

    let file_bytes = base64::engine::general_purpose::STANDARD
        .decode(&file_data)
        .map_err(|e| format!("Base64デコードエラー: {}", e))?;
    let mime = if file_name.ends_with(".png") { "image/png" }
        else if file_name.ends_with(".gif") { "image/gif" }
        else if file_name.ends_with(".webp") { "image/webp" }
        else { "image/jpeg" };
    let part = multipart::Part::bytes(file_bytes)
        .file_name(file_name)
        .mime_str(mime)
        .map_err(|e| format!("MIME設定エラー: {}", e))?;
    let form = multipart::Form::new()
        .text("title", "うｐろだ")
        .text("comment", "")
        .text("r18", "no")
        .part("file[]", part);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTPクライアント作成エラー: {}", e))?;
    let resp = client
        .post("https://tadaup.jp/wp-json/custom/v1/upload")
        .basic_auth("API", Some("AoLU ets7 2zh3 gvqc cTEe BHfp"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("アップロードエラー: {}", e))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("レスポンス読み取りエラー: {}", e))?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, body));
    }
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("JSONパースエラー: {}", e))?;
    let success = json.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
    if !success {
        let msg = json.get("message").and_then(|v| v.as_str()).unwrap_or("unknown error");
        return Err(format!("アップロード失敗: {}", msg));
    }
    Ok(ImageUploadResult {
        success: true,
        source_url: json.get("source_url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        thumbnail: json.get("thumbnail").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        page_url: json.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
    })
}

#[tauri::command]
pub fn load_upload_history() -> Result<UploadHistory, String> {
    match core_store::load_json::<UploadHistory>("upload_history.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(UploadHistory::default()),
    }
}

#[tauri::command]
pub fn save_upload_history(history: UploadHistory) -> Result<(), String> {
    core_store::save_json("upload_history.json", &history).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_images(urls: Vec<String>, dest_dir: String) -> Result<DownloadResult, String> {
    let dest = std::path::Path::new(&dest_dir);
    if !dest.is_dir() {
        return Err(format!("保存先ディレクトリが存在しません: {}", dest_dir));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTPクライアント作成エラー: {}", e))?;
    let mut success_count: u32 = 0;
    let mut fail_count: u32 = 0;
    for url in &urls {
        let file_name = url
            .split('?')
            .next()
            .unwrap_or(url)
            .rsplit('/')
            .next()
            .unwrap_or("image.jpg")
            .to_string();
        let mut target = dest.join(&file_name);
        if target.exists() {
            let stem = target.file_stem().and_then(|s| s.to_str()).unwrap_or("image").to_string();
            let ext = target.extension().and_then(|s| s.to_str()).unwrap_or("jpg").to_string();
            let mut n = 1u32;
            loop {
                target = dest.join(format!("{}_{}.{}", stem, n, ext));
                if !target.exists() { break; }
                n += 1;
            }
        }
        match client.get(url).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    match resp.bytes().await {
                        Ok(bytes) => {
                            if std::fs::write(&target, &bytes).is_ok() {
                                success_count += 1;
                            } else {
                                fail_count += 1;
                            }
                        }
                        Err(_) => { fail_count += 1; }
                    }
                } else {
                    fail_count += 1;
                }
            }
            Err(_) => { fail_count += 1; }
        }
    }
    Ok(DownloadResult { success_count, fail_count })
}
