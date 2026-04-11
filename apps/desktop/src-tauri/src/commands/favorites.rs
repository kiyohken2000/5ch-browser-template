use crate::types::{FavoritesData, ReadStatusMap};

use std::collections::HashMap;

#[tauri::command]
pub fn load_favorites() -> Result<FavoritesData, String> {
    match core_store::load_json::<FavoritesData>("favorites.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(FavoritesData::default()),
    }
}

#[tauri::command]
pub fn save_favorites(favorites: FavoritesData) -> Result<(), String> {
    core_store::save_json("favorites.json", &favorites).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_read_status() -> Result<ReadStatusMap, String> {
    match core_store::load_json::<ReadStatusMap>("read_status.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(HashMap::new()),
    }
}

#[tauri::command]
pub fn save_read_status(status: ReadStatusMap) -> Result<(), String> {
    core_store::save_json("read_status.json", &status).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_layout_prefs(prefs: String) -> Result<(), String> {
    core_store::save_json("layout_prefs.json", &prefs).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_layout_prefs() -> Result<String, String> {
    match core_store::load_json::<String>("layout_prefs.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(String::new()),
    }
}
