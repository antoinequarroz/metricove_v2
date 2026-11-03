export async function register() {
  // This exact check lets Next drop the import from the edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.SCHEDULER === "off") return;
    const { startScheduler } = await import("./server/scheduler");
    startScheduler();
  }
}
