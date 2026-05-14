use std::io::{self, Write as _};

use serde::Serialize;

pub fn print_json(value: &impl Serialize) -> Result<(), String> {
    let mut stdout = io::stdout();
    serde_json::to_writer_pretty(&mut stdout, value).map_err(|e| format!("write json: {e}"))?;
    stdout
        .write_all(b"\n")
        .map_err(|e| format!("write stdout: {e}"))
}

pub fn empty_dash(value: &str) -> &str {
    if value.is_empty() {
        "-"
    } else {
        value
    }
}
