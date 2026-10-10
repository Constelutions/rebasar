use std::path::PathBuf;
use std::process::ExitCode;

use rebasar_bench::{run, scenarios, FixtureCache, Report, Scale};

const USAGE: &str = "usage: rebasar-bench <generate | run> [--scale alpha|smoke] [--output <file>]

  generate  build the large fixture Repositories (cached; reused when already built)
  run       time the benchmark scenarios and report them next to the alpha thresholds
  --scale   alpha (default) is the Linux-kernel scale; smoke is a few seconds, for checking the harness
  --output  where `run` records its JSON results (default: <fixture folder>/results/<time>.json)";

struct Options {
    command: String,
    scale: Scale,
    output: Option<PathBuf>,
}

fn parse(args: impl Iterator<Item = String>) -> Result<Options, String> {
    let mut args = args;
    let command = args.next().ok_or("missing command")?;
    if command != "generate" && command != "run" {
        return Err(format!("unknown command `{command}`"));
    }
    let mut options = Options {
        command,
        scale: Scale::ALPHA,
        output: None,
    };
    while let Some(flag) = args.next() {
        let value = args.next().ok_or(format!("{flag} needs a value"))?;
        match flag.as_str() {
            "--scale" => {
                options.scale = match value.as_str() {
                    "alpha" => Scale::ALPHA,
                    "smoke" => Scale::SMOKE,
                    other => return Err(format!("unknown scale `{other}`")),
                }
            }
            "--output" => options.output = Some(PathBuf::from(value)),
            other => return Err(format!("unknown option `{other}`")),
        }
    }
    Ok(options)
}

fn execute(options: &Options, cache: &FixtureCache) -> std::io::Result<()> {
    if options.command == "generate" {
        eprintln!("Generating fixtures; the alpha scale takes a long while the first time.");
        for fixture in [
            cache.history(&options.scale)?,
            cache.worktree(&options.scale)?,
            cache.changeset(&options.scale)?,
            cache.tabs(&options.scale)?,
        ] {
            println!("{}", fixture.display());
        }
        return Ok(());
    }

    let report = run(cache, &options.scale, &scenarios())?;
    println!("{report}");
    let output = options
        .output
        .clone()
        .unwrap_or_else(|| default_output(cache, &report));
    if let Some(folder) = output.parent() {
        std::fs::create_dir_all(folder)?;
    }
    std::fs::write(&output, report.to_json())?;
    println!("Results recorded in {}", output.display());
    Ok(())
}

fn default_output(cache: &FixtureCache, report: &Report) -> PathBuf {
    cache
        .root()
        .join("results")
        .join(format!("{}.json", report.recorded_at_unix))
}

fn main() -> ExitCode {
    let options = match parse(std::env::args().skip(1)) {
        Ok(options) => options,
        Err(problem) => {
            eprintln!("{problem}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let Some(root) = FixtureCache::default_location() else {
        eprintln!("cannot find a cache folder; set REBASAR_FIXTURE_DIR");
        return ExitCode::from(2);
    };

    match execute(&options, &FixtureCache::new(root)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
