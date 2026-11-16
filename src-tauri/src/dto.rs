//! Native task contract with the React frontend. Domain/native fields use `lists`;
//! the HTTP adapter maps the server's legacy `projects` field to this shape.

use crate::store::Entry;
use serde::Serialize;
use std::collections::BTreeMap;

/// Native JSON representation of a task, matching the frontend domain model.
#[derive(Debug, Serialize)]
pub struct TaskDto {
  pub id: u64,
  pub completed: bool,
  pub completion_date: Option<String>,
  pub creation_date: Option<String>,
  pub description: String,
  pub lists: Vec<String>,
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
      completion_date: e.task.completion_date.map(|x| x.to_string()),
      creation_date: e.task.creation_date.map(|x| x.to_string()),
      description: e.task.description.clone(),
      lists: d.lists,
      contexts: d.contexts,
      tags: d.tags,
      raw: e.task.to_string(),
    }
  }
}
