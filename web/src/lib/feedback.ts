export type Notice = { message: string; tone: "success" | "error" | "info" };

export function notify(message: string, tone: Notice["tone"] = "success") {
  window.dispatchEvent(new CustomEvent<Notice>("lilium:notice", { detail: { message, tone } }));
}

export function reportError(message: string, error: unknown) {
  notify(`${message}：${error instanceof Error ? error.message : String(error)}`, "error");
}
