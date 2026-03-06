use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthProvider {
    Be,
    Uplift,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthState {
    pub provider: AuthProvider,
    pub enabled: bool,
}
