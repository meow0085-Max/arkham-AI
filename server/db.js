const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "investigators.json");

function readData() {
  try {
    const raw = fs.readFileSync(dataPath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}

function writeData(obj) {
  fs.writeFileSync(dataPath, JSON.stringify(obj, null, 2), "utf8");
}

function saveInvestigator(clientId, data) {
  const db = readData();
  db[clientId] = {
    data,
    updated_at: new Date().toISOString(),
  };
  writeData(db);
}

function getInvestigator(clientId) {
  const db = readData();
  const row = db[clientId];
  if (!row) return null;
  return typeof row.data === "object" ? JSON.stringify(row.data) : row.data;
}

module.exports = { saveInvestigator, getInvestigator };
