use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    path::Path,
    time::Duration,
};
use uuid::Uuid;

use crate::provider::Completion;

pub(crate) enum Admission {
    Created,
    Existing,
    Busy,
}

#[derive(Serialize)]
pub(crate) struct Task {
    pub id: String,
    pub provider: String,
    pub model: String,
    pub prompt: String,
    pub status: String,
    pub result: Option<String>,
    pub error: Option<String>,
    pub tokens: Option<i64>,
    pub max_output: u16,
    pub created_at: String,
}

#[derive(Serialize)]
pub(crate) struct RecentTask {
    id: String,
    provider: String,
    model: String,
    status: String,
    created_at: String,
}

impl RecentTask {
    pub fn is_running(&self) -> bool {
        self.status == "running"
    }
}

pub(crate) struct Store {
    connection: Connection,
    _instance_lock: File,
}

impl Store {
    pub fn open(dir: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(dir)?;

        let mut options = OpenOptions::new();
        options.create(true).truncate(false).write(true).read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let instance_lock = options.open(dir.join("workbench.lock"))?;
        instance_lock.try_lock()?;

        let db_path = dir.join("workbench.sqlite3");
        options.open(&db_path)?;
        let mut connection = Connection::open(db_path)?;
        connection.busy_timeout(Duration::from_millis(500))?;
        connection.execute_batch("PRAGMA synchronous=FULL;")?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version == 0 {
            let migration = connection.transaction()?;
            migration.execute_batch(
                "CREATE TABLE tasks (
                    id TEXT PRIMARY KEY NOT NULL,
                    provider TEXT NOT NULL CHECK (provider IN ('ollama','openrouter','openai')),
                    model TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('running','completed','failed','interrupted')),
                    result TEXT,
                    error TEXT,
                    tokens INTEGER CHECK (tokens >= 0),
                    max_output INTEGER NOT NULL CHECK (max_output BETWEEN 32 AND 2048),
                    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
                 );
                 CREATE UNIQUE INDEX one_running_task ON tasks (status) WHERE status = 'running';
                 PRAGMA user_version = 1;",
            )?;
            migration.commit()?;
        } else if version != 1 {
            return Err("Unsupported workbench database schema".into());
        }
        // A previous run may already have dispatched inference. Never retry it automatically.
        connection.execute(
            "UPDATE tasks SET status = 'interrupted' WHERE status = 'running'",
            [],
        )?;
        Ok(Self {
            connection,
            _instance_lock: instance_lock,
        })
    }

    pub fn begin(
        &mut self,
        id: Uuid,
        provider: &str,
        model: &str,
        prompt: &str,
        max_output: u16,
    ) -> rusqlite::Result<Admission> {
        let transaction = self.connection.transaction()?;
        let exists = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM tasks WHERE id = ?1)",
            [id.to_string()],
            |row| row.get(0),
        )?;
        if exists {
            return Ok(Admission::Existing);
        }
        let busy = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM tasks WHERE status = 'running')",
            [],
            |row| row.get(0),
        )?;
        if busy {
            return Ok(Admission::Busy);
        }
        transaction.execute(
            "INSERT INTO tasks (id,provider,model,prompt,max_output,status)
             VALUES (?1,?2,?3,?4,?5,'running')",
            params![id.to_string(), provider, model, prompt, max_output],
        )?;
        transaction.commit()?;
        Ok(Admission::Created)
    }

    pub fn complete(&mut self, id: Uuid, completion: &Completion) -> rusqlite::Result<()> {
        self.connection.execute(
            "UPDATE tasks SET status = 'completed', result = ?2, tokens = ?3
             WHERE id = ?1 AND status = 'running'",
            params![id.to_string(), completion.content, completion.tokens],
        )?;
        Ok(())
    }

    pub fn fail(&mut self, id: Uuid, error: &str) -> rusqlite::Result<()> {
        self.connection.execute(
            "UPDATE tasks SET status = 'failed', error = ?2
             WHERE id = ?1 AND status = 'running'",
            params![id.to_string(), error],
        )?;
        Ok(())
    }

    pub fn find(&self, id: Uuid) -> rusqlite::Result<Option<Task>> {
        self.connection
            .query_row(
                "SELECT id,provider,model,prompt,status,result,error,tokens,max_output,created_at
                 FROM tasks WHERE id = ?1",
                [id.to_string()],
                read_task,
            )
            .optional()
    }

    pub fn recent(&self) -> rusqlite::Result<Vec<RecentTask>> {
        self.connection
            .prepare(
                "SELECT id,provider,model,status,created_at
                 FROM tasks ORDER BY rowid DESC LIMIT 25",
            )?
            .query_map([], |row| {
                Ok(RecentTask {
                    id: row.get(0)?,
                    provider: row.get(1)?,
                    model: row.get(2)?,
                    status: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect()
    }
}

fn read_task(row: &Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        provider: row.get(1)?,
        model: row.get(2)?,
        prompt: row.get(3)?,
        status: row.get(4)?,
        result: row.get(5)?,
        error: row.get(6)?,
        tokens: row.get(7)?,
        max_output: row.get(8)?,
        created_at: row.get(9)?,
    })
}
