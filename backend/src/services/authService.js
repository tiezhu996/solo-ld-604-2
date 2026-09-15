'use strict';

const crypto = require('crypto');
const { tx, get, run, now } = require('../db');
const { ApiError } = require('../errors');

function publicUser(u) {
  if (!u) return null;
  const crew = u.crew_id ? get('SELECT id, name FROM crews WHERE id = ?', [u.crew_id]) : null;
  return { id: u.id, username: u.username, name: u.name, role: u.role, crewId: u.crew_id, crewName: crew ? crew.name : null };
}

function login(username, password) {
  const user = get('SELECT * FROM users WHERE username = ?', [String(username || '').trim()]);
  if (!user || user.password !== String(password || '')) {
    throw new ApiError('INVALID_CREDENTIALS');
  }
  const token = crypto.randomUUID();
  tx(() => {
    run('INSERT INTO sessions(token, user_id, created_at) VALUES (?,?,?)', [token, user.id, now()]);
  });
  return { token, user: publicUser(user) };
}

function userByToken(token) {
  if (!token) return null;
  const row = get(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
    [token]
  );
  return row || null;
}

function logout(token) {
  if (!token) return;
  tx(() => {
    run('DELETE FROM sessions WHERE token = ?', [token]);
  });
}

module.exports = { login, logout, userByToken, publicUser };
