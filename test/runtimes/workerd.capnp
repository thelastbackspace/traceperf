using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [ (name = "main", worker = .worker) ],
  sockets = [ ( name = "http", address = "127.0.0.1:8790", http = (), service = "main" ) ],
);

const worker :Workerd.Worker = (
  modules = [
    (name = "worker.mjs", esModule = embed "worker.mjs"),
    (name = "traceperf.bundle.mjs", esModule = embed "traceperf.bundle.mjs"),
  ],
  compatibilityDate = "2026-10-01",
);
