use std::sync::Arc;

use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{0}")]
pub struct CredentialError(String);

impl CredentialError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

/// Secrets the app keeps for itself, never the credentials `git` uses.
pub trait CredentialStore: Send + Sync {
    fn read(&self, account: &str) -> Result<Option<String>, CredentialError>;
    fn save(&self, account: &str, secret: &str) -> Result<(), CredentialError>;
    /// Deleting a secret that is not stored succeeds.
    fn delete(&self, account: &str) -> Result<(), CredentialError>;
}

#[cfg(windows)]
pub fn os_credential_store() -> Arc<dyn CredentialStore> {
    match windows::WindowsCredentialStore::new() {
        Ok(store) => Arc::new(store),
        Err(error) => Arc::new(UnavailableCredentialStore(error)),
    }
}

/// Linux and macOS credential stores come with those platforms' support.
#[cfg(not(windows))]
pub fn os_credential_store() -> Arc<dyn CredentialStore> {
    Arc::new(UnavailableCredentialStore(CredentialError(
        "storing credentials is not supported on this platform yet".to_owned(),
    )))
}

/// Keeps the app usable, with the `gh` token only, when the OS store cannot be opened.
struct UnavailableCredentialStore(CredentialError);

impl CredentialStore for UnavailableCredentialStore {
    fn read(&self, _account: &str) -> Result<Option<String>, CredentialError> {
        Ok(None)
    }

    fn save(&self, _account: &str, _secret: &str) -> Result<(), CredentialError> {
        Err(self.0.clone())
    }

    fn delete(&self, _account: &str) -> Result<(), CredentialError> {
        Ok(())
    }
}

#[cfg(windows)]
mod windows {
    use std::sync::Arc;

    use keyring_core::api::CredentialStoreApi;

    use super::{CredentialError, CredentialStore};

    const SERVICE: &str = "rebasar";

    pub struct WindowsCredentialStore {
        store: Arc<windows_native_keyring_store::Store>,
    }

    impl WindowsCredentialStore {
        pub fn new() -> Result<Self, CredentialError> {
            let store = windows_native_keyring_store::Store::new().map_err(credential_error)?;
            Ok(Self { store })
        }

        fn entry(&self, account: &str) -> Result<keyring_core::Entry, CredentialError> {
            self.store
                .build(SERVICE, account, None)
                .map_err(credential_error)
        }
    }

    impl CredentialStore for WindowsCredentialStore {
        fn read(&self, account: &str) -> Result<Option<String>, CredentialError> {
            match self.entry(account)?.get_password() {
                Ok(secret) => Ok(Some(secret)),
                Err(keyring_core::Error::NoEntry) => Ok(None),
                Err(error) => Err(credential_error(error)),
            }
        }

        fn save(&self, account: &str, secret: &str) -> Result<(), CredentialError> {
            self.entry(account)?
                .set_password(secret)
                .map_err(credential_error)
        }

        fn delete(&self, account: &str) -> Result<(), CredentialError> {
            match self.entry(account)?.delete_credential() {
                Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
                Err(error) => Err(credential_error(error)),
            }
        }
    }

    fn credential_error(error: impl std::fmt::Display) -> CredentialError {
        CredentialError(format!("the Windows credential store failed: {error}"))
    }
}
