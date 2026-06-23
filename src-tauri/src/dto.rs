//! Wire contract with the React frontend. `TaskDto` is ported from my-ntr-server src/api.rs
//! (workdir/server) and kept byte-identical in shape so the frontend's task rendering is a
//! direct port of web/app.js — keep in sync (see plan.md "Accepted duplication").

use crate::store::Entry;
use serde::Serialize;
use std::collections::BTreeMap;

/// JSON representation of a task — exactly the server's `TaskDto` shape.
#[derive(Debug, Serialize)]
pub struct TaskDto {
  pub id: u64,
  pub completed: bool,
  pub priority: Option<char>,
  pub completion_date: Option<String>,
  pub creation_date: Option<String>,
  pub description: String,
  pub projects: Vec<String>,
  pub contexts: Vec<String>,
  pub tags: BTreeMap<String, String>,
  pub raw: String,
}

impl TaskDto {
  pub fn from_entry(e: &Entry) -> Self {
    let d = e.task.derived();
    TaskDto {
      id: e.id,
      completed: e.task.completed,
      priority: e.task.priority,
      completion_date: e.task.completion_date.map(|x| x.to_string()),
      creation_date: e.task.creation_date.map(|x| x.to_string()),
      description: e.task.description.clone(),
      projects: d.projects,
      contexts: d.contexts,
      tags: d.tags,
      raw: e.task.to_string(),
    }
  }
}
