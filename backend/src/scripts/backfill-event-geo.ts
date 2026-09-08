/**
 * Backfill Event.coordinates.geo from coordinates.lat/lng.
 *
 * Events carry both a plain {lat, lng} pair and a GeoJSON mirror
 * (coordinates.geo) that the 2dsphere index is built on. A pre('save') hook
 * keeps them in sync — but hooks do not run for insertMany(), which is how
 * seed.js creates its events. The result was a database full of events with
 * valid lat/lng and no geo point at all, so notifyNearbyUsers() bailed on
 * its first line every time and NOT ONE "new event near you" alert was ever
 * sent for a seeded event.
 *
 * Idempotent: only touches documents that have lat/lng but no geo, so
 * re-running it is a no-op.
 *
 * Run with:  npm run backfill:event-geo
 */

import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import Event from "../models/Event";

const run = async (): Promise<void> => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI as string;
  if (!uri) {
    console.error("✗ MONGO_URI is not set — nothing to backfill against.");
    process.exit(1);
  }

  await mongoose.connect(uri as string);
  console.log("✓ Connected");

  const needsGeo = {
    "coordinates.lat": { $ne: null, $exists: true },
    "coordinates.lng": { $ne: null, $exists: true },
    "coordinates.geo.coordinates": { $exists: false },
  };

  const targets = await Event.find(needsGeo).select("_id title coordinates").lean();
  if (!targets.length) {
    console.log("✓ Nothing to backfill — every event with lat/lng already has a geo point.");
  } else {
    console.log(`Backfilling ${targets.length} event(s)...`);
    // Bulk write: one round trip rather than N saves. The values come from
    // the document's own lat/lng, so this can't invent a location.
    const ops = targets.map((e) => ({
      updateOne: {
        filter: { _id: e._id },
        update: {
          $set: {
            "coordinates.geo": {
              type: "Point",
              coordinates: [e.coordinates.lng, e.coordinates.lat],
            },
          },
        },
      },
    }));
    const res = await Event.bulkWrite(ops, { ordered: false });
    console.log(`✓ Updated ${res.modifiedCount} event(s)`);
  }

  const total = await Event.countDocuments();
  const withLatLng = await Event.countDocuments({ "coordinates.lat": { $ne: null, $exists: true } });
  const withGeo = await Event.countDocuments({ "coordinates.geo.coordinates": { $exists: true } });
  console.log(`\nEvents: ${total} total · ${withLatLng} with lat/lng · ${withGeo} with geo point`);

  const stillMissing = withLatLng - withGeo;
  if (stillMissing > 0) console.warn(`⚠ ${stillMissing} event(s) still have lat/lng but no geo point.`);

  // The geo query only works if the 2dsphere index actually exists.
  await Event.syncIndexes();
  console.log("✓ Indexes synced (2dsphere on coordinates.geo)");

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("✗ Backfill failed:", error.message);
  process.exit(1);
});
