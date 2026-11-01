//! 翻譯記憶的本地檔（SQLite）：只負責存取，比對、整理都在畫面那邊（src/state/tm.ts）
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 一條記憶
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct TmRow {
    pub id: String,
    pub project: String,
    pub src: String,
    pub tgt: String,
    pub verified: bool,
    pub by: String,
    pub at: i64,
    pub fid: String,
    pub file: String,
    pub sheet: String,
    pub eid: String,
    pub speaker: String,
}

#[derive(Serialize)]
pub struct TmLoad {
    rows: Vec<TmRow>,
    /// 還沒送上共用表的變動：[編號, 內容]
    outbox: Vec<(i64, String)>,
    meta: HashMap<String, String>,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS rows (
  id TEXT PRIMARY KEY, project TEXT NOT NULL DEFAULT '', src TEXT NOT NULL DEFAULT '', tgt TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0, by_ TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL DEFAULT 0,
  fid TEXT NOT NULL DEFAULT '', file TEXT NOT NULL DEFAULT '', sheet TEXT NOT NULL DEFAULT '', eid TEXT NOT NULL DEFAULT '', speaker TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, op TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hist (seq INTEGER PRIMARY KEY AUTOINCREMENT, rid TEXT NOT NULL, at INTEGER NOT NULL, row TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS hist_rid ON hist(rid);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
";

fn open(path: &str) -> Result<Connection, String> {
    if let Some(dir) = std::path::Path::new(path).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let c = Connection::open(path).map_err(|e| e.to_string())?;
    c.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    c.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    Ok(c)
}

fn read_rows(c: &Connection) -> Result<Vec<TmRow>, String> {
    let mut st = c
        .prepare("SELECT id, project, src, tgt, verified, by_, at, fid, file, sheet, eid, speaker FROM rows")
        .map_err(|e| e.to_string())?;
    let it = st
        .query_map([], |r| {
            Ok(TmRow {
                id: r.get(0)?, project: r.get(1)?, src: r.get(2)?, tgt: r.get(3)?, verified: r.get::<_, i64>(4)? != 0,
                by: r.get(5)?, at: r.get(6)?, fid: r.get(7)?, file: r.get(8)?, sheet: r.get(9)?, eid: r.get(10)?, speaker: r.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    it.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn put_rows(c: &Connection, rows: &[TmRow]) -> Result<(), String> {
    let mut st = c
        .prepare_cached("INSERT OR REPLACE INTO rows (id, project, src, tgt, verified, by_, at, fid, file, sheet, eid, speaker) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)")
        .map_err(|e| e.to_string())?;
    for r in rows {
        st.execute(params![r.id, r.project, r.src, r.tgt, r.verified as i64, r.by, r.at, r.fid, r.file, r.sheet, r.eid, r.speaker])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 打開（沒有就建立）記憶檔，讀出全部內容
#[tauri::command]
pub fn tm_load(path: String) -> Result<TmLoad, String> {
    let c = open(&path)?;
    let rows = read_rows(&c)?;
    let mut st = c.prepare("SELECT seq, op FROM outbox ORDER BY seq").map_err(|e| e.to_string())?;
    let outbox = st
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut st = c.prepare("SELECT k, v FROM meta").map_err(|e| e.to_string())?;
    let meta = st
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<HashMap<_, _>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(TmLoad { rows, outbox, meta })
}

/// 一次寫好幾種變動（同一個交易，中途失敗全部不算）；回傳新加進待送清單的編號
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn tm_apply(
    path: String,
    put: Vec<TmRow>,
    del: Vec<String>,
    hist: Vec<(String, i64, String)>,
    outbox_add: Vec<String>,
    outbox_del: Vec<i64>,
    meta: Vec<(String, String)>,
    purge_before: Option<i64>,
) -> Result<Vec<i64>, String> {
    let mut c = open(&path)?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    put_rows(&tx, &put)?;
    for id in &del {
        tx.execute("DELETE FROM rows WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    }
    for (rid, at, row) in &hist {
        tx.execute("INSERT INTO hist (rid, at, row) VALUES (?1, ?2, ?3)", params![rid, at, row]).map_err(|e| e.to_string())?;
    }
    let mut seqs = Vec::new();
    for op in &outbox_add {
        tx.execute("INSERT INTO outbox (op) VALUES (?1)", params![op]).map_err(|e| e.to_string())?;
        seqs.push(tx.last_insert_rowid());
    }
    for s in &outbox_del {
        tx.execute("DELETE FROM outbox WHERE seq = ?1", params![s]).map_err(|e| e.to_string())?;
    }
    for (k, v) in &meta {
        tx.execute("INSERT OR REPLACE INTO meta (k, v) VALUES (?1, ?2)", params![k, v]).map_err(|e| e.to_string())?;
    }
    if let Some(t) = purge_before {
        tx.execute("DELETE FROM hist WHERE at < ?1", params![t]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(seqs)
}

/// 舊版本（退回用）：rid 給了就只看那一條；[編號, 記憶 ID, 時間, 內容]
#[tauri::command]
pub fn tm_hist(path: String, rid: Option<String>, since: i64) -> Result<Vec<(i64, String, i64, String)>, String> {
    let c = open(&path)?;
    let mut st = c
        .prepare("SELECT seq, rid, at, row FROM hist WHERE at >= ?1 AND (?2 IS NULL OR rid = ?2) ORDER BY seq DESC LIMIT 2000")
        .map_err(|e| e.to_string())?;
    let out = st
        .query_map(params![since, rid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(out)
}

/// 匯出：把這些記憶寫成一個新的 SQLite 檔（已經有的檔案整個換掉）
#[tauri::command]
pub fn tm_export(path: String, rows: Vec<TmRow>) -> Result<(), String> {
    let tmp = format!("{}.tmp", path);
    let _ = std::fs::remove_file(&tmp);
    {
        let mut c = open(&tmp)?;
        let tx = c.transaction().map_err(|e| e.to_string())?;
        put_rows(&tx, &rows)?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(&path);
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// 匯入：讀別的 SQLite 記憶檔（只讀，不改那個檔案）
#[tauri::command]
pub fn tm_read(path: String) -> Result<Vec<TmRow>, String> {
    let c = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    read_rows(&c)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_read_export() {
        let dir = std::env::temp_dir().join(format!("verso-tm-{}", std::process::id()));
        let p = dir.join("a.sqlite").to_string_lossy().into_owned();
        let row = TmRow { id: "1".into(), project: "共用".into(), src: "你好".into(), tgt: "Hi".into(), verified: true, at: 5, ..Default::default() };
        let seqs = tm_apply(p.clone(), vec![row.clone()], vec![], vec![("1".into(), 5, "{}".into())], vec!["op".into()], vec![], vec![("k".into(), "v".into())], None).unwrap();
        let l = tm_load(p.clone()).unwrap();
        assert_eq!(l.rows.len(), 1);
        assert_eq!(l.rows[0].tgt, "Hi");
        assert!(l.rows[0].verified);
        assert_eq!(l.outbox, vec![(seqs[0], "op".to_string())]);
        assert_eq!(l.meta.get("k").map(|s| s.as_str()), Some("v"));
        assert_eq!(tm_hist(p.clone(), Some("1".into()), 0).unwrap().len(), 1);
        tm_apply(p.clone(), vec![], vec!["1".into()], vec![], vec![], seqs, vec![], Some(10)).unwrap();
        let l = tm_load(p.clone()).unwrap();
        assert!(l.rows.is_empty() && l.outbox.is_empty());
        assert!(tm_hist(p.clone(), None, 0).unwrap().is_empty());
        let e = dir.join("b.sqlite").to_string_lossy().into_owned();
        tm_export(e.clone(), vec![row]).unwrap();
        assert_eq!(tm_read(e).unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }
}
