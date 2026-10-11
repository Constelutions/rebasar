use std::collections::BTreeSet;

use super::GitHubRepository;

/// `origin` wins, so a fork's `upstream` or a mirror never hides the Repository's own remote.
pub fn find(repo: &gix::Repository) -> Option<GitHubRepository> {
    let config = repo.config_snapshot();
    let names: BTreeSet<String> = repo
        .remote_names()
        .into_iter()
        .map(|name| name.to_string())
        .collect();
    let origin_first = names
        .iter()
        .filter(|name| name.as_str() == "origin")
        .chain(names.iter().filter(|name| name.as_str() != "origin"));

    origin_first
        .filter_map(|name| config.string(&format!("remote.{name}.url")))
        .find_map(|url| parse(&url.to_string()))
}

fn parse(url: &str) -> Option<GitHubRepository> {
    let (host, path) = split_host_and_path(url)?;
    if !host.eq_ignore_ascii_case("github.com") {
        return None;
    }

    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (owner, name) = path.split_once('/')?;
    if owner.is_empty() || name.is_empty() || name.contains('/') {
        return None;
    }
    Some(GitHubRepository {
        owner: owner.to_owned(),
        name: name.to_owned(),
    })
}

fn split_host_and_path(url: &str) -> Option<(&str, &str)> {
    if let Some((_, rest)) = url.split_once("://") {
        let (authority, path) = rest.split_once('/')?;
        let host_and_port = authority
            .rsplit_once('@')
            .map_or(authority, |(_, host)| host);
        let host = host_and_port.split(':').next()?;
        return Some((host, path));
    }

    let (authority, path) = url.split_once(':')?;
    let host = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    Some((host, path))
}
