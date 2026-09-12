import { notFound } from "next/navigation";
import { TimelinePreview } from "./preview";

export default function TimelinePlayground() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <TimelinePreview />;
}
