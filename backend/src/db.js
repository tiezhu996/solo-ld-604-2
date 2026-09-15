'use strict';

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = process.env.GRID_REPAIR_DB_FILE || path.join(DATA_DIR, 'grid-repair.sqlite');
const TMP_FILE = DB_FILE + '.tmp';

/** @type {import('sql.js').Database} */
let db = null;

/** 加载（或新建）数据库文件 */
async function initDb() {
  const SQL = await initSqlJs();
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  db.run(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  persist();
  return db;
}

/** 将内存库原子落盘：先写临时文件再 rename，避免异常中断留下半个文件 */
function persist() {
  const data = db.export();
  fs.writeFileSync(TMP_FILE, Buffer.from(data));
  fs.renameSync(TMP_FILE, DB_FILE);
}

/**
 * 事务包装：多步写入要么全部提交并落盘，要么整体回滚，
 * 保证异常时数据库与刷新后读取到的状态一致。
 */
function tx(fn) {
  db.run('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.run('COMMIT');
    persist();
    return result;
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }
}

/** 查询多行，返回对象数组 */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/** 查询单行，无结果返回 null */
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

/** 执行写语句（需在 tx 内调用以自动落盘），返回 lastInsertRowid */
function run(sql, params = []) {
  db.run(sql, params);
  const row = get('SELECT last_insert_rowid() AS id');
  return row.id;
}

function now() {
  return new Date().toISOString();
}

module.exports = { initDb, persist, tx, all, get, run, now, DB_FILE };
