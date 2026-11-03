import { demoPublisher } from "./demo";
import { postizPublisher } from "./postiz";
import type { Publisher } from "./types";

/** PUBLISHER=postiz for real publishing, anything else is demo mode. */
export function getPublisher(): Publisher {
  return process.env.PUBLISHER === "postiz" ? postizPublisher : demoPublisher;
}
