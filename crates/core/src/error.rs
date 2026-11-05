use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("scan was cancelled")]
    Cancelled,

    #[error("deletion blocked: {0}")]
    Blocked(String),

    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("recycle bin error: {0}")]
    Trash(String),

    #[error("{0}")]
    Invalid(String),
}

impl Error {
    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Error::Io {
            path: path.into(),
            source,
        }
    }
}

impl From<trash::Error> for Error {
    fn from(e: trash::Error) -> Self {
        Error::Trash(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
