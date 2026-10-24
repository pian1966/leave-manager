/*
 * Church Hub – data layer.
 * Reads come from an in-memory copy (fast, synchronous); writes update the copy and are saved in the background.
 * Today the copy is saved in this browser (demo). Moving to Firebase replaces only this file: Firestore keeps the
 * same kind of local copy and syncs it, so the rest of the app doesn't change.
 */
var Store = (function () {
  'use strict';
  var KEY = 'church_hub_demo_v1';
  var COLLECTIONS = ['people', 'families', 'consents', 'notes', 'teams', 'positions', 'skills', 'services', 'assignments',
    'groups', 'blockouts', 'dsr', 'breaches', 'audit'];
  var db = null, user = null, listeners = [];

  function uid(prefix) { return (prefix || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function now() { return new Date().toISOString().slice(0, 16).replace('T', ' '); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* private window: keep in memory */ } }

  function load(sampleFactory) {
    try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { db = null; }
    if (!db || !db.version) { db = sampleFactory(); save(); }
    COLLECTIONS.forEach(function (c) { if (!db[c]) db[c] = []; });
    return db;
  }
  function reset(sampleFactory) { db = sampleFactory(); save(); changed(); }

  function list(c) { return db[c] || []; }
  function get(c, id) { return list(c).filter(function (x) { return x.id === id; })[0] || null; }
  function find(c, fn) { return list(c).filter(fn); }
  function put(c, obj, auditText) {
    if (!obj.id) obj.id = uid(c.slice(0, 2));
    var arr = list(c), i = arr.findIndex(function (x) { return x.id === obj.id; });
    obj.updatedAt = now();
    if (i >= 0) arr[i] = obj; else { obj.createdAt = obj.createdAt || now(); arr.push(obj); }
    if (auditText) audit(auditText, c + '/' + obj.id);
    save(); changed();
    return obj;
  }
  function remove(c, id, auditText) {
    db[c] = list(c).filter(function (x) { return x.id !== id; });
    if (auditText) audit(auditText, c + '/' + id);
    save(); changed();
  }
  /** POPIA accountability: who did what to whose information, and when. */
  function audit(action, target) {
    db.audit.unshift({ id: uid('au'), at: now(), who: user ? user.name : 'System', action: action, target: target || '' });
    if (db.audit.length > 5000) db.audit.length = 5000;
    save();
  }
  function settings() { return db.settings; }
  function setSettings(patch, auditText) { Object.assign(db.settings, patch); if (auditText) audit(auditText, 'settings'); save(); changed(); }
  function leave() { return db.leave; }
  function saveLeave(auditText) { if (auditText) audit(auditText, 'leave'); save(); changed(); }
  function setUser(u) { user = u; }
  function onChange(fn) { listeners.push(fn); }
  function changed() { listeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); }
  function exportAll() { return JSON.parse(JSON.stringify(db)); }

  return { load: load, reset: reset, list: list, get: get, find: find, put: put, remove: remove, audit: audit, uid: uid, now: now,
    settings: settings, setSettings: setSettings, leave: leave, saveLeave: saveLeave, setUser: setUser, onChange: onChange, exportAll: exportAll };
})();
