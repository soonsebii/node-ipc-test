'use strict';

const workers_count  = process.argv[2]*1 || 1;
const parallel       = process.argv[3]*1 || 1;
const payload_size   = process.argv[4]*1 || 256;
const messages_count = 20000;

const child_process = require('child_process');
const ipc = require('node-ipc');
const fs = require('fs');
let payload;

let fixme;

ipc.config.silent = true;

if (process.send) {
  // worker
  ipc.config.id = 'worker';
  ipc.config.stopRetrying = 3;
  workerRun();
} else {
  // master
  ipc.config.id = 'master';
  payload = require('crypto').randomBytes(payload_size/2).toString('hex');
  let workers = Array.from(Array(workers_count), () => child_process.fork(__filename));

  masterCreateServer().then(() => {
    let master_cpu_usage = getCpuUsage(), time = Date.now();
    let promises = [];

    workers.forEach(worker => {
      Array.from(Array(parallel), () => {
        promises.push(masterRun(worker));
      });
    });

    Promise.all(promises).then(function(results) {
      master_cpu_usage = getCpuUsage() - master_cpu_usage;
      time = Date.now() - time;
      master_cpu_usage = master_cpu_usage / time;
      let workers_cpu_usage = results.reduce((sum, r) => sum + r) / parallel;
      let speed = messages_count * workers_count * parallel / time;
      console.log(`test for ${workers_count} workers, parallel=${parallel}, payload_size=${payload_size}`);
      console.log(`time: ${time}ms`);
      console.log(`master cpu usage: ${(100*master_cpu_usage).toFixed()}%`);
      console.log(`workers cpu usage: ${(100*workers_cpu_usage).toFixed()}%`);
      console.log(`result: ${(1000*speed).toFixed()} msg/s`);
      process.exit();
    });
  });
}

function getCpuUsage() {
  let stat = fs.readFileSync(`/proc/${process.pid}/stat`).toString().split(' ');
  let utime = parseInt(stat[13]); // in ticks, tick = 1/10000 s
  let stime = parseInt(stat[14]);
  return (utime + stime) * 10; // to ms
}

function masterCreateServer() {
  return new Promise(done => {
    ipc.serve(() => {
      ipc.server.on('connect', socket => {
        fixme = socket;
        done();
      });
    });

    ipc.server.start();
  });
}

function masterRun(worker) {
  masterRun.uid = masterRun.uid ? masterRun.uid + 1 : 1;
  let uid = masterRun.uid;
  return new Promise(function(done) {
    let id = 1;
    let time = Date.now();

    ipc.server.on('message', (msg, socket) => {
      if (msg.uid != uid) return;
      if (msg.id != id) console.error(`id from worker (${msg.id}) != ${id}`);
      if (id == messages_count) return done(msg.cpu_usage / (Date.now() - time));
      id = msg.id + 1;

      msg.id++;
      ipc.server.emit(socket, 'message', msg);
    });

    if (typeof fixme !== 'undefined') {
      ipc.server.emit(fixme, 'message', {
        id: id,
        uid: uid,
        payload: payload
      });
    }
  });
}

function workerRun() {
  let cpu_usage = getCpuUsage();
  ipc.connectTo('master', function() {
    ipc.of.master.on('connect', function() {
      ipc.of.master.on('message', msg => {
        if (msg.id == messages_count) msg.cpu_usage = getCpuUsage() - cpu_usage;
        ipc.of.master.emit('message', msg);
      });
    });
  });
}
