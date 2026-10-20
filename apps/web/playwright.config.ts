import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 45000,
  use: {
    baseURL: "http://localhost:8080",
    browserName: process.env.E2E_BROWSER === "webkit" ? "webkit" : "chromium",
    trace: "retain-on-failure",
    launchOptions: {
      args:
        process.env.E2E_BROWSER === "webkit"
          ? []
          : [
              "--use-fake-device-for-media-stream",
              "--use-fake-ui-for-media-stream",
              ...(process.env.LIVE_AUDIO_FIXTURE
                ? [
                    `--use-file-for-fake-audio-capture=${process.env.LIVE_AUDIO_FIXTURE}`,
                  ]
                : []),
            ],
    },
  },
  reporter: "list",
  workers: 1,
});
