const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "hl-pick-web",
      cwd: path.join(__dirname, ".next/standalone"),
      script: path.join(__dirname, ".next/standalone/server.js"),
      env: {
        NODE_ENV: "production",
        PORT: "3005",
        HOSTNAME: "127.0.0.1",
        BASE_PATH: "/add-pick",
        NEXT_PUBLIC_BASE_PATH: "/add-pick",
        DATA_DIR: path.join(__dirname, "data"),
        HL_WEIGHT_CAP_PER_MIN: "700",
        INBOUND_RATE_LIMIT: "90",
      },
      max_memory_restart: "600M",
      time: true,
    },
    {
      name: "hl-pick-worker",
      cwd: __dirname,
      script: path.join(__dirname, "node_modules/tsx/dist/cli.mjs"),
      args: "src/worker/index.ts",
      env: {
        NODE_ENV: "production",
        DATA_DIR: path.join(__dirname, "data"),
        HL_WEIGHT_CAP_PER_MIN: "400",
        AUTO_HOLDING: "0",
        WARM_TOP: "200",
        SNAPSHOT_TOP: "300",
      },
      max_memory_restart: "768M",
      time: true,
    },
  ],
};
