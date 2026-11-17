'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const engine=require('./deal-engine');
const { DatabaseSync, backup } = require('node:sqlite');

function openDb(dir = process.env.DATA_DIR || path.join(process.cwd(), 'data')) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'gamedeals.db'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS guilds (guild_id TEXT PRIMARY KEY, menu_channel TEXT, deals_channel TEXT, menu_message TEXT, min_discount INTEGER NOT NULL DEFAULT 50, max_price_cents INTEGER, enabled INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS offers (offer_key TEXT PRIMARY KEY, title TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL, image TEXT, currency TEXT NOT NULL, original_cents INTEGER NOT NULL, price_cents INTEGER NOT NULL, discount INTEGER NOT NULL, expires_at TEXT, seen_at INTEGER NOT NULL, changed_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_offers_recent ON offers(seen_at DESC);
  CREATE TABLE IF NOT EXISTS price_history (id INTEGER PRIMARY KEY AUTOINCREMENT, offer_key TEXT NOT NULL, price_cents INTEGER NOT NULL, currency TEXT NOT NULL, recorded_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_history_key ON price_history(offer_key, recorded_at DESC);
  CREATE TABLE IF NOT EXISTS watchlist (user_id TEXT NOT NULL, offer_key TEXT NOT NULL, target_cents INTEGER, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, offer_key));
  CREATE TABLE IF NOT EXISTS notifications (guild_id TEXT NOT NULL, offer_key TEXT NOT NULL, price_cents INTEGER NOT NULL, delivered_at INTEGER NOT NULL, PRIMARY KEY(guild_id, offer_key, price_cents));
  CREATE TABLE IF NOT EXISTS dm_notifications (user_id TEXT NOT NULL, offer_key TEXT NOT NULL, price_cents INTEGER NOT NULL, delivered_at INTEGER NOT NULL, PRIMARY KEY(user_id, offer_key, price_cents));
  CREATE TABLE IF NOT EXISTS sources (source TEXT PRIMARY KEY, checked_at INTEGER, last_error TEXT, item_count INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS delivery_queue(
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL CHECK(target_type IN ('guild','dm')),
    target_id TEXT NOT NULL,offer_key TEXT NOT NULL,price_cents INTEGER NOT NULL,
    created_at INTEGER NOT NULL,next_attempt_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'pending',last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_delivery_queue_due ON delivery_queue(status,next_attempt_at);
  CREATE TABLE IF NOT EXISTS game_watches(
    watch_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,game_key TEXT NOT NULL,
    title TEXT NOT NULL,currency TEXT NOT NULL,max_cents INTEGER,
    created_at INTEGER NOT NULL,UNIQUE(user_id,game_key,currency)
  );
  CREATE INDEX IF NOT EXISTS idx_game_watches ON game_watches(game_key,currency);
  CREATE TABLE IF NOT EXISTS game_dm_notifications(
    user_id TEXT NOT NULL,offer_key TEXT NOT NULL,watch_id TEXT NOT NULL,
    price_cents INTEGER NOT NULL,changed_at INTEGER NOT NULL,delivered_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,offer_key,watch_id,changed_at)
  );`);
  const offerColumns=db.prepare('PRAGMA table_info(offers)').all().map(col=>col.name);
  if(!offerColumns.includes('game_key')){
    db.exec('ALTER TABLE offers ADD COLUMN game_key TEXT');
    const update=db.prepare('UPDATE offers SET game_key=? WHERE offer_key=?');
    for(const o of db.prepare('SELECT offer_key,title,kind FROM offers').all())
      update.run(engine.gameKey(o),o.offer_key);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_offers_game ON offers(game_key,currency)');
  const columns = db.prepare('PRAGMA table_info(guilds)').all().map(col => col.name);
  if (!columns.includes('max_price_cents')) db.exec('ALTER TABLE guilds ADD COLUMN max_price_cents INTEGER');
  return db;
}

function upsertOffer(db, o) {
  const previous = db.prepare('SELECT price_cents, currency, discount, original_cents FROM offers WHERE offer_key=?').get(o.key);
  const now = Date.now();
  db.prepare(`INSERT INTO offers(offer_key,title,source,kind,url,image,currency,original_cents,price_cents,discount,expires_at,seen_at,changed_at,game_key)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(offer_key) DO UPDATE SET title=excluded.title,url=excluded.url,game_key=excluded.game_key,image=COALESCE(excluded.image,offers.image),currency=excluded.currency,original_cents=excluded.original_cents,price_cents=excluded.price_cents,discount=excluded.discount,expires_at=excluded.expires_at,seen_at=excluded.seen_at,changed_at=CASE WHEN offers.price_cents != excluded.price_cents OR offers.currency != excluded.currency OR offers.discount != excluded.discount THEN excluded.changed_at ELSE offers.changed_at END`).run(o.key,o.title,o.source,o.kind,o.url,o.image,o.currency,o.originalCents,o.priceCents,o.discount,o.expiresAt,now,now,engine.gameKey(o));
  const changed = !previous || previous.price_cents !== o.priceCents || previous.currency !== o.currency || previous.discount !== o.discount;
  if (changed) db.prepare('INSERT INTO price_history(offer_key,price_cents,currency,recorded_at) VALUES(?,?,?,?)').run(o.key,o.priceCents,o.currency,now);
  return changed;
}

function getOffer(db, key) { return db.prepare('SELECT * FROM offers WHERE offer_key=?').get(key); }
function recentDeals(db, minDiscount = 0, limit = 15) { return db.prepare("SELECT * FROM offers WHERE source='steam' AND discount>=? AND price_cents>0 AND seen_at>? ORDER BY discount DESC, seen_at DESC LIMIT ?").all(minDiscount, Date.now()-2*86400000, limit); }
function freeGames(db, limit = 15) { return db.prepare("SELECT * FROM offers WHERE source='epic' AND price_cents=0 AND seen_at>? AND (expires_at IS NULL OR expires_at>?) ORDER BY seen_at DESC LIMIT ?").all(Date.now()-2*86400000,new Date().toISOString(),limit); }
function watchList(db, userId) { return db.prepare('SELECT w.offer_key,w.target_cents,o.title,o.price_cents,o.currency,o.discount,o.url,o.source FROM watchlist w JOIN offers o ON o.offer_key=w.offer_key WHERE w.user_id=? ORDER BY w.created_at DESC LIMIT 25').all(userId); }
function setSource(db, source, count, error = null) { db.prepare('INSERT INTO sources(source,checked_at,last_error,item_count) VALUES(?,?,?,?) ON CONFLICT(source) DO UPDATE SET checked_at=excluded.checked_at,last_error=excluded.last_error,item_count=excluded.item_count').run(source,Date.now(),error,count); }
function getGuild(db,id) { return db.prepare('SELECT * FROM guilds WHERE guild_id=?').get(id); }
function setGuild(db,id,menuChannel,dealsChannel,menuMessage) { db.prepare('INSERT INTO guilds(guild_id,menu_channel,deals_channel,menu_message) VALUES(?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET menu_channel=excluded.menu_channel,deals_channel=excluded.deals_channel,menu_message=excluded.menu_message').run(id,menuChannel,dealsChannel,menuMessage); }
async function backupDb(db, dir=process.env.DATA_DIR || path.join(process.cwd(),'data')) {
  const folder=path.join(dir,'backups');
  fs.mkdirSync(folder,{recursive:true});
  const file=path.join(folder,`gamedeals-${new Date().toISOString().slice(0,10)}.db`);
  await backup(db,file);
  const copies=fs.readdirSync(folder).filter(n=>/^gamedeals-\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort().reverse();
  for(const old of copies.slice(7))fs.rmSync(path.join(folder,old),{force:true});
  return file;
}

function enqueueDelivery(db,d){
  db.prepare('INSERT OR IGNORE INTO delivery_queue(id,target_type,target_id,offer_key,price_cents,created_at,next_attempt_at) VALUES(?,?,?,?,?,?,?)')
    .run(d.id,d.type,d.target,d.offerKey,d.priceCents,d.createdAt,d.createdAt);
}
function dueDeliveries(db,limit=20,now=Date.now()){
  return db.prepare("SELECT * FROM delivery_queue WHERE status='pending' AND next_attempt_at<=? ORDER BY created_at ASC LIMIT ?").all(now,limit);
}
function deliveryResult(db,id,ok,message='',now=Date.now(),retryMs=30000){
  if(ok)db.prepare("UPDATE delivery_queue SET status='delivered',last_error=NULL WHERE id=?").run(id);
  else db.prepare("UPDATE delivery_queue SET attempts=attempts+1,status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,next_attempt_at=?,last_error=? WHERE id=?")
    .run(now+retryMs,String(message).slice(0,250),id);
}
function discardDelivery(db,id,why='expired'){
  db.prepare("UPDATE delivery_queue SET status='discarded',last_error=? WHERE id=?").run(why,id);
}
function queueStats(db){
  return db.prepare('SELECT status,COUNT(*) n FROM delivery_queue GROUP BY status').all();
}
function getGuildStats(db){
  return {
    offers:db.prepare('SELECT COUNT(*) n FROM offers').get().n,
    watchers:db.prepare('SELECT COUNT(*) n FROM watchlist').get().n,
    gameWatches:db.prepare('SELECT COUNT(*) n FROM game_watches').get().n,
    pricePoints:db.prepare('SELECT COUNT(*) n FROM price_history').get().n,
    sources:db.prepare('SELECT source,checked_at,last_error,item_count FROM sources ORDER BY source').all(),
    queue:queueStats(db)
  };
}
function upsertGameWatch(db,{userId,key,title,currency,maxCents=null}){
  const prior=db.prepare('SELECT watch_id FROM game_watches WHERE user_id=? AND game_key=? AND currency=?').get(userId,key,currency);
  const watchId=prior?.watch_id||crypto.randomBytes(12).toString('hex');
  db.prepare('INSERT INTO game_watches(watch_id,user_id,game_key,title,currency,max_cents,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,game_key,currency) DO UPDATE SET title=excluded.title,max_cents=COALESCE(excluded.max_cents,game_watches.max_cents)')
    .run(watchId,userId,key,title,currency,maxCents,Date.now());
  return watchId;
}
function watchGameList(db,userId){
  return db.prepare('SELECT * FROM game_watches WHERE user_id=? ORDER BY created_at DESC LIMIT 25').all(userId);
}

module.exports={openDb,upsertOffer,getOffer,recentDeals,freeGames,watchList,setSource,getGuild,setGuild,backupDb,enqueueDelivery,dueDeliveries,deliveryResult,discardDelivery,queueStats,getGuildStats,upsertGameWatch,watchGameList};