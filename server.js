const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeId = () => crypto.randomBytes(16).toString("hex");
const makeCode = () => Array.from({length:4}, () => CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]).join("");
const clampName = v => String(v || "").trim().replace(/[<>]/g, "").slice(0, 18);
const playerView = (p, room) => ({
  id: p.id, name: p.name, coins: p.coins, points: p.points,
  isHost: p.id === room.hostId, connected: p.connected,
  hasBid: room.phase === "bidding" ? p.bid !== null : false
});
function publicState(room, viewerId) {
  const me = room.players.find(p => p.id === viewerId);
  return {
    code: room.code, phase: room.phase, hostId: room.hostId,
    round: room.round, prize: room.prize, prizePool: room.prizePool,
    deadline: room.deadline,
    players: room.players.map(p => playerView(p, room)),
    me: me ? { id: me.id, name: me.name, coins: me.coins, points: me.points, isHost: me.id === room.hostId, hasBid: room.phase === "bidding" && me.bid !== null, bid: room.phase === "reveal" || room.phase === "over" ? me.bid : undefined } : null,
    bids: room.phase === "reveal" || room.phase === "over" ? room.players.map(p => ({ id: p.id, name: p.name, bid: p.bid ?? 0, coins: p.coins, points: p.points })) : null,
    winnerId: room.winnerId || null,
    tied: !!room.tied,
    lastResult: room.lastResult || null,
    ranking: room.phase === "over" ? [...room.players].sort((a,b) => b.points-a.points || b.coins-a.coins).map((p,i)=>({rank:i+1,id:p.id,name:p.name,points:p.points,coins:p.coins})) : null
  };
}
function sendState(room) {
  for (const p of room.players) {
    if (p.socketId && p.connected) io.to(p.socketId).emit("state", publicState(room, p.id));
  }
}
function emitError(socket, message) { socket.emit("notice", { type:"error", message }); }
function setHost(room) {
  if (!room.players.some(p => p.id === room.hostId && p.connected)) {
    const next = room.players.find(p => p.connected);
    if (next) room.hostId = next.id;
  }
}
function roomBySocket(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}
function attachPlayer(room, player, socket) {
  player.socketId = socket.id;
  player.connected = true;
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  socket.emit("joined", { token: player.token, code: room.code });
  sendState(room);
}
function startRound(room) {
  if (room.round >= 8) { room.phase = "over"; room.deadline = null; sendState(room); return; }
  room.round += 1;
  room.prize = room.deck[room.round - 1] + room.prizePool;
  room.prizePool = 0;
  room.phase = "bidding";
  room.winnerId = null;
  room.tied = false;
  room.lastResult = null;
  room.deadline = Date.now() + 20000;
  room.players.forEach(p => { p.bid = null; });
  sendState(room);
  clearTimeout(room.timer);
  room.timer = setTimeout(() => resolveRound(room), 20000);
}
function resolveRound(room) {
  if (room.phase !== "bidding") return;
  clearTimeout(room.timer);
  room.players.forEach(p => { if (p.bid === null) p.bid = 0; });
  const maxBid = Math.max(...room.players.map(p => p.bid));
  const leaders = room.players.filter(p => p.bid === maxBid);
  if (leaders.length === 1 && maxBid > 0) {
    const winner = leaders[0];
    winner.coins -= winner.bid;
    winner.points += room.prize;
    room.winnerId = winner.id;
    room.tied = false;
    room.lastResult = { message: `${winner.name} wins ${room.prize} points for a bid of ${winner.bid} coins.`, prize: room.prize, winningBid: winner.bid };
  } else {
    room.winnerId = null;
    room.tied = leaders.length > 1;
    room.prizePool = room.tied ? room.prize : 0;
    room.lastResult = { message: room.tied ? `Tie at ${maxBid} coins — nobody wins. ${room.prize} points carry forward.` : "No winning bid — the prize is unclaimed.", prize: room.prize, winningBid: maxBid };
  }
  room.phase = "reveal";
  room.deadline = null;
  sendState(room);
}
function newRoom(name, socket) {
  let code;
  do { code = makeCode(); } while (rooms.has(code));
  const token = makeId();
  const player = { id: makeId(), token, name, coins:100, points:0, bid:null, connected:true, socketId:socket.id };
  const deck = [1,2,3,4,5,6,7,8].sort(() => Math.random() - 0.5);
  const room = { code, players:[player], hostId:player.id, phase:"lobby", round:0, prize:0, prizePool:0, deck, deadline:null, winnerId:null, tied:false, lastResult:null, timer:null };
  rooms.set(code, room);
  attachPlayer(room, player, socket);
}
io.on("connection", socket => {
  socket.emit("server-ready", { ok:true });
  socket.on("create-room", payload => {
    const name = clampName(payload && payload.name);
    if (!name) return emitError(socket, "Enter your name first.");
    newRoom(name, socket);
  });
  socket.on("join-room", payload => {
    const name = clampName(payload && payload.name);
    const code = String(payload && payload.code || "").trim().toUpperCase();
    if (!name) return emitError(socket, "Enter your name first.");
    const room = rooms.get(code);
    if (!room) return emitError(socket, "Room not found. Check the 4-letter code.");
    if (room.phase !== "lobby") return emitError(socket, "This game has already started. New players cannot join.");
    if (room.players.length >= 6) return emitError(socket, "This room is full (6 players maximum).");
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return emitError(socket, "That name is already in this room.");
    const player = { id: makeId(), token: makeId(), name, coins:100, points:0, bid:null, connected:true, socketId:socket.id };
    room.players.push(player);
    attachPlayer(room, player, socket);
  });
  socket.on("reconnect-player", payload => {
    const code = String(payload && payload.code || "").trim().toUpperCase();
    const token = String(payload && payload.token || "");
    const room = rooms.get(code);
    const player = room && room.players.find(p => p.token === token);
    if (!player) return emitError(socket, "Saved session not found. Create or join a room again.");
    if (player.socketId && player.socketId !== socket.id) {
      const old = io.sockets.sockets.get(player.socketId);
      if (old) old.disconnect(true);
    }
    attachPlayer(room, player, socket);
  });
  socket.on("start-game", () => {
    const room = roomBySocket(socket);
    const player = room && room.players.find(p => p.id === socket.data.playerId);
    if (!room || !player || player.id !== room.hostId) return emitError(socket, "Only the host can start the game.");
    if (room.phase !== "lobby") return;
    if (room.players.length < 2) return emitError(socket, "At least 2 players are needed.");
    startRound(room);
  });
  socket.on("submit-bid", payload => {
    const room = roomBySocket(socket);
    const player = room && room.players.find(p => p.id === socket.data.playerId);
    if (!room || !player || room.phase !== "bidding") return emitError(socket, "Bidding is not open.");
    if (player.bid !== null) return emitError(socket, "Your bid is already locked.");
    const bid = Number(payload && payload.bid);
    if (!Number.isInteger(bid) || bid < 0) return emitError(socket, "Bid must be a whole number of 0 or more.");
    if (bid > player.coins) return emitError(socket, `You only have ${player.coins} coins.`);
    if (Date.now() >= room.deadline) return resolveRound(room);
    player.bid = bid;
    sendState(room);
    if (room.players.every(p => p.bid !== null)) resolveRound(room);
  });
  socket.on("next-round", () => {
    const room = roomBySocket(socket);
    const player = room && room.players.find(p => p.id === socket.data.playerId);
    if (!room || !player || player.id !== room.hostId || room.phase !== "reveal") return;
    if (room.round >= 8) { room.phase = "over"; sendState(room); }
    else startRound(room);
  });
  socket.on("play-again", () => {
    const room = roomBySocket(socket);
    const player = room && room.players.find(p => p.id === socket.data.playerId);
    if (!room || !player || player.id !== room.hostId || room.phase !== "over") return;
    room.deck = [1,2,3,4,5,6,7,8].sort(() => Math.random() - 0.5);
    room.players.forEach(p => { p.coins=100; p.points=0; p.bid=null; });
    room.round=0; room.prize=0; room.prizePool=0; room.phase="lobby"; room.winnerId=null; room.tied=false; room.lastResult=null; room.deadline=null;
    sendState(room);
  });
  socket.on("disconnect", () => {
    const room = roomBySocket(socket);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.data.playerId);
    if (player && player.socketId === socket.id) {
      player.connected = false;
      player.socketId = null;
      setHost(room);
      sendState(room);
    }
  });
});
server.listen(PORT, () => console.log(`Blind Bid listening on ${PORT}`));
