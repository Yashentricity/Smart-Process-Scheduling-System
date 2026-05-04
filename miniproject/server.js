const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
  host: "localhost", user: "root", password: "SS@2006210", database: "smart_scheduler"
});
db.connect(err => { if (err) throw err; console.log("MySQL connected"); });

app.post("/api/processes", (req, res) => {
  const { pid, arrival, burst, priority, ptype } = req.body;
  const predicted = predictBurst(ptype, priority, burst);
  db.query(
    "INSERT INTO processes (pid, arrival_time, burst_time, predicted_burst, priority, process_type) VALUES (?,?,?,?,?,?)",
    [pid, arrival, burst, predicted, priority, ptype],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: result.insertId, predicted });
    }
  );
});

app.post("/api/schedule", (req, res) => {
  const { algorithm } = req.body;
  db.query("SELECT * FROM processes WHERE status='waiting'", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const result = schedule(rows, algorithm);
    result.forEach(p => {
      db.query(
        "INSERT INTO scheduling_logs (process_id, algorithm, wait_time, turnaround_time) VALUES (?,?,?,?)",
        [p.id, algorithm, p.wait_time, p.turnaround]
      );
      db.query("UPDATE processes SET status='completed' WHERE id=?", [p.id]);
    });
    res.json(result);
  });
});

app.get("/api/logs", (req, res) => {
  db.query("SELECT * FROM scheduling_logs ORDER BY scheduled_at DESC LIMIT 50", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

function predictBurst(type, priority, burst) {
  const typeFactor = type === "cpu" ? 1.1 : 0.75;
  const pFactor = { high: 0.85, medium: 1.0, low: 1.2 };
  return Math.round(burst * typeFactor * (pFactor[priority] || 1.0));
}

function schedule(processes, algorithm) {
  const ps = processes.map(p => ({
    ...p, predicted: p.predicted_burst, remaining: p.predicted_burst
  }));

  if (algorithm === "FCFS") {
    ps.sort((a, b) => a.arrival_time - b.arrival_time);
    let time = 0;
    return ps.map(p => {
      if (time < p.arrival_time) time = p.arrival_time;
      const wait = time - p.arrival_time;
      time += p.predicted;
      return { ...p, wait_time: wait, turnaround: wait + p.predicted };
    });
  }

  if (algorithm === "SJF") {
    ps.sort((a, b) => a.arrival_time - b.arrival_time);
    let time = 0, done = [], rem = [...ps];
    while (rem.length > 0) {
      const avail = rem.filter(p => p.arrival_time <= time);
      if (!avail.length) { time = rem[0].arrival_time; continue; }
      avail.sort((a, b) => a.predicted - b.predicted);
      const p = avail[0];
      rem = rem.filter(x => x.id !== p.id);
      const wait = time - p.arrival_time;
      time += p.predicted;
      done.push({ ...p, wait_time: wait, turnaround: wait + p.predicted });
    }
    return done;
  }

  if (algorithm === "Priority") {
    const pmap = { high: 1, medium: 2, low: 3 };
    ps.sort((a, b) => pmap[a.priority] - pmap[b.priority]);
    let time = 0;
    return ps.map(p => {
      const wait = Math.max(0, time - p.arrival_time);
      time += p.predicted;
      return { ...p, wait_time: wait, turnaround: wait + p.predicted };
    });
  }

  if (algorithm === "RoundRobin") {
    const quantum = 4;
    const queue = ps.map(p => ({ ...p })).sort((a, b) => a.arrival_time - b.arrival_time);
    let time = 0, rq = [queue.shift()], done = [];
    let idx = 0;
    while (rq.length > 0) {
      const p = rq.shift();
      const exec = Math.min(p.remaining, quantum);
      p.remaining -= exec;
      time += exec;
      while (idx < queue.length && queue[idx].arrival_time <= time) rq.push(queue[idx++]);
      if (p.remaining > 0) rq.push(p);
      else done.push({ ...p, finish: time, turnaround: time - p.arrival_time, wait_time: time - p.arrival_time - p.predicted });
    }
    return done;
  }

  return ps;
}

app.listen(5000, () => console.log("Server running on port 5000"));