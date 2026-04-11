use crate::types::NgFilters;

#[tauri::command]
pub fn load_ng_filters() -> Result<NgFilters, String> {
    match core_store::load_json::<NgFilters>("ng_filters.json") {
        Ok(data) => Ok(data),
        Err(_) => Ok(NgFilters::default()),
    }
}

#[tauri::command]
pub fn save_ng_filters(filters: NgFilters) -> Result<(), String> {
    core_store::save_json("ng_filters.json", &filters).map_err(|e| e.to_string())
}
