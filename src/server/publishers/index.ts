import { demoPublisher } from "./demo";
import { postizPublisher } from "./postiz";
import { tregPublisher } from "./treg";
import type { Publisher } from "./types";

/** PUBLISHER=treg or postiz for real publishing, anything else is demo mode. */
export function getPublisher(): Publisher {
  if (process.env.PUBLISHER === "treg") return tregPublisher;
  if (process.env.PUBLISHER === "postiz") return postizPublisher;
  return demoPublisher;
}
