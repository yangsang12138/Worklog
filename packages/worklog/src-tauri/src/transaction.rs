use sqlx::Executor;
use tauri_plugin_sql::DbInstances;

async fn execute(pool: &sqlx::SqlitePool, sql: &str) -> Result<(), String> {
    let mut transaction = pool.begin().await.map_err(|e| e.to_string())?;
    match (&mut *transaction).execute(sql).await {
        Ok(_) => transaction.commit().await.map_err(|e| e.to_string()),
        Err(error) => {
            // Roll back on the same connection, never via a second pool lookup.
            let _ = transaction.rollback().await;
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub async fn execute_transaction(
    databases: tauri::State<'_, DbInstances>,
    db: String,
    sql: String,
) -> Result<(), String> {
    let instances = databases.0.read().await;
    let tauri_plugin_sql::DbPool::Sqlite(pool) = instances
        .get(&db)
        .ok_or_else(|| "Workspace database is not open".to_string())?;
    execute(pool, &sql).await
}

#[cfg(test)]
mod tests {
    #[test]
    fn rolls_back_and_reuses_pool_after_late_failure() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(2)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::raw_sql(
                "CREATE TABLE items (id INTEGER PRIMARY KEY); INSERT INTO items VALUES (1);",
            )
            .execute(&pool)
            .await
            .unwrap();
            let result = super::execute(
                &pool,
                "INSERT INTO items VALUES (2); INSERT INTO items VALUES (1);",
            )
            .await;
            assert!(result.is_err());
            let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM items")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count.0, 1);
            super::execute(&pool, "INSERT INTO items VALUES (3);")
                .await
                .unwrap();
            let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM items")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count.0, 2);
            pool.close().await;
        });
    }
}
