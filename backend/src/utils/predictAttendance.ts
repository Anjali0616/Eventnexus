// Attendance forecast. AI-first: the Python service's trained regressor
// (trained on historical registration/attendance data) is asked first; the
// deterministic velocity heuristic below remains the fallback whenever the
// AI service is unreachable or has no model yet.
import * as ai from "./aiClient";

export const heuristic = (event: any): number => {
  const now = Date.now();
  const createdAt = new Date(event.createdAt).getTime();
  const eventDate = new Date(event.date).getTime();

  const daysSinceCreated = Math.max(1, (now - createdAt) / (1000 * 60 * 60 * 24));
  const daysUntilEvent = Math.max(0, (eventDate - now) / (1000 * 60 * 60 * 24));

  if (event.registered === 0 || eventDate <= now) {
    return event.registered;
  }

  const velocityPerDay = event.registered / daysSinceCreated;
  const projected = event.registered + velocityPerDay * daysUntilEvent;

  return Math.min(event.capacity, Math.round(projected));
};

export const predictAttendance = async (event: any): Promise<number> => {
  const predictions: any = await ai.predictAttendance([event]);
  if (predictions && predictions.length && predictions[0].predicted != null) {
    return predictions[0].predicted;
  }
  return heuristic(event);
};

// Batch variant for when many events need forecasting at once.
export const batch = async (events: any[]): Promise<number[]> => {
  const predictions: any = await ai.predictAttendance(events);
  if (!predictions || predictions.length !== events.length) {
    return events.map(heuristic);
  }
  const byId = new Map(predictions.map((p: any) => [String(p.event_id), p.predicted]));
  return events.map((e: any) => (byId as any).get(String(e._id)) ?? heuristic(e));
};

// Attach properties to the function so `require("./predictAttendance").heuristic` works
(predictAttendance as any).heuristic = heuristic;
(predictAttendance as any).batch = batch;
(predictAttendance as any).predictAttendance = predictAttendance;

export default predictAttendance;

// CommonJS interop: preserve `module.exports = predictAttendance` with attached properties
declare const module: any;
if (typeof module !== "undefined" && (module as any).exports) {
  (module as any).exports = predictAttendance;
  (module as any).exports.default = predictAttendance;
  (module as any).exports.predictAttendance = predictAttendance;
  (module as any).exports.heuristic = heuristic;
  (module as any).exports.batch = batch;
}
