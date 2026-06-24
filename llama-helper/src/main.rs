mod model_state;
mod protocol;
mod runtime;
mod vram;

use anyhow::Result;

fn main() -> Result<()> {
    runtime::run()
}
